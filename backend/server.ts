import express from 'express';

import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI } from '@google/genai';
import OpenAI from 'openai';
import { prisma } from './src/prisma.js';
import bcrypt from 'bcryptjs';
import { Resend } from 'resend';
import dotenv from 'dotenv';
import jwt from 'jsonwebtoken';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import multer from 'multer';
import PDFDocument from 'pdfkit';
import archiver from 'archiver';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const pdf = require('pdf-parse');
import pLimit from 'p-limit';
import { z } from 'zod';
import winston from 'winston';
import fs from 'fs';
import crypto from 'crypto';
import {
  supabase,
  uploadPdfToSupabase,
  uploadTextToSupabase,
  downloadTextFromSupabase,
  getSignedFileUrl
} from './src/lib/supabase.js';
import profileRouter from './routes/profile.js';
import adminRouter from './routes/admin.js';
import {
  authMiddleware,
  requireAdmin,
  requireLecturer,
  loginSchema,
  registerSchema,
  profileUpdateSchema,
  settingsUpdateSchema,
  feedbackSchema,
  sessionSchema,
  overrideSchema
} from './src/lib/auth_shared.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// B. Environment Validation
const requiredEnvVars = [
  'JWT_SECRET',
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'DATABASE_URL'
];

for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    console.error(`❌ Missing required environment variable: ${envVar}`);
    process.exit(1);
  }
}

const hasAnyGeminiKey =
  process.env.GEMINI_API_KEY_1 ||
  process.env.GEMINI_API_KEY_2 ||
  process.env.GEMINI_API_KEY_3 ||
  process.env.GEMINI_API_KEY_4 ||
  process.env.GEMINI_API_KEY_5 ||
  process.env.GEMINI_API_KEY;

if (!hasAnyGeminiKey) {
  console.error('❌ No Gemini API keys found. Set at least GEMINI_API_KEY_1.');
  process.exit(1);
}

const directUrl = process.env.DIRECT_URL;
if (!directUrl) {
  console.log('⚠️ Warning: DIRECT_URL is not set. Prisma might have issues with migrations.');
}

if (!process.env.RESEND_API_KEY) {
  console.log('⚠️ WARNING: RESEND_API_KEY is not set — emails will not send. Register on resend.com to get a key.');
}

// C. Winston Logger
if (!fs.existsSync('logs')) fs.mkdirSync('logs');

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      )
    }),
    new winston.transports.File({ filename: 'dev.log', maxsize: 5 * 1024 * 1024, maxFiles: 3 })
  ]
});

const processId = `${process.pid}-${Math.random().toString(36).substring(7)}`;
logger.info(`🚀 Server instance starting: ${processId}`);

// D. Service Initialization
export const resend = new Resend(process.env.RESEND_API_KEY || 're_mock');

// ─── Groq Key Pool with Automatic Rotation ───────────────────────────────
const groqKeyPool: string[] = [];
for (let i = 1; ; i++) {
  const key = process.env[`GROQ_API_KEY_${i}`];
  if (!key) break;
  groqKeyPool.push(key);
}
if (groqKeyPool.length === 0 && process.env.GROQ_API_KEY) {
  groqKeyPool.push(process.env.GROQ_API_KEY);
}

if (groqKeyPool.length === 0) {
  console.error('❌ No Groq API keys configured. Set GROQ_API_KEY_1 in .env');
  process.exit(1);
}

logger.info(`🔑 Groq key pool initialized with ${groqKeyPool.length} key(s)`);

const groqClients = groqKeyPool.map(key => new OpenAI({
  apiKey: key,
  baseURL: 'https://api.groq.com/openai/v1'
}));

let currentGroqKeyIndex = 0;
const exhaustedGroqKeys = new Set<number>();
const groqKeyUsage = new Map<number, number>();

setInterval(() => {
  if (exhaustedGroqKeys.size > 0) {
    logger.info(`Resetting exhausted Groq key tracking (${exhaustedGroqKeys.size} keys)`);
    exhaustedGroqKeys.clear();
  }
}, 60 * 60 * 1000);

function getActiveGroq(): { client: any; keyIndex: number } {
  for (let i = 0; i < groqClients.length; i++) {
    const idx = (currentGroqKeyIndex + i) % groqClients.length;
    if (!exhaustedGroqKeys.has(idx)) {
      currentGroqKeyIndex = idx;
      return { client: groqClients[idx], keyIndex: idx };
    }
  }
  // All keys exhausted — reset and use first
  exhaustedGroqKeys.clear();
  currentGroqKeyIndex = 0;
  logger.warn('All Groq API keys exhausted — resetting pool and retrying from key 1');
  return { client: groqClients[0], keyIndex: 0 };
}

// ─── Gemini Key Pool with Automatic Rotation ───────────────────────────────
interface KeyState {
  key: string;
  client: GoogleGenAI;
  requestTimestamps: number[]; // for RPM tracking
  dailyCount: number;
  dailyResetAt: number;
  cooldownUntil: number; // 0 if not in cooldown
  label: string;
}

class GeminiKeyPool {
  private keys: KeyState[] = [];
  private currentIndex = 0;
  private waitingCallsCount = 0;

  constructor() {
    const rawKeys = [
      process.env.GEMINI_API_KEY_1,
      process.env.GEMINI_API_KEY_2,
      process.env.GEMINI_API_KEY_3,
      process.env.GEMINI_API_KEY_4,
      process.env.GEMINI_API_KEY_5,
      process.env.GEMINI_API_KEY // fallback single key
    ].filter((k): k is string => !!k);

    if (rawKeys.length === 0) {
      throw new Error('No Gemini API keys configured. Set GEMINI_API_KEY_1 through GEMINI_API_KEY_5.');
    }

    this.keys = rawKeys.map((key, i) => ({
      key,
      client: new GoogleGenAI({ apiKey: key }),
      requestTimestamps: [],
      dailyCount: 0,
      dailyResetAt: new Date().setHours(24, 0, 0, 0),
      cooldownUntil: 0,
      label: `key-${i + 1}`
    }));

    logger.info(`Gemini key pool initialized with ${this.keys.length} keys`);
  }

  // Find the next key that's actually usable right now
  private getAvailableKey(): KeyState | null {
    const now = Date.now();

    for (let attempts = 0; attempts < this.keys.length; attempts++) {
      const candidate = this.keys[this.currentIndex];
      this.currentIndex = (this.currentIndex + 1) % this.keys.length;

      // Reset daily counter if day has rolled over
      if (now > candidate.dailyResetAt) {
        candidate.dailyCount = 0;
        candidate.dailyResetAt = new Date().setHours(24, 0, 0, 0);
      }

      // Clean RPM window
      candidate.requestTimestamps = candidate.requestTimestamps.filter(t => now - t < 60000);

      const isInCooldown = candidate.cooldownUntil > now;
      const isOverRpm = candidate.requestTimestamps.length >= 8; // safe margin under the 10 RPM real limit
      const isOverRpd = candidate.dailyCount >= 18; // safe margin under the 20 RPD real limit

      if (!isInCooldown && !isOverRpm && !isOverRpd) {
        return candidate;
      }
    }

    return null; // every key is currently exhausted
  }

  async call(
    contents: any,
    context: string = 'unknown',
    options: { maxWaitMs?: number; temperature?: number } = {}
  ): Promise<any> {
    const { maxWaitMs = 90000, temperature } = options;
    const startTime = Date.now();
    let hasWaited = false;

    try {
      while (Date.now() - startTime < maxWaitMs) {
        const keyState = this.getAvailableKey();

        if (!keyState) {
          if (!hasWaited) {
            this.waitingCallsCount++;
            hasWaited = true;
          }
          logger.warn(`All ${this.keys.length} Gemini keys are exhausted, waiting 5s before recheck [${context}]`);
          await new Promise(resolve => setTimeout(resolve, 5000));
          continue;
        }

        if (hasWaited) {
          this.waitingCallsCount--;
          hasWaited = false;
        }

        try {
          keyState.requestTimestamps.push(Date.now());
          keyState.dailyCount++;

          logger.info(`Gemini call [${context}] using ${keyState.label} (daily: ${keyState.dailyCount}/20, rpm window: ${keyState.requestTimestamps.length}/8)`);

          const response = await keyState.client.models.generateContent({
            model: 'gemini-2.5-flash-lite',
            contents,
            config: temperature !== undefined ? { temperature } : undefined
          });

          return response;

        } catch (error: any) {
          const errorMsg = error.message || '';
          const isRateLimit = 
            errorMsg.includes('429') || 
            errorMsg.includes('RESOURCE_EXHAUSTED') ||
            errorMsg.includes('503') ||
            errorMsg.includes('UNAVAILABLE') ||
            errorMsg.includes('experiencing high demand') ||
            errorMsg.includes('temporary');

          if (isRateLimit) {
            logger.warn(`${keyState.label} hit rate limit/overload on [${context}], cooling down and trying next key`);
            keyState.cooldownUntil = Date.now() + 60000; // 60s cooldown for this specific key
            continue; // loop will pick a different key automatically
          }

          // Non-rate-limit error — don't burn through all keys for a real bug
          logger.error(`Gemini call [${context}] failed with non-rate-limit error on ${keyState.label}:`, errorMsg);
          throw error;
        }
      }
    } finally {
      if (hasWaited) {
        this.waitingCallsCount--;
      }
    }

    throw new Error(`All Gemini API keys are rate limited or exhausted. Please wait a few minutes, or type the answer manually.`);
  }

  getStatus() {
    const now = Date.now();
    return this.keys.map(k => ({
      label: k.label,
      dailyUsed: k.dailyCount,
      dailyLimit: 20,
      rpmUsed: k.requestTimestamps.filter(t => now - t < 60000).length,
      rpmLimit: 8,
      inCooldown: k.cooldownUntil > now
    }));
  }

  getWaitingCallsCount(): number {
    return this.waitingCallsCount;
  }
}

const geminiPool = new GeminiKeyPool();

function getFileHash(buffer: Buffer): string {
  return crypto.createHash('md5').update(buffer).digest('hex');
}

async function getOrCreateOcrResult(
  fileBuffer: Buffer,
  ocrPrompt: string,
  mimeType: string,
  context: string
): Promise<{ text: string; wasCached: boolean }> {
  const fileHash = getFileHash(fileBuffer);

  const cached = await (prisma as any).ocrCache.findUnique({ where: { fileHash } });
  if (cached) {
    logger.info(`OCR cache HIT for hash ${fileHash} — reusing identical transcription, no Gemini call needed`);
    return { text: cached.extractedText, wasCached: true };
  }

  const base64Data = fileBuffer.toString('base64');
  const response = await callGeminiSafe(
    [{
      role: 'user',
      parts: [
        { inlineData: { data: base64Data, mimeType } },
        { text: ocrPrompt }
      ]
    }],
    { context, temperature: 0 }
  );

  const text = response.text?.trim() || '';

  if (text && text !== 'UNREADABLE_DOCUMENT') {
    await (prisma as any).ocrCache.create({ data: { fileHash, extractedText: text } });
    logger.info(`OCR result cached permanently for hash ${fileHash}`);
  }

  return { text, wasCached: false };
}

// ─── Queue + Retry wrapper for ALL Gemini calls ─────────────────────────────
async function callGeminiSafe(
  contents: any,
  options: { context?: string; temperature?: number } = {}
): Promise<any> {
  const { context = 'unknown', temperature } = options;
  return geminiPool.call(contents, context, { temperature });
}

// ─── Gemini Model Startup Verification ──────────────────────────────────────
async function verifyGeminiModel(): Promise<boolean> {
  try {
    const testResponse = await callGeminiSafe(
      'Say "OK" if you can read this.',
      { context: 'startup-verification' }
    );
    logger.info(`✅ Gemini model verified: ${testResponse.text}`);
    return true;
  } catch (error: any) {
    logger.error('❌ Gemini model verification FAILED:', error.message);
    logger.error('This means gemini-2.5-flash-lite may not be available with your API key/region.');
    return false;
  }
}

// ─── Startup Schema Validation ──────────────────────────────────────────────
async function validateSchema() {
  try {
    // Perform simple read operations to verify the table structures match the current Prisma client
    await (prisma as any).studentResult.findFirst();
    await (prisma as any).questionResult.findFirst();
    logger.info('✅ Schema validated against Supabase');
  } catch (error: any) {
    logger.error('❌ SCHEMA MISMATCH DETECTED:');
    logger.error(error.message);
    console.error('\n❌ SCHEMA MISMATCH DETECTED:', error.message);
    console.error('Run: npx prisma generate && touch server.ts\n');
    process.exit(1); // Stop server if schema is broken to prevent silent data-loss/corruption
  }
}
await validateSchema();

// Groq API call with retry and active key rotation for 429 rate limits
async function groqWithRetry(
  prompt: string,
  model = 'llama-3.3-70b-versatile',
  maxRetries = 3,
  maxTokens?: number,
  temperature?: number
): Promise<any> {
  // Try up to length of pool + original maxRetries
  const maxAttempts = Math.max(maxRetries, groqClients.length + 1);

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const { client: currentGroq, keyIndex } = getActiveGroq();

    try {
      logger.info(`[Groq] Sending request using Key ${keyIndex + 1}...`);
      const completion = await currentGroq.chat.completions.create({
        model,
        messages: [{ role: 'user', content: prompt }],
        ...(maxTokens ? { max_tokens: maxTokens } : {}),
        ...(temperature !== undefined ? { temperature } : {})
      });

      // Track usage
      const tokens = completion.usage?.total_tokens || 0;
      const currentUsage = (groqKeyUsage.get(keyIndex) || 0) + tokens;
      groqKeyUsage.set(keyIndex, currentUsage);
      
      logger.info(`[Groq] Request successful via Key ${keyIndex + 1}. Session Usage: ~${currentUsage} tokens.`);

      return { text: completion.choices[0]?.message?.content || '' };
    } catch (err: any) {
      const isQuota = err?.status === 429 || err?.message?.includes('429') || err?.message?.includes('rate limit');
      
      if (isQuota) {
        logger.warn(`Groq limit hit on Key ${keyIndex + 1} (attempt ${attempt + 1}/${maxAttempts}). Switching keys...`);
        exhaustedGroqKeys.add(keyIndex);

        if (attempt < maxAttempts - 1) {
          // brief delay to avoid rapid looping if all fail instantly
          await new Promise(r => setTimeout(r, 1000));
          continue;
        }
      }
      
      let errorReason = err?.message || 'Unknown Error';
      if (err?.message?.toLowerCase().includes('token') || err?.code === 'context_length_exceeded' || err?.message?.includes('maximum context length')) {
        errorReason = 'Token limit exceeded';
      } else if (isQuota) {
        errorReason = 'Rate limit hit';
      }
      
      console.log('--- EXACT GROQ ERROR DUMP ---');
      console.log(err?.response?.data || err?.error || err?.message);
      console.log('-----------------------------');

      const groqErrorMsg = `[Groq: ${errorReason}] Status: ${err?.status || 'N/A'}`;
      logger.error(`Exact Groq Failure Details (Status ${err?.status}):`, JSON.stringify(err?.error || err, null, 2));
      throw new Error(groqErrorMsg);
    }
  }
}


// Cleans LLM response text and extracts pure JSON robustly
function extractJSON(text: string, type: 'array' | 'object'): string {
  // Option 7: Better JSON extraction
  let cleaned = text.replace(/```json\n?|\n?```/g, '').trim();
  const start = type === 'array' ? cleaned.indexOf('[') : cleaned.indexOf('{');
  const end = type === 'array' ? cleaned.lastIndexOf(']') + 1 : cleaned.lastIndexOf('}') + 1;
  return start !== -1 && end > start ? cleaned.slice(start, end) : cleaned;
}

const validateMarkingResult = (result: any) => {
  // Option 8: Add post-marking validation
  if (result.totalMarks > result.maxMarks) {
    result.totalMarks = result.maxMarks;
  }
  if (result.questions && Array.isArray(result.questions)) {
    result.questions = result.questions.map((q: any) => ({
      ...q,
      marksAwarded: Math.min(
        Math.max(0, Number(q.marksAwarded) || 0),
        Number(q.marksAvailable) || 0
      )
    }));
  }
  result.percentage = result.maxMarks > 0
    ? Math.round((result.totalMarks / result.maxMarks) * 1000) / 10
    : 0;
  return result;
};

function normalizeQuestionMarks(parsed: any[]): any[] {
  return parsed.map((q: any) => {
    // Try every reasonable field name Gemini/Llama might have used instead of marksAvailable
    const marksValue =
      q.marksAvailable ??
      q.marks ??
      q.marksAllocated ??
      q.totalMarks ??
      q.maxMarks ??
      q.points ??
      0;

    const numericMarks = Number(marksValue);

    return {
      questionNumber: String(q.questionNumber || q.number || q.q || 'Unknown'),
      questionText: q.questionText || q.question || q.text || '',
      marksAvailable: isNaN(numericMarks) ? 0 : numericMarks,
      topic: q.topic || q.subject || 'General'
    };
  });
}

function normalizeMarkScheme(parsed: any[]): any[] {
  return parsed.map((m: any) => {
    const marksValue =
      m.marksAvailable ??
      m.marks ??
      m.marksAllocated ??
      m.totalMarks ??
      m.maxMarks ??
      m.points ??
      0;

    const numericMarks = Number(marksValue);

    return {
      questionNumber: String(m.questionNumber || m.number || m.q || 'Unknown'),
      marksAvailable: isNaN(numericMarks) ? 0 : numericMarks,
      requiredKeywords: m.requiredKeywords || [],
      acceptAlternatives: m.acceptAlternatives || [],
      rejectList: m.rejectList || [],
      methodMarks: m.methodMarks || '',
      markingGuidance: m.markingGuidance || ''
    };
  });
}

// ─── Combined Question Paper + Mark Scheme Parser (saves 1 API call per session) ───
async function parseQuestionPaperAndMarkScheme(
  questionPdfText: string,
  markSchemeText: string
): Promise<{ questions: any[]; markScheme: any[] }> {

  logger.info('Parsing question paper AND mark scheme in ONE call...');
  logger.info(`Question PDF text length: ${questionPdfText?.length || 0}, preview: "${(questionPdfText || '').substring(0, 300)}"`);

  const prompt = `
You are an expert exam paper analyser. Read both documents below and extract structured data from each.

QUESTION PAPER:
${questionPdfText}

MARK SCHEME:
${markSchemeText}

HOW TO FIND MARKS FOR EACH QUESTION:
Marks are usually shown in one of these formats next to or after each question in the question paper or mark scheme:
- In square brackets: [5] or [2 marks]
- In round brackets: (5) or (5 marks)
- After a slash: Q1 /5
- As a trailing number: Question 1 ... 5
- In a "Total" or "Marks" column if the paper uses a table layout

Look carefully for ANY of these patterns next to each question. If a question
truly has no visible mark indicator anywhere near it, estimate based on the
complexity of what's being asked (a one-word answer is likely 1-2 marks, a
short explanation is likely 3-5 marks, an essay-style answer is likely 8-15 marks)
rather than defaulting to 0 — a real exam paper almost never has a 0-mark question.

CRITICAL INSTRUCTIONS FOR ACCURACY:
- Read the ENTIRE document before producing output
- Sum every individual question's marks and verify it against any stated
  total (e.g. "Total: 25 marks", "/30") found in the document
- If you cannot find a stated total to verify against, and your per-question
  marks would sum to a suspiciously round or suspiciously low number, double
  check you haven't missed mark indicators

Return ONLY a valid JSON object with no markdown, no backticks, no extra text:
{
  "questions": [
    {
      "questionNumber": "1a",
      "questionText": "Write the full question text exactly as it appears",
      "marksAvailable": 2,
      "topic": "topic this question tests",
      "questionType": "short answer or calculation or definition or essay or diagram"
    }
  ],
  "markScheme": [
    {
      "questionNumber": "1a",
      "marksAvailable": 2,
      "requiredKeywords": ["must appear for full marks"],
      "acceptAlternatives": ["other valid phrasings"],
      "rejectList": ["wrong answers that look correct"],
      "methodMarks": "marks for correct approach even if answer wrong",
      "markingGuidance": "additional marking notes"
    }
  ]
}

Rules:
1. questionNumber must match exactly what is printed in the paper
2. questionText must be the complete unmodified question
3. Extract marks from patterns like [2] or (3 marks) or /4
4. Every question including sub-questions must be included
5. Do not skip any question no matter how short
6. questionNumber must match between questions and markScheme arrays
7. Include every mark scheme entry`;

  try {
    const response = await groqWithRetry(prompt, 'llama-3.3-70b-versatile', 3, undefined, 0);

    // CRITICAL DIAGNOSTIC — log the raw response BEFORE any parsing/cleaning
    logger.info(`RAW Gemini/Llama parsing response: "${response.text?.substring(0, 1500)}"`);

    const text = extractJSON(response.text || '{}', 'object');
    const parsed = JSON.parse(text);

    let questions = parsed.questions || [];
    let markScheme = parsed.markScheme || [];

    // Apply normalization
    questions = normalizeQuestionMarks(questions);
    markScheme = normalizeMarkScheme(markScheme);

    // Log each question's extracted marks individually
    questions.forEach((q: any, i: number) => {
      logger.info(`Question ${i + 1} [${q.questionNumber}]: marksAvailable=${q.marksAvailable} (type: ${typeof q.marksAvailable}), all fields: ${JSON.stringify(q)}`);
    });

    const total = questions.reduce((s: number, q: any) => s + (Number(q.marksAvailable) || 0), 0);
    logger.info(`Total extracted marks after normalization: ${total} across ${questions.length} questions`);

    if (total === 0 && questions.length > 0) {
      logger.error(`🚨 ALL ${questions.length} questions extracted with 0 marks. Either the field name doesn't match, or the source PDF text has no readable mark values.`);
    }

    return { questions, markScheme };

  } catch (error) {
    logger.error('Failed to parse question paper and mark scheme:', error);
    return { questions: [], markScheme: [] };
  }
}

async function markStudentAnswers(
  studentAnswerText: string,
  studentId: string,
  parsedQuestions: any[],
  parsedMarkScheme: any[],
  session: any
): Promise<any> {

  logger.info(`markStudentAnswers() called for ${studentId}: answerText length=${studentAnswerText?.length || 0}, questions=${parsedQuestions?.length || 0}, markScheme entries=${parsedMarkScheme?.length || 0}`);

  if (!studentAnswerText || studentAnswerText.trim().length === 0) {
    logger.error(`🚨 Empty studentAnswerText passed to markStudentAnswers for ${studentId}`);
  }
  if (!parsedQuestions || parsedQuestions.length === 0) {
    logger.error(`🚨 Empty parsedQuestions passed to markStudentAnswers for ${studentId} — cannot mark without question structure`);
    throw new Error('No question structure available. Session paper must be parsed before marking.');
  }

  const strictnessInstruction =
    session.markingStrictness === 'Strict'
      ? `STRICT: Award marks ONLY for answers precisely matching mark scheme keywords. No benefit of the doubt.`
      : session.markingStrictness === 'Lenient'
      ? `LENIENT: Award marks for answers demonstrating understanding even without exact wording. Credit creative approaches.`
      : `STANDARD: Award marks for correct concepts. Allow minor wording variations. Do not penalise spelling unless meaning changes.`;

  const feedbackInstruction =
    session.feedbackDetail === 'Brief'
      ? 'ONE sentence feedback per question.'
      : 'Detailed feedback per question: what student wrote, what was required, why marks awarded or lost, specific improvement advice.';

  // NOTE: prompt now relies ENTIRELY on the structured parsedQuestions and
  // parsedMarkScheme arrays — no raw PDF text needed or referenced anywhere.
  // This removes the possibility of ever passing an empty/missing raw text
  // section into the prompt, which was the source of the bug.
  const prompt = `
You are an expert ${session.examBoard} exam marker.
Assessment: ${session.sessionType}
Subject: ${session.subject}
Course: ${session.courseId}
Student ID: ${studentId}

${strictnessInstruction}
${feedbackInstruction}

━━━━━━━━━━━━━━━━━━━━━━━━━━
QUESTIONS (locked structure — this paper has exactly these questions, nothing more, nothing less):
${JSON.stringify(parsedQuestions, null, 2)}

━━━━━━━━━━━━━━━━━━━━━━━━━━
MARK SCHEME (locked structure — these are the only accepted answers and criteria):
${JSON.stringify(parsedMarkScheme, null, 2)}

━━━━━━━━━━━━━━━━━━━━━━━━━━
STUDENT ${studentId} ANSWER SHEET (this is everything the student wrote — mark only against this):
${studentAnswerText}

━━━━━━━━━━━━━━━━━━━━━━━━━━

MARKING STEPS:
1. For each question in the locked structure above, find the student's corresponding answer in the answer sheet text
2. Compare it against the locked mark scheme criteria for that exact question number
3. Award marks based on the marking mode described above
4. If the student's answer sheet genuinely contains no content for a question number, award 0 marks and mark it unanswered — but only do this if the question number truly does not appear anywhere in the answer sheet text above
5. Never award more than marksAvailable for any question
6. Total marks = sum of marksAwarded across all questions

GRADE SCALE: 90%+ = A*, 80-89% = A, 70-79% = B, 60-69% = C, 50-59% = D, 40-49% = E, below 40% = F

Return ONLY valid JSON. No markdown, no backticks, no extra text:
{
  "studentId": "${studentId}",
  "totalMarks": <number>,
  "maxMarks": <number>,
  "percentage": <number rounded to 1 decimal>,
  "grade": "<letter>",
  "overallFeedback": "<2-3 sentence summary>",
  "questions": [
    {
      "questionNumber": "<exact from locked structure>",
      "questionText": "<from locked structure>",
      "topic": "<from locked structure>",
      "marksAwarded": <number>,
      "marksAvailable": <number, must match locked structure exactly>,
      "status": "<CORRECT|PARTIAL|INCORRECT>",
      "studentAnswer": "<what student wrote for this question>",
      "expectedAnswer": "<from mark scheme>",
      "aiFeedback": "<specific feedback>",
      "lostMarksReason": "<why marks lost or null>",
      "improvementSuggestion": "<specific advice>"
    }
  ]
}`;

  const response = await callGeminiSafe(prompt, {
    context: `mark-student-${studentId}`,
    temperature: 0
  });

  let responseText = response.text || '';
  responseText = responseText.replace(/```json/gi, '').replace(/```/g, '').trim();
  const jsonStart = responseText.indexOf('{');
  const jsonEnd = responseText.lastIndexOf('}');
  if (jsonStart !== -1 && jsonEnd !== -1) {
    responseText = responseText.substring(jsonStart, jsonEnd + 1);
  }

  let result = JSON.parse(responseText);

  // Enforce locked marksAvailable per question — never trust AI's echo of it
  if (result.questions?.length > 0) {
    result.questions = result.questions.map((q: any) => {
      const locked = parsedQuestions.find((pq: any) => pq.questionNumber === q.questionNumber);
      return {
        ...q,
        marksAvailable: locked ? locked.marksAvailable : q.marksAvailable,
        marksAwarded: Math.min(Number(q.marksAwarded) || 0, locked ? locked.marksAvailable : Number(q.marksAvailable) || 0)
      };
    });

    const recalcTotal = result.questions.reduce((s: number, q: any) => s + (Number(q.marksAwarded) || 0), 0);
    const recalcMax = result.questions.reduce((s: number, q: any) => s + (Number(q.marksAvailable) || 0), 0);
    result.totalMarks = recalcTotal;
    result.maxMarks = recalcMax;
    result.percentage = recalcMax > 0 ? Math.round((recalcTotal / recalcMax) * 1000) / 10 : 0;
    const pct = result.percentage;
    result.grade = pct >= 90 ? 'A*' : pct >= 80 ? 'A' : pct >= 70 ? 'B' : pct >= 60 ? 'C' : pct >= 50 ? 'D' : pct >= 40 ? 'E' : 'F';
  }

  logger.info(`Marked ${studentId}: ${result.totalMarks}/${result.maxMarks} (${result.percentage}%) ${result.grade}`);
  return validateMarkingResult(result);
}

async function markStudentAnswersWithConsensus(
  studentAnswerText: string,
  studentId: string,
  parsedQuestions: any[],
  parsedMarkScheme: any[],
  session: any,
  passes: number = 2
): Promise<any> {
  const results = [];
  for (let i = 0; i < passes; i++) {
    const result = await markStudentAnswers(
      studentAnswerText,
      studentId,
      parsedQuestions,
      parsedMarkScheme,
      session
    );
    results.push(result);
  }

  // Merge results — use the first pass as the base, but flag any question
  // where marksAwarded differs between passes as low-confidence
  const baseResult = results[0];

  baseResult.questions = baseResult.questions.map((q: any, idx: number) => {
    const marksAcrossPasses = results.map(r => r.questions[idx]?.marksAwarded);
    const allAgree = marksAcrossPasses.every(m => m === marksAcrossPasses[0]);

    return {
      ...q,
      aiConfidence: allAgree ? 'High' : 'Low',
      consensusNote: allAgree ? null : `AI gave different marks across ${passes} passes (${marksAcrossPasses.join(', ')}). Recommend manual review.`
    };
  });

  const lowConfidenceCount = baseResult.questions.filter((q: any) => q.aiConfidence === 'Low').length;
  logger.info(`Consensus marking for ${studentId}: ${lowConfidenceCount}/${baseResult.questions.length} questions had disagreement across passes`);

  return baseResult;
}

// TypeScript declaration for req.user
declare global {
  namespace Express {
    interface Request {
      user?: any;
    }
  }
}

// E. Multer Setup
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new Error('Only PDF files are allowed') as any);
    }
  }
});

// ... existing code ...
// F. Redundant Schemas and Middleware (Moved to auth_shared.ts)
// ... existing code ...

// H. Progress Tracker
const markingProgress = new Map<string, {
  total: number;
  completed: number;
  currentStudentId: string;
  currentStudentName: string;
  status: string;
  estimatedSecondsRemaining: number;
}>();

// I. Express App Setup
async function startServer() {
  const app = express();
  const PORT = parseInt(process.env.PORT || '3000', 10);

  // Security middleware
  app.use(helmet());
  app.use(cors({
    origin: [
      'https://markaido.netlify.app',
      'http://localhost:5173',
      'http://localhost:3000',
      process.env.ALLOWED_ORIGIN || '*'
    ],
    credentials: true
  }));

  // Request logging middleware
  app.use((req, res, next) => {
    logger.info(`${req.method} ${req.path}`, { 
      ip: req.ip,
      userAgent: req.get('user-agent')
    });
    next();
  });

  app.use(express.json({ limit: '50mb' }));

  // Rate limiting on auth routes
  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    message: { error: 'Too many attempts. Please try again in 15 minutes.' }
  });

  // PING ROUTE - Basic connectivity test
  app.get('/api/ping', (req, res) => res.json({ status: 'alive', timestamp: new Date() }));

  // AI Queue Status — lets frontend show "AI is busy" instead of confusing errors
  app.get('/api/ai/queue-status', authMiddleware, (req, res) => {
    const len = geminiPool.getWaitingCallsCount();
    res.json({
      queueLength: len,
      message: len > 0 
        ? `${len} requests waiting in queue`
        : 'Ready'
    });
  });

  app.get('/api/ai/pool-status', authMiddleware, (req, res) => {
    res.json({ keys: geminiPool.getStatus() });
  });

  // J. All API Routes
  app.get('/api/health', async (req, res) => {
    try {
      await (prisma as any).$queryRaw`SELECT 1`;
      const pkg = JSON.parse(fs.readFileSync('package.json', 'utf-8'));
      res.json({
        status: 'ok',
        db: 'connected',
        uptime: process.uptime(),
        version: pkg.version
      });
    } catch (error) {
      res.status(500).json({ status: 'error', db: 'disconnected' });
    }
  });

  // Mount Routers
  app.use('/api/admin', adminRouter);
  app.use('/api', profileRouter);

  app.post('/api/auth/register', authLimiter, async (req, res) => {
    try {
      const { fullName, email, password, userType, inviteCode, universityId, universityName, studentCode } = registerSchema.parse(req.body);
      console.log('Registration Payload:', { email, userType, universityId, universityName });
      
      // 1. Block Admin registration
      if (userType === 'ADMIN') {
        return res.status(403).json({ 
          error: 'Admin accounts cannot be created through public registration' 
        });
      }

      // 2. Validate Lecturer Invite Code against Invitation table
      if (userType === 'LECTURER') {
        if (!inviteCode) {
          return res.status(403).json({ error: 'Invite code is required for lecturer registration' });
        }

        // Find invitation in database
        const invitation = await (prisma as any).invitation.findUnique({
          where: { code: inviteCode }
        });

        // Validate invitation
        if (!invitation) {
          return res.status(403).json({ error: 'Invalid invite code' });
        }
        if (invitation.used) {
          return res.status(403).json({ error: 'This invite code has already been used' });
        }
        if (new Date(invitation.expiresAt) < new Date()) {
          return res.status(403).json({ error: 'This invite code has expired' });
        }
        if (invitation.email.toLowerCase() !== email.toLowerCase()) {
          return res.status(403).json({ 
            error: 'This invite code was issued to a different email address' 
          });
        }
      }

      const exists = await (prisma as any).user.findUnique({ where: { email } });
      if (exists) return res.status(409).json({ error: 'Email already registered' });

      if (userType === 'STUDENT') {
        if (!studentCode) return res.status(400).json({ error: 'Student code required' });
        const codeExists = await (prisma as any).user.findUnique({ where: { studentCode } });
        if (codeExists) return res.status(409).json({ error: 'Student code already used' });
      }

      let finalUniversityId = universityId;
      if (!finalUniversityId && universityName) {
        const existingUniversity = await (prisma as any).university.findFirst({
          where: { name: { equals: universityName, mode: 'insensitive' } }
        });
        
        if (existingUniversity) {
          finalUniversityId = existingUniversity.id;
        } else {
          const newUniversity = await (prisma as any).university.create({
            data: { name: universityName }
          });
          finalUniversityId = newUniversity.id;
        }
      }

      const hashedPassword = await bcrypt.hash(password, 12);
      
      // 3. Force role assignment
      const assignedRole = userType === 'LECTURER' ? 'LECTURER' : 'STUDENT';

      const user = await (prisma as any).user.create({
        data: { 
          fullName, 
          email, 
          password: hashedPassword, 
          userType: assignedRole,
          role: assignedRole,
          universityId: finalUniversityId, 
          studentCode: assignedRole === 'STUDENT' ? studentCode : null
        }
      });

      // 4. Mark invitation as used if applicable
      if (userType === 'LECTURER' && inviteCode) {
        await (prisma as any).invitation.update({
          where: { code: inviteCode },
          data: { used: true }
        });
      }

      const token = jwt.sign(
        { id: user.id, email: user.email, userType: user.userType },
        process.env.JWT_SECRET!,
        { expiresIn: '7d' }
      );
      
      res.status(201).json({ 
        user: { 
          id: user.id, 
          email: user.email, 
          fullName: user.fullName, 
          userType: user.userType, 
          studentCode: user.studentCode,
          avatarUrl: user.avatarUrl,
          phoneNumber: user.phoneNumber,
          location: user.location,
          bio: user.bio,
          verified: user.verified,
          proPlan: user.proPlan,
          department: user.department,
          role: user.role
        }, 
        token 
      });
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.issues });
      }
      res.status(400).json({ error: error.message });
    }
  });

  // Root Health Checks (for Railway visibility)
  app.get('/', (req, res) => res.json({ status: 'ok', message: 'MarkAI API is running' }));
  app.get('/health', (req, res) => res.json({ status: 'healthy', timestamp: new Date().toISOString() }));

  // Temporary Debug Route: Confirm DB connectivity/User counts
  app.get('/api/debug/db-status', async (req, res) => {
    try {
      const userCount = await (prisma as any).user.count();
      res.json({ 
        status: 'connected', 
        userCount, 
        databaseUrlHash: process.env.DATABASE_URL?.substring(0, 30) + '...'
      });
    } catch (error: any) {
      res.status(500).json({ status: 'error', message: error.message });
    }
  });

  app.post('/api/auth/login', authLimiter, async (req, res) => {
    try {
      const { email, password } = loginSchema.parse(req.body);
      const user = await (prisma as any).user.findUnique({ where: { email } });
      if (!user) return res.status(401).json({ error: 'Invalid credentials' });

      const isValid = await bcrypt.compare(password, user.password);
      if (!isValid) return res.status(401).json({ error: 'Invalid credentials' });

      const token = jwt.sign(
        { id: user.id, email: user.email, userType: user.userType },
        process.env.JWT_SECRET!,
        { expiresIn: '7d' }
      );
      res.json({ 
        user: { 
          id: user.id, 
          email: user.email, 
          fullName: user.fullName, 
          userType: user.userType, 
          studentCode: user.studentCode,
          avatarUrl: user.avatarUrl,
          phoneNumber: user.phoneNumber,
          location: user.location,
          bio: user.bio,
          verified: user.verified,
          proPlan: user.proPlan,
          department: user.department,
          role: user.role,
          twoFactorAuth: user.twoFactorAuth,
          emailAlerts: user.emailAlerts
        }, 
        token 
      });
    } catch (error: any) {
      res.status(400).json({ error: error.errors || error.message });
    }
  });

  app.post('/api/auth/forgot-password', async (req, res) => {
    const { email } = req.body;
    try {
      const user = await (prisma as any).user.findUnique({ where: { email } });
      if (user) {
        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        await (prisma as any).passwordReset.create({
          data: {
            email,
            otp,
            expiresAt: new Date(Date.now() + 15 * 60 * 1000)
          }
        });
        await resend.emails.send({
          from: 'MarkAI <noreply@markai.edu>',
          to: email,
          subject: 'Your MarkAI Password Reset OTP',
          text: `Your OTP is: ${otp}. It expires in 15 minutes.`
        });
      }
      res.json({ message: 'OTP sent if email exists' });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post('/api/auth/reset-password', async (req, res) => {
    const { email, otp, newPassword } = req.body;
    try {
      const reset = await (prisma as any).passwordReset.findFirst({
        where: { email, otp, expiresAt: { gt: new Date() } }
      });
      if (!reset) return res.status(400).json({ error: 'Invalid or expired OTP' });

      const hashedPassword = await bcrypt.hash(newPassword, 12);
      await (prisma as any).user.update({
        where: { email },
        data: { password: hashedPassword }
      });
      await (prisma as any).passwordReset.delete({ where: { id: reset.id } });
      res.json({ message: 'Password reset successful' });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.patch('/api/auth/change-password', authMiddleware, async (req, res) => {
    const { currentPassword, newPassword } = req.body;
    try {
      const user = await (prisma as any).user.findUnique({ where: { id: req.user.id } });
      const isValid = await bcrypt.compare(currentPassword, user!.password);
      if (!isValid) return res.status(401).json({ error: 'Incorrect current password' });
      
      const hashedPassword = await bcrypt.hash(newPassword, 12);
      await (prisma as any).user.update({
        where: { id: req.user.id },
        data: { password: hashedPassword }
      });
      res.json({ message: 'Password changed successfully' });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get('/api/auth/me', authMiddleware, async (req, res) => {
    try {
      const user = await (prisma as any).user.findUnique({ where: { id: req.user.id } });
      if (!user) return res.status(404).json({ error: 'User not found' });
      
      const { password, ...safeUser } = user;
      res.json(safeUser);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Removed redundant profile routes (moved to src/routes/profile.ts)

  app.patch('/api/auth/settings', authMiddleware, async (req, res) => {
    try {
      const data = settingsUpdateSchema.parse(req.body);
      const updatedUser = await (prisma as any).user.update({
        where: { id: req.user.id },
        data
      });
      const { password, ...safeUser } = updatedUser;
      res.json(safeUser);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  app.post('/api/auth/avatar', authMiddleware, upload.single('file'), async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
      
      // Upload to Supabase Storage
      const fileName = `avatars/${req.user.id}_${Date.now()}.pdf`; // Reusing PDF bucket or creating new one?
      // Actually, let's use a separate logic for images if possible, but the existing uploadPdfToSupabase works for buffers.
      // Let's assume we have a 'profiles' bucket.
      const { data, error } = await supabase.storage
        .from('profiles')
        .upload(fileName, req.file.buffer, {
          contentType: req.file.mimetype,
          upsert: true
        });

      if (error) throw error;

      const { data: { publicUrl } } = supabase.storage
        .from('profiles')
        .getPublicUrl(fileName);

      const updatedUser = await (prisma as any).user.update({
        where: { id: req.user.id },
        data: { avatarUrl: publicUrl }
      });

      res.json({ avatarUrl: publicUrl });
    } catch (error: any) {
      logger.error('Avatar upload failed:', error);
      res.status(500).json({ error: error.message });
    }
  });

  app.post('/api/feedback', authMiddleware, async (req, res) => {
    try {
      const { rating, quote } = feedbackSchema.parse(req.body);
      // For now, we'll just log it or send an email. The user requested "must save feedback to database or send via email".
      // I'll send an email for now as there's no Feedback model in schema.prisma.
      await resend.emails.send({
        from: 'MarkAI Feedback <feedback@markai.edu>',
        to: 'admin@admin.edu',
        subject: `New Feedback from ${req.user.email}`,
        text: `Rating: ${rating}/5\n\nFeedback: ${quote}`
      });
      res.json({ message: 'Feedback submitted successfully' });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  app.post('/api/billing/upgrade', authMiddleware, async (req, res) => {
    try {
      // Mock upgrade logic: simply set proPlan to true
      const updatedUser = await (prisma as any).user.update({
        where: { id: req.user.id },
        data: { proPlan: true }
      });
      res.json({ message: 'Upgraded to Pro successfully', proPlan: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  const KNOWN_SCAN_APP_WATERMARKS = [
    'camscanner', 'adobe scan', 'microsoft lens', 'office lens',
    'genius scan', 'scanner pro', 'tiny scanner', 'notes scanner',
    'scanned with', 'scanned by', 'created with camscanner'
  ];

  function assessExtractionQuality(text: string): {
    isLikelyJunk: boolean;
    reason: string | null;
  } {
    if (!text || text.trim().length === 0) {
      return { isLikelyJunk: true, reason: 'No text extracted at all' };
    }

    const trimmed = text.trim();
    const lowerText = trimmed.toLowerCase();

    // Check 1: Matches a known scanning-app watermark with little else around it
    const matchedWatermark = KNOWN_SCAN_APP_WATERMARKS.find(w => lowerText.includes(w));
    if (matchedWatermark) {
      // Strip out the watermark occurrences and see what's actually left
      const withoutWatermark = lowerText.split(matchedWatermark).join('').trim();
      if (withoutWatermark.length < 30) {
        return {
          isLikelyJunk: true,
          reason: `Extracted text appears to be just a scanning app watermark ("${matchedWatermark}") with no actual answer content`
        };
      }
    }

    // Check 2: High repetition — same short line repeated many times
    // (e.g. "CamScanner\nCamScanner\nCamScanner\nCamScanner")
    const lines = trimmed.split(/[\n\r]+/).map(l => l.trim()).filter(l => l.length > 0);
    if (lines.length >= 3) {
      const uniqueLines = new Set(lines);
      const repetitionRatio = 1 - (uniqueLines.size / lines.length);
      const avgLineLength = lines.reduce((s, l) => s + l.length, 0) / lines.length;

      if (repetitionRatio > 0.6 && avgLineLength < 25) {
        return {
          isLikelyJunk: true,
          reason: `Extracted text is mostly repeated short lines (${uniqueLines.size} unique out of ${lines.length} lines) — likely a watermark or scan artifact, not handwritten answers`
        };
      }
    }

    // Check 3: Suspiciously short for a real answer sheet
    if (trimmed.length < 20) {
      return {
        isLikelyJunk: true,
        reason: 'Extracted text is too short to be a real answer sheet'
      };
    }

    return { isLikelyJunk: false, reason: null };
  }

  app.post('/api/upload/answer-pdf', authMiddleware, upload.single('file'), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
      }

      const allowedTypes = ['application/pdf', 'image/jpeg', 'image/jpg', 'image/png'];
      if (!allowedTypes.includes(req.file.mimetype)) {
        return res.status(400).json({ error: 'Only PDF, JPG, or PNG files are allowed' });
      }

      // Create a job record immediately and respond
      const job = await (prisma as any).uploadJob.create({
        data: {
          status: 'PENDING',
          filename: req.file.originalname
        }
      });

      // Respond IMMEDIATELY
      res.json({
        jobId: job.id,
        status: 'PENDING',
        message: 'Upload received, processing started'
      });

      // Background process (after response)
      (async () => {
        try {
          await (prisma as any).uploadJob.update({
            where: { id: job.id },
            data: { status: 'PROCESSING' }
          });

          const isImage = req.file!.mimetype.startsWith('image/');
          const isPdf = req.file!.mimetype === 'application/pdf';

          let extractedText = '';
          let method = '';

          if (isPdf) {
            method = 'pdf-parse';
            try {
              const pdfData = await pdf(req.file!.buffer);
              extractedText = pdfData.text?.trim() || '';
              extractedText = extractedText
                .replace(/\r\n/g, '\n')
                .replace(/\r/g, '\n')
                .replace(/\n{3,}/g, '\n\n')
                .replace(/(\s)(Q\.?\s*\d+|Question\s*\d+|\d+\s*\.)/g, '\n$2')
                .trim();
            } catch (e) {
              logger.error('pdf-parse failed:', e);
            }
          }

          if (isImage || extractedText.length < 50) {
            method = isImage ? 'gemini-vision-image' : 'gemini-vision';
            logger.info(`Handwriting detected for job ${job.id} (${req.file!.originalname}), attempting Gemini OCR...`);

            // File size check before sending to Gemini
            const fileSizeMB = req.file!.buffer.length / 1024 / 1024;
            if (fileSizeMB > 15) {
              logger.warn(`File too large for inline Gemini Vision: ${fileSizeMB.toFixed(2)}MB`);
              await (prisma as any).uploadJob.update({
                where: { id: job.id },
                data: {
                  status: 'ERROR',
                  errorMessage: `File is too large (${fileSizeMB.toFixed(1)}MB) for AI processing. Please upload a PDF under 15MB.`,
                  completedAt: new Date()
                }
              });
              return;
            }

            const ocrPrompt = `
Transcribe ALL handwritten or printed answer content from this exam answer sheet image with complete accuracy.

IMPORTANT — IGNORE THE FOLLOWING, they are not part of the student's answers:
- Scanning app watermarks or branding (e.g. "CamScanner", "Adobe Scan", "Microsoft Lens", page borders/logos added by scanning apps)
- Page numbers, headers, or footers added by the scanning software itself
- Any text that is clearly an app UI element rather than something the student wrote

Focus ONLY on the student's actual handwritten or written answer content for each question.

If after ignoring watermarks and app branding there is genuinely no answer content
visible on this page (e.g. it's a blank page, a cover page, or only contains a
scanning app watermark with nothing else), respond with exactly: UNREADABLE_DOCUMENT

Format your response as:
Q1: [transcribed answer]
Q2: [transcribed answer]
... (continue for all visible questions)`;

            try {
              const { text, wasCached } = await getOrCreateOcrResult(
                req.file!.buffer,
                ocrPrompt,
                req.file!.mimetype,
                `OCR-${req.file!.originalname}`
              );

              if (!text || text === 'UNREADABLE_DOCUMENT') {
                await (prisma as any).uploadJob.update({
                  where: { id: job.id },
                  data: {
                    status: 'ERROR',
                    errorMessage: 'The image could not be read clearly. Please retake the photo with better lighting, or try uploading as PDF.',
                    completedAt: new Date()
                  }
                });
                return;
              }

              // NEW — catch watermark/junk extractions before they're treated as real answers
              const quality = assessExtractionQuality(text);
              if (quality.isLikelyJunk) {
                logger.warn(`OCR quality check FAILED for job ${job.id} (${req.file!.originalname}): ${quality.reason}. Raw extracted text: "${text.substring(0, 200)}"`);
                await (prisma as any).uploadJob.update({
                  where: { id: job.id },
                  data: {
                    status: 'ERROR',
                    errorMessage: `This file appears to only contain a scanning app watermark, not the actual answers (extracted: "${text.substring(0, 60)}${text.length > 60 ? '...' : ''}"). Please check the file has the actual handwritten pages, or type the answer manually.`,
                    completedAt: new Date()
                  }
                });
                return;
              }

              extractedText = text;
              if (wasCached) {
                method += '-cached';
              }
              logger.info(`Gemini OCR succeeded for job ${job.id}: ${extractedText.length} chars (wasCached: ${wasCached})`);

            } catch (geminiError: any) {
              logger.error(`Gemini OCR failed for job ${job.id}:`, geminiError.message);
              throw geminiError;
            }
          }

          const pdfFilePath = await uploadPdfToSupabase(req.file!.buffer, req.file!.originalname, 'answers');
          const textFilePath = await uploadTextToSupabase(extractedText, req.file!.originalname, 'texts');

          await (prisma as any).uploadJob.update({
            where: { id: job.id },
            data: {
              status: 'COMPLETE',
              extractedText,
              method,
              fileUrl: pdfFilePath,
              textUrl: textFilePath,
              fileType: isImage ? 'image' : 'pdf',
              completedAt: new Date()
            }
          });

          logger.info(`Upload job ${job.id} complete: ${method}`);

        } catch (error: any) {
          const isDailyQuota = error.isDailyQuota === true;
          const isRateLimit = !isDailyQuota && (
            error.message?.includes('429') || 
            error.message?.includes('RESOURCE_EXHAUSTED') ||
            error.message?.includes('503') ||
            error.message?.includes('UNAVAILABLE') ||
            error.message?.includes('experiencing high demand') ||
            error.message?.includes('temporary')
          );

          logger.error(`Upload job ${job.id} failed:`, { message: error.message, isDailyQuota, isRateLimit });

          await (prisma as any).uploadJob.update({
            where: { id: job.id },
            data: {
              status: 'ERROR',
              errorMessage: isDailyQuota
                ? 'Daily AI quota reached. This resets at midnight Pacific Time — please type answers manually for now.'
                : isRateLimit
                ? 'AI is currently busy. Please wait before retrying, or type the answer manually.'
                : error.message,
              retryAfterSeconds: isDailyQuota ? null : (isRateLimit ? 65 : null), // null = no retry timer, manual only
              completedAt: new Date()
            }
          });
        }
      })();

    } catch (error: any) {
      logger.error('Upload route error:', error);
      res.status(500).json({ error: error.message });
    }
  });

  app.get('/api/upload/status/:jobId', authMiddleware, async (req, res) => {
    try {
      const job = await (prisma as any).uploadJob.findUnique({
        where: { id: req.params.jobId }
      });

      if (!job) {
        return res.status(404).json({ error: 'Job not found' });
      }

      res.json({
        jobId: job.id,
        status: job.status,
        text: job.extractedText,
        method: job.method,
        fileUrl: job.fileUrl,
        textUrl: job.textUrl,
        fileType: job.fileType,
        error: job.errorMessage,
        retryAfterSeconds: job.retryAfterSeconds,
        allowManualEntry: job.status === 'ERROR'
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get('/api/files/signed-url', authMiddleware, async (req, res) => {
    try {
      const { key } = req.query;
      if (!key) return res.status(400).json({ error: 'File key required' });
      const url = await getSignedFileUrl(key as string);
      res.json({ url });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get('/api/sessions', authMiddleware, async (req, res) => {
    try {
      const { page = 1, limit = 10, status, subject, sort = 'createdAt_desc' } = req.query;
      const skip = (Number(page) - 1) * Number(limit);
      const [field, order] = (sort as string).split('_');

      const where: any = { lecturerId: req.user.id };
      if (status) where.status = status;
      if (subject) where.subject = subject;

      const data = await (prisma as any).markingSession.findMany({
        where, skip, take: Number(limit),
        orderBy: { [field]: order as any },
        include: { _count: { select: { results: true, answerSheets: true } } }
      });
      const total = await (prisma as any).markingSession.count({ where });

      res.json({ data, total, page: Number(page), totalPages: Math.ceil(total / Number(limit)) });
    } catch (error: any) {
      logger.error('Failed to fetch sessions:', error.message);
      res.status(500).json({ error: 'Failed to fetch sessions' });
    }
  });

  app.post('/api/sessions', authMiddleware, requireLecturer, async (req: any, res) => {
    try {
      logger.info('Received session creation request:', { body: req.body, user: req.user });
      const data = sessionSchema.parse(req.body);
      const session = await (prisma as any).markingSession.create({
        data: { 
          ...data, 
          paperType: (data as any).paperType || 'Theory',
          classId: (data.classId && data.classId.trim() !== '' && data.classId !== 'undefined' && data.classId !== 'null') ? data.classId : null,
          questionTextUrl: (data.questionTextUrl && data.questionTextUrl.trim() !== '') ? data.questionTextUrl : null,
          markSchemeTextUrl: (data.markSchemeTextUrl && data.markSchemeTextUrl.trim() !== '') ? data.markSchemeTextUrl : null,
          lecturerId: req.user.id, 
          status: data.status || 'PENDING' 
        }
      });
      logger.info(`Session created: ${session.id}, questionTextUrl: ${session.questionTextUrl}, markSchemeTextUrl: ${session.markSchemeTextUrl}`);
      res.status(201).json(session);
    } catch (error: any) {
      res.status(400).json({ error: error.errors || error.message });
    }
  });

  app.patch('/api/sessions/:id', authMiddleware, requireLecturer, async (req: any, res) => {
    const { id } = req.params;
    try {
      const session = await (prisma as any).markingSession.update({
        where: { id },
        data: {
          questionPdfUrl: req.body.questionPdfUrl,
          markSchemePdfUrl: req.body.markSchemePdfUrl,
          questionTextUrl: req.body.questionTextUrl,
          markSchemeTextUrl: req.body.markSchemeTextUrl,
          markingStrictness: req.body.markingStrictness,
          feedbackDetail: req.body.feedbackDetail,
          status: req.body.status
        }
      });
      logger.info(`Session ${id} updated: questionTextUrl: ${session.questionTextUrl}, markSchemeTextUrl: ${session.markSchemeTextUrl}`);
      res.json(session);
    } catch (error: any) {
      logger.error(`Failed to update session ${id}:`, error.message);
      res.status(500).json({ error: 'Failed to update session' });
    }
  });

  app.post('/api/sessions/:id/upload-question-paper', authMiddleware, async (req: any, res) => {
    try {
      const { id } = req.params;
      const { fileUrl, textUrl, text } = req.body;

      await (prisma as any).markingSession.update({
        where: { id },
        data: {
          questionTextUrl: textUrl,
          questionPdfUrl: fileUrl
        }
      });

      logger.info(`Session ${id}: questionTextUrl committed to DB: ${textUrl}`);
      res.json({ fileUrl, textUrl, text });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post('/api/sessions/:id/answer-sheets', authMiddleware, requireLecturer, async (req, res) => {
    try {
      const { id } = req.params;
      const { students } = req.body;

      if (!Array.isArray(students) || students.length === 0) {
        return res.status(400).json({ error: 'No student answer sheets provided' });
      }

      // DIAGNOSTIC — log exactly what the backend received
      logger.info(`Received ${students.length} answer sheets for session ${id}`);
      students.forEach((s: any) => {
        logger.info(`Student ${s.studentId}: extractedText length = ${(s.extractedText || '').length}, preview = "${(s.extractedText || '').substring(0, 80)}"`);
      });

      // VALIDATION — reject the whole request if any student has empty text,
      // instead of silently saving blank answer sheets that will later show
      // "no answer detected" for every question
      const emptyTextStudents = students.filter(
        (s: any) => !s.extractedText || s.extractedText.trim().length < 5
      );

      if (emptyTextStudents.length > 0) {
        const ids = emptyTextStudents.map((s: any) => s.studentId).join(', ');
        logger.error(`Rejecting save — empty extractedText for students: ${ids}`);
        return res.status(400).json({
          error: `These students have no extracted text and would be marked as unanswered: ${ids}. Please re-upload their answer sheets.`,
          emptyStudentIds: emptyTextStudents.map((s: any) => s.studentId)
        });
      }

      const created = await (prisma as any).studentAnswerSheet.createMany({
        data: students.map((s: any) => ({
          sessionId: id,
          studentId: s.studentId && s.studentId.trim() !== '' 
            ? s.studentId 
            : `TEMP_${Math.random().toString(36).substr(2, 9)}`,
          studentName: s.studentName || s.studentId || 'Unknown Student',
          pdfUrl: s.pdfUrl || '',
          textUrl: s.textUrl || null,
          extractedText: s.extractedText,
          extractMethod: s.extractMethod || 'unknown',
          status: 'PENDING'
        })),
        skipDuplicates: true
      });

      // VERIFY what actually landed in the database immediately after saving
      const saved = await (prisma as any).studentAnswerSheet.findMany({
        where: { sessionId: id },
        select: { studentId: true, extractedText: true }
      });
      saved.forEach(s => {
        logger.info(`VERIFIED in DB — ${s.studentId}: extractedText length = ${s.extractedText?.length || 0}`);
      });

      res.json({ saved: created.count, students: saved });

    } catch (error: any) {
      logger.error('Save answer sheets error:', error);
      
      // Handle the case where the table doesn't exist (P2021)
      if (error.code === 'P2021') {
        return res.status(500).json({ 
          error: 'Database tables are missing.',
          details: 'Please run the manual_db_fix.sql script in your Supabase SQL Editor to create the required tables.',
          technical: error.message
        });
      }

      res.status(400).json({ 
        error: error.message,
        details: error.code === 'P2002' ? 'Duplicate student ID detected' : undefined
      });
    }
  });

  app.get('/api/sessions/:id', authMiddleware, async (req, res) => {
    try {
      const session = await (prisma as any).markingSession.findUnique({
        where: { id: req.params.id }
      });
      if (!session) return res.status(404).json({ error: 'Session not found' });
      res.json(session);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post('/api/sessions/:id/parse-paper', authMiddleware, requireLecturer, async (req, res) => {
    try {
      const { id } = req.params;
      const session = await (prisma as any).markingSession.findUnique({ where: { id } });

      if (!session) {
        return res.status(404).json({ error: 'Session not found' });
      }

      // GUARD — if textUrl isn't in DB yet, the upload hasn't committed fully
      if (!session.questionTextUrl || !session.markSchemeTextUrl) {
        logger.error(`Session ${id} parse-paper called but textUrls not in DB yet. questionTextUrl=${session.questionTextUrl}, markSchemeTextUrl=${session.markSchemeTextUrl}`);
        return res.status(400).json({
          error: 'Question paper or mark scheme text is not ready yet. Please wait a moment and try again.',
          retryable: true
        });
      }

      // If already parsed and locked, return the existing structure — never re-parse silently
      if (session.parsedQuestions && session.parsedMarkScheme) {
        return res.json({
          questions: session.parsedQuestions,
          markScheme: session.parsedMarkScheme,
          totalMaxMarks: session.totalMaxMarks,
          alreadyParsed: true
        });
      }

      const questionPdfText = session.questionTextUrl
        ? await downloadTextFromSupabase(session.questionTextUrl)
        : '';
      const markSchemeText = session.markSchemeTextUrl
        ? await downloadTextFromSupabase(session.markSchemeTextUrl)
        : '';

      if (!questionPdfText || !markSchemeText) {
        return res.status(400).json({ error: 'Question paper or mark scheme text missing.' });
      }

      const { questions: parsedQuestions, markScheme: parsedMarkScheme } = 
        await parseQuestionPaperAndMarkScheme(questionPdfText, markSchemeText);

      if (!parsedQuestions || parsedQuestions.length === 0) {
        const rawTextLength = questionPdfText?.length || 0;
        const likelyReason = rawTextLength < 100
          ? 'The question paper PDF appears to contain no extractable text — it may be a scanned image-only PDF. Try uploading a text-based PDF instead.'
          : 'The AI could not identify a question structure in the extracted text. Check that the uploaded file is the question paper and not another document.';

        logger.error(`Session ${id}: parse returned 0 questions. Raw text length: ${rawTextLength}`);
        logger.error(`Raw text preview: "${questionPdfText?.substring(0, 300)}"`);

        return res.status(400).json({
          error: likelyReason,
          needsManualMarks: false,
          questions: [],
          rawTextLength,
          rawTextPreview: questionPdfText?.substring(0, 200)
        });
      }

      const totalMaxMarks = parsedQuestions.reduce(
        (sum: number, q: any) => sum + (Number(q.marksAvailable) || 0), 0
      );

      if (totalMaxMarks === 0) {
        logger.error(`Session ${id} parsed with 0 total marks across ${parsedQuestions.length} questions. Refusing to lock this structure.`);
        return res.status(400).json({
          error: `The AI could not detect mark values for any of the ${parsedQuestions.length} questions found. This usually means the marks aren't clearly visible as text in the uploaded PDF. Please check the question paper format, or manually enter mark values below.`,
          questions: parsedQuestions,
          needsManualMarks: true
        });
      }

      // VALIDATION — try to find a stated total in the raw text and compare
      const statedTotalMatch = questionPdfText.match(/total[:\s]*(\d+)\s*marks?/i) ||
                                questionPdfText.match(/\/(\d+)\s*$/m);
      const statedTotal = statedTotalMatch ? parseInt(statedTotalMatch[1], 10) : null;
      const mismatchWarning = statedTotal && statedTotal !== totalMaxMarks
        ? `Warning: extracted total (${totalMaxMarks}) does not match stated total (${statedTotal}) in the document. Please review before proceeding.`
        : null;

      // LOCK the structure permanently on this session
      await (prisma as any).markingSession.update({
        where: { id },
        data: {
          parsedQuestions,
          parsedMarkScheme,
          totalMaxMarks,
          parsingVerified: false
        }
      });

      logger.info(`Session ${id} paper parsed and LOCKED. Total marks: ${totalMaxMarks}${mismatchWarning ? ' — MISMATCH DETECTED' : ''}`);

      res.json({
        questions: parsedQuestions,
        markScheme: parsedMarkScheme,
        totalMaxMarks,
        mismatchWarning,
        alreadyParsed: false
      });

    } catch (error: any) {
      logger.error('Parse paper error:', error);
      res.status(500).json({ error: error.message });
    }
  });

  app.post('/api/sessions/:id/confirm-manual-marks', authMiddleware, async (req, res) => {
    try {
      const { id } = req.params;
      const { questions } = req.body;

      const totalMaxMarks = questions.reduce((s: number, q: any) => s + (Number(q.marksAvailable) || 0), 0);

      await (prisma as any).markingSession.update({
        where: { id },
        data: { parsedQuestions: questions, totalMaxMarks, parsingVerified: true }
      });

      logger.info(`Session ${id} locked with MANUALLY entered marks. Total: ${totalMaxMarks}`);
      res.json({ totalMaxMarks });
    } catch (error: any) {
      logger.error('Confirm manual marks error:', error);
      res.status(500).json({ error: error.message });
    }
  });

  app.get('/api/sessions/:id/answer-sheets', authMiddleware, async (req, res) => {
    try {
      const sheets = await (prisma as any).studentAnswerSheet.findMany({ where: { sessionId: req.params.id } });
      res.json(sheets);
    } catch (error: any) {
      logger.error('Failed to fetch answer sheets:', error.message);
      res.status(500).json({ error: 'Failed to fetch answer sheets' });
    }
  });

  app.post('/api/sessions/:id/mark', authMiddleware, requireLecturer, async (req, res) => {
    const { id } = req.params;

    console.log('🚀 MARK ENDPOINT HIT — session:', id);
    console.log('👤 User:', req.user?.id);

    try {
      // Fetch session from Supabase PostgreSQL via Prisma
      const session = await (prisma as any).markingSession.findUnique({
        where: { id },
        include: { answerSheets: true }
      });

      console.log('📋 Session found:', !!session);
      console.log('📁 Submissions count:', session?.answerSheets?.length);

      if (!session) {
        return res.status(404).json({ error: 'Session not found' });
      }

      // Get question paper text from Supabase Storage
      let questionPdfText = '';
      let markSchemeText = '';

      // --- Load Question Paper Text ---
      if (session.questionTextUrl) {
        try {
          questionPdfText = await downloadTextFromSupabase(session.questionTextUrl);
          logger.info(`Question paper text loaded from Supabase Storage (${questionPdfText.length} chars)`);
        } catch (e) {
          logger.error('Failed to load question paper text from Supabase:', e);
        }
      }

      if (!questionPdfText && req.body.questionPdfText) {
        questionPdfText = req.body.questionPdfText;
        logger.warn('Using question paper text from request body fallback');
      }

      if ((!questionPdfText || questionPdfText.trim().length < 10) && session.questionPdfUrl) {
        logger.info('Attempting to re-extract question paper from stored PDF...');
        try {
          const { data: pdfData, error: dlErr } = await supabase.storage.from('markai-pdfs').download(session.questionPdfUrl);
          if (!dlErr && pdfData) {
            const buffer = Buffer.from(await pdfData.arrayBuffer());
            try {
              const parsed = await pdf(buffer);
              questionPdfText = parsed.text?.trim() || '';
            } catch (e) { /* pdf-parse failed */ }
            if (questionPdfText.length < 50) {
              const base64 = buffer.toString('base64');
              const resp = await callGeminiSafe(
                [{ parts: [{ inlineData: { data: base64, mimeType: 'application/pdf' } }, { text: 'Extract ALL text from this exam question paper. Preserve question numbers and marks. Return only the text content.' }] }],
                { context: 'reextract-question-paper' }
              );
              questionPdfText = resp.text?.trim() || '';
            }
            if (questionPdfText.length >= 10) {
              logger.info(`Re-extracted question paper text (${questionPdfText.length} chars)`);
              try {
                const textPath = await uploadTextToSupabase(questionPdfText, 'question-reextract', 'texts');
                await (prisma as any).markingSession.update({ where: { id }, data: { questionTextUrl: textPath } });
              } catch (e) { /* non-critical */ }
            }
          }
        } catch (e: any) {
          logger.error('Re-extraction of question paper failed:', e.message);
        }
      }

      // --- Load Mark Scheme Text ---
      if (session.markSchemeTextUrl) {
        try {
          markSchemeText = await downloadTextFromSupabase(session.markSchemeTextUrl);
          logger.info(`Mark scheme text loaded from Supabase Storage (${markSchemeText.length} chars)`);
        } catch (e: any) {
          logger.error(`Failed to load mark scheme text:`, e);
        }
      }

      if (!markSchemeText && req.body.markSchemeText) {
        markSchemeText = req.body.markSchemeText;
        logger.warn('Using mark scheme text from request body fallback');
      }

      if ((!markSchemeText || markSchemeText.trim().length < 10) && session.markSchemePdfUrl) {
        logger.info('Attempting to re-extract mark scheme from stored PDF...');
        try {
          const { data: pdfData, error: dlErr } = await supabase.storage.from('markai-pdfs').download(session.markSchemePdfUrl);
          if (!dlErr && pdfData) {
            const buffer = Buffer.from(await pdfData.arrayBuffer());
            try {
              const parsed = await pdf(buffer);
              markSchemeText = parsed.text?.trim() || '';
            } catch (e) { /* pdf-parse failed */ }
            if (markSchemeText.length < 50) {
              const base64 = buffer.toString('base64');
              const resp = await callGeminiSafe(
                [{ parts: [{ inlineData: { data: base64, mimeType: 'application/pdf' } }, { text: 'Extract ALL text from this mark scheme. Preserve question numbers, accepted answers, marks, and marking guidance. Return only the text content.' }] }],
                { context: 'reextract-mark-scheme' }
              );
              markSchemeText = resp.text?.trim() || '';
            }
            if (markSchemeText.length >= 10) {
              logger.info(`Re-extracted mark scheme text (${markSchemeText.length} chars)`);
              try {
                const textPath = await uploadTextToSupabase(markSchemeText, 'markscheme-reextract', 'texts');
                await (prisma as any).markingSession.update({ where: { id }, data: { markSchemeTextUrl: textPath } });
              } catch (e) { /* non-critical */ }
            }
          }
        } catch (e: any) {
          logger.error('Re-extraction of mark scheme failed:', e.message);
        }
      }

      // Validate both texts exist
      if (!questionPdfText || questionPdfText.trim().length < 10) {
        logger.error(`Question paper text validation failed for session ${id}. Length: ${questionPdfText?.length || 0}`);
        return res.status(400).json({
          error: 'Question paper text missing or too short. Please re-upload the question paper.',
          details: `Text length: ${questionPdfText?.length || 0}`
        });
      }

      if (!markSchemeText || markSchemeText.trim().length < 10) {
        logger.error(`Mark scheme text validation failed for session ${id}. Length: ${markSchemeText?.length || 0}`);
        return res.status(400).json({
          error: 'Mark scheme text missing or too short. Please re-upload the mark scheme.',
          details: `Text length: ${markSchemeText?.length || 0}`
        });
      }

      // Fetch all pending or errored student answer sheets for marking
      const answerSheets = await (prisma as any).studentAnswerSheet.findMany({
        where: { 
          sessionId: id, 
          status: { in: ['PENDING', 'ERROR'] } 
        }
      });

      if (!answerSheets || answerSheets.length === 0) {
        logger.error(`No pending or errored answer sheets found for session ${id}`);
        return res.status(400).json({
          error: 'No valid student answer sheets found. Please upload answer sheets first.',
          details: `Session ID: ${id}`
        });
      }
      
      logger.info(`Starting marking process for ${answerSheets.length} students in session ${id}`);

      // Update session status in Supabase PostgreSQL
      await (prisma as any).markingSession.update({
        where: { id },
        data: { status: 'MARKING', errorMessage: null }
      });

      // Send immediate response so frontend can poll progress
      res.json({
        message: 'Marking started',
        total: answerSheets.length,
        status: 'MARKING'
      });

      // Trigger background marking pipeline (fire and forget)
      triggerBackgroundMarking(id, questionPdfText, markSchemeText);

    } catch (error: any) {
      logger.error('Marking route error:', error);
      res.status(500).json({ error: error.message });
    }
  });

  async function triggerBackgroundMarking(id: string, initialQuestionText?: string, initialMarkSchemeText?: string) {
    let completed = 0;
    const errors: string[] = [];

    try {
      logger.info(`═══ MARKING STARTED for session ${id} ═══`);

      const session = await (prisma as any).markingSession.findUnique({
        where: { id },
        include: { answerSheets: true }
      });

      if (!session) {
        throw new Error(`Session ${id} not found.`);
      }

      if (!session.parsedQuestions || !session.parsedMarkScheme) {
        throw new Error('Session has no locked question structure. Paper must be parsed before marking.');
      }

      const parsedQuestions = session.parsedQuestions as any[];
      const parsedMarkScheme = session.parsedMarkScheme as any[];

      const answerSheets = await (prisma as any).studentAnswerSheet.findMany({
        where: {
          sessionId: id,
          status: { in: ['PENDING', 'ERROR'] }
        }
      });

      logger.info(`Found ${answerSheets.length} answer sheets to mark in session ${id}`);
      if (answerSheets.length === 0) {
        logger.info(`No pending/errored answer sheets for session ${id}. Marking finished.`);
        await (prisma as any).markingSession.update({
          where: { id },
          data: { status: 'REVIEW_REQUIRED' }
        });
        return;
      }

      // Initialize progress tracker
      markingProgress.set(id, {
        total: answerSheets.length,
        completed: 0,
        currentStudentId: '',
        currentStudentName: '',
        status: 'MARKING',
        estimatedSecondsRemaining: answerSheets.length * 30
      });

      let questionPdfText = initialQuestionText || '';
      let markSchemeText = initialMarkSchemeText || '';

      if (!questionPdfText && session.questionTextUrl) {
        try {
          questionPdfText = await downloadTextFromSupabase(session.questionTextUrl);
          logger.info(`Question paper text loaded from Supabase Storage (${questionPdfText.length} chars)`);
        } catch (e) {
          logger.error('Failed to load question paper text from Supabase:', e);
        }
      }

      if (!questionPdfText && session.questionPdfUrl) {
        logger.info('Attempting to re-extract question paper from stored PDF...');
        try {
          const { data: pdfData, error: dlErr } = await supabase.storage.from('markai-pdfs').download(session.questionPdfUrl);
          if (!dlErr && pdfData) {
            const buffer = Buffer.from(await pdfData.arrayBuffer());
            try {
              const parsed = await pdf(buffer);
              questionPdfText = parsed.text?.trim() || '';
            } catch (e) { /* pdf-parse failed */ }
            if (questionPdfText.length < 50) {
              const base64 = buffer.toString('base64');
              const resp = await callGeminiSafe(
                [{ parts: [{ inlineData: { data: base64, mimeType: 'application/pdf' } }, { text: 'Extract ALL text from this exam question paper. Preserve question numbers and marks. Return only the text content.' }] }],
                { context: 'reextract-question-paper' }
              );
              questionPdfText = resp.text?.trim() || '';
            }
            if (questionPdfText.length >= 10) {
              logger.info(`Re-extracted question paper text (${questionPdfText.length} chars)`);
              try {
                const textPath = await uploadTextToSupabase(questionPdfText, 'question-reextract', 'texts');
                await (prisma as any).markingSession.update({ where: { id }, data: { questionTextUrl: textPath } });
              } catch (e) { /* non-critical */ }
            }
          }
        } catch (e: any) {
          logger.error('Re-extraction of question paper failed:', e.message);
        }
      }

      if (!markSchemeText && session.markSchemeTextUrl) {
        try {
          markSchemeText = await downloadTextFromSupabase(session.markSchemeTextUrl);
          logger.info(`Mark scheme text loaded from Supabase Storage (${markSchemeText.length} chars)`);
        } catch (e: any) {
          logger.error(`Failed to load mark scheme text:`, e);
        }
      }

      if (!markSchemeText && session.markSchemePdfUrl) {
        logger.info('Attempting to re-extract mark scheme from stored PDF...');
        try {
          const { data: pdfData, error: dlErr } = await supabase.storage.from('markai-pdfs').download(session.markSchemePdfUrl);
          if (!dlErr && pdfData) {
            const buffer = Buffer.from(await pdfData.arrayBuffer());
            try {
              const parsed = await pdf(buffer);
              markSchemeText = parsed.text?.trim() || '';
            } catch (e) { /* pdf-parse failed */ }
            if (markSchemeText.length < 50) {
              const base64 = buffer.toString('base64');
              const resp = await callGeminiSafe(
                [{ parts: [{ inlineData: { data: base64, mimeType: 'application/pdf' } }, { text: 'Extract ALL text from this mark scheme. Preserve question numbers, accepted answers, marks, and marking guidance. Return only the text content.' }] }],
                { context: 'reextract-mark-scheme' }
              );
              markSchemeText = resp.text?.trim() || '';
            }
            if (markSchemeText.length >= 10) {
              logger.info(`Re-extracted mark scheme text (${markSchemeText.length} chars)`);
              try {
                const textPath = await uploadTextToSupabase(markSchemeText, 'markscheme-reextract', 'texts');
                await (prisma as any).markingSession.update({ where: { id }, data: { markSchemeTextUrl: textPath } });
              } catch (e) { /* non-critical */ }
            }
          }
        } catch (e: any) {
          logger.error('Re-extraction of mark scheme failed:', e.message);
        }
      }

      if (!questionPdfText || questionPdfText.trim().length < 10) {
        throw new Error('Question paper text is missing or too short.');
      }

      if (!markSchemeText || markSchemeText.trim().length < 10) {
        throw new Error('Mark scheme text is missing or too short.');
      }

      const dbRetry = async (fn: () => Promise<any>, retries = 3, delay = 1000) => {
        for (let i = 0; i < retries; i++) {
          try {
            return await fn();
          } catch (err: any) {
            if (err.code === 'P2024' && i < retries - 1) {
              logger.warn(`Database connection busy, retrying in ${delay}ms... (Attempt ${i + 1}/${retries})`);
              await new Promise(r => setTimeout(r, delay));
              delay *= 2;
              continue;
            }
            throw err;
          }
        }
      };

      const limit = pLimit(3);
      await Promise.all(answerSheets.map((sheet: any) => limit(async () => {
        try {
          markingProgress.set(id, {
            total: answerSheets.length,
            completed,
            currentStudentId: sheet.studentId,
            currentStudentName: sheet.studentName || sheet.studentId,
            status: 'MARKING',
            estimatedSecondsRemaining: (answerSheets.length - completed) * 30
          });

          let studentAnswerText = sheet.extractedText;

          logger.info(`Student ${sheet.studentId} — extractedText from DB: length=${studentAnswerText?.length || 0}, preview="${(studentAnswerText || '').substring(0, 80)}"`);

          if (
            (!studentAnswerText || studentAnswerText.trim().length < 5) &&
            (sheet as any).textUrl
          ) {
            logger.warn(`Student ${sheet.studentId} — extractedText empty in DB, attempting Supabase Storage fallback from textUrl: ${(sheet as any).textUrl}`);
            try {
              studentAnswerText = await downloadTextFromSupabase(
                (sheet as any).textUrl
              );
              logger.info(`Student ${sheet.studentId} — fallback download succeeded: length=${studentAnswerText?.length || 0}`);
            } catch (e: any) {
              logger.error(
                `Student ${sheet.studentId} — fallback download FAILED:`, e.message
              );
            }
          }

          if (
            (!studentAnswerText || studentAnswerText.trim().length < 5) &&
            sheet.pdfUrl
          ) {
            logger.info(`Re-extracting answer text for ${sheet.studentId} from stored PDF...`);
            try {
              const { data: pdfData, error: dlErr } = await supabase.storage.from('markai-pdfs').download(sheet.pdfUrl);
              if (!dlErr && pdfData) {
                const buffer = Buffer.from(await pdfData.arrayBuffer());
                try {
                  const parsed = await pdf(buffer);
                  studentAnswerText = parsed.text?.trim() || '';
                } catch (e) { /* pdf-parse failed */ }
                if (!studentAnswerText || studentAnswerText.length < 50) {
                  const base64 = buffer.toString('base64');
                  const ocrResp = await callGeminiSafe(
                    [{ parts: [
                      { inlineData: { data: base64, mimeType: 'application/pdf' } },
                      { text: 'This is a student exam answer sheet. Transcribe ALL content. Preserve question numbers (Q1, 1a, etc). If handwritten, do your best to read it. Format: Q[number]:\n[answer]' }
                    ] }],
                    { context: `reextract-student-${sheet.studentId}` }
                  );
                  studentAnswerText = ocrResp.text?.trim() || '';
                }
                if (studentAnswerText.length >= 5) {
                  logger.info(`Re-extracted answer text for ${sheet.studentId} (${studentAnswerText.length} chars)`);
                  await (prisma as any).studentAnswerSheet.update({
                    where: { id: sheet.id },
                    data: { extractedText: studentAnswerText.substring(0, 50000) }
                  });
                }
              }
            } catch (e: any) {
              logger.error(`Re-extraction failed for ${sheet.studentId}:`, e.message);
            }
          }

          if (!studentAnswerText || studentAnswerText.trim().length < 5) {
            logger.error(`Student ${sheet.studentId} — NO ANSWER TEXT AVAILABLE. Skipping.`);
            await (prisma as any).studentAnswerSheet.update({
              where: { id: sheet.id },
              data: { status: 'SKIPPED', errorMessage: 'No extracted text available' }
            });
            completed++;
            return;
          }

          logger.info(`═══ PRE-MARKING CHECK for ${sheet.studentId} ═══`);
          logger.info(`studentAnswerText variable: length=${studentAnswerText?.length || 0}`);
          logger.info(`studentAnswerText preview: "${(studentAnswerText || '').substring(0, 200)}"`);
          logger.info(`Using locked questions: ${parsedQuestions?.length || 0} found`);
          logger.info(`Using locked mark scheme: ${parsedMarkScheme?.length || 0} found`);
          logger.info(`═══════════════════════════════════`);

          const markingResult = await markStudentAnswersWithConsensus(
            studentAnswerText,
            sheet.studentId,
            parsedQuestions,
            parsedMarkScheme,
            session
          );

          await dbRetry(() => (prisma as any).studentResult.upsert({
            where: { sessionId_studentId: { sessionId: id, studentId: sheet.studentId } },
            create: {
              sessionId: id,
              studentId: sheet.studentId,
              studentName: sheet.studentName,
              studentCode: sheet.studentId,
              answerPdfUrl: sheet.pdfUrl,
              totalMarks: markingResult.totalMarks,
              maxMarks: markingResult.maxMarks,
              percentage: markingResult.percentage,
              grade: markingResult.grade,
              reviewed: false,
              aiData: markingResult,
              questions: {
                create: markingResult.questions.map((q: any) => ({
                  questionNumber: String(q.questionNumber),
                  questionText: q.questionText || '',
                  topic: q.topic || 'General',
                  marksAwarded: Number(q.marksAwarded) || 0,
                  marksAvailable: Number(q.marksAvailable) || 0,
                  status: q.status || 'INCORRECT',
                  studentAnswer: q.studentAnswer || '',
                  expectedAnswer: q.expectedAnswer || '',
                  aiFeedback: q.aiFeedback || '',
                  lostMarksReason: q.lostMarksReason || null,
                  improvementSuggestion: q.improvementSuggestion || '',
                  aiConfidence: q.aiConfidence || 'High',
                  consensusNote: q.consensusNote || null
                }))
              }
            },
            update: {
              totalMarks: markingResult.totalMarks,
              maxMarks: markingResult.maxMarks,
              percentage: markingResult.percentage,
              grade: markingResult.grade,
              aiData: markingResult
            }
          }));

          await dbRetry(() => (prisma as any).studentAnswerSheet.update({
            where: { id: sheet.id },
            data: { status: 'MARKED' }
          }));

          completed++;

          logger.info(
            `✅ ${sheet.studentId}: ` +
            `${markingResult.totalMarks}/${markingResult.maxMarks} ` +
            `Grade ${markingResult.grade}`
          );

        } catch (studentError: any) {
          logger.error(`🚨 Marking FAILED for student ${sheet.studentId}:`, {
            message: studentError.message,
            stack: studentError.stack
          });
          errors.push(`${sheet.studentId}: ${studentError.message}`);

          await (prisma as any).studentAnswerSheet.update({
            where: { id: sheet.id },
            data: { status: 'ERROR', errorMessage: studentError.message }
          }).catch(() => {});

          completed++;
        }
      })));

      if (errors.length === answerSheets.length && answerSheets.length > 0) {
        throw new Error(`All ${answerSheets.length} students failed to mark. First error: ${errors[0]}`);
      }

      await (prisma as any).markingSession.update({
        where: { id },
        data: {
          status: 'REVIEW_REQUIRED',
          errorMessage: errors.length > 0 ? `${errors.length} student(s) had errors: ${errors.slice(0, 3).join('; ')}` : null
        }
      });

      markingProgress.set(id, {
        total: answerSheets.length,
        completed: answerSheets.length,
        currentStudentId: '',
        currentStudentName: '',
        status: 'COMPLETE',
        estimatedSecondsRemaining: 0
      });

      logger.info(`═══ MARKING COMPLETE for session ${id}: ${completed - errors.length} succeeded, ${errors.length} failed ═══`);

      try {
        await resend.emails.send({
          from: 'MarkAI <notifications@markai.edu>',
          to: 'lecturer@institution.edu',
          subject: `✅ Marking Complete — ${session.name}`,
          text: `
Marking is complete for "${session.name}".
Successfully marked: ${completed - errors.length}
Errors: ${errors.length}
${errors.length > 0
  ? `\nFailed:\n${errors.join('\n')}`
  : ''
}
Log in to MarkAI to review results.`.trim()
        });
      } catch (e) {
        logger.error('Email failed:', e);
      }

    } catch (sessionError: any) {
      logger.error(`🚨🚨 MARKING SESSION ${id} FAILED ENTIRELY:`, {
        message: sessionError.message,
        stack: sessionError.stack
      });

      await (prisma as any).markingSession.update({
        where: { id },
        data: {
          status: 'ERROR',
          errorMessage: sessionError.message || 'Unknown error during marking'
        }
      });

      markingProgress.set(id, {
        total: 0, completed: 0, currentStudentId: '', currentStudentName: '',
        status: 'ERROR', estimatedSecondsRemaining: 0
      });
    } finally {
      markingProgress.delete(id);
    }
  }

  app.post('/api/sessions/:id/retry-marking', authMiddleware, requireLecturer, async (req, res) => {
    try {
      const { id } = req.params;

      const session = await (prisma as any).markingSession.findUnique({ where: { id } });
      if (!session) return res.status(404).json({ error: 'Session not found' });

      if (!session.parsedQuestions || !session.parsedMarkScheme) {
        return res.status(400).json({ error: 'Cannot retry — paper structure was never successfully locked. Try re-creating the session.' });
      }

      // Reset state before retrying
      await (prisma as any).markingSession.update({
        where: { id },
        data: { status: 'MARKING', errorMessage: null }
      });

      await (prisma as any).studentAnswerSheet.updateMany({
        where: { sessionId: id, status: 'ERROR' },
        data: { status: 'PENDING', errorMessage: null }
      });

      // Clear any partial results from the failed attempt so retry starts clean
      await (prisma as any).studentResult.deleteMany({ where: { sessionId: id } });

      res.json({ status: 'MARKING', message: 'Retry started' });

      // Re-run the same background marking logic
      triggerBackgroundMarking(id);

    } catch (error: any) {
      logger.error('Retry marking error:', error);
      res.status(500).json({ error: error.message });
    }
  });

  app.post(
    '/api/sessions/:id/retry-failed',
    authMiddleware,
    async (req, res) => {
      try {
        const { id } = req.params;

        const updated = await (prisma as any).studentAnswerSheet.updateMany({
          where: { sessionId: id, status: 'ERROR' },
          data: { status: 'PENDING' }
        });

        await (prisma as any).markingSession.update({
          where: { id },
          data: { status: 'PENDING' }
        });

        res.json({
          message: `${updated.count} failed sheets reset. Call /mark again to retry.`,
          reset: updated.count
        });
      } catch (error: any) {
        res.status(500).json({ error: error.message });
      }
    }
  );

  app.get('/api/sessions/:id/progress', authMiddleware, async (req, res) => {
    const { id } = req.params;
    const progress = markingProgress.get(id);

    if (!progress) {
      // No in-memory progress entry usually means it's either not started,
      // or already finished and cleaned up — check the DB for the real status
      try {
        const session = await (prisma as any).markingSession.findUnique({
          where: { id },
          select: { status: true, errorMessage: true }
        });

        if (!session) {
          return res.status(404).json({ error: 'Session not found' });
        }

        return res.json({
          status: session.status === 'ERROR' ? 'ERROR' : (session.status === 'REVIEW_REQUIRED' || session.status === 'COMPLETE' ? 'COMPLETE' : 'PENDING'),
          errorMessage: session.errorMessage,
          total: 0,
          completed: 0,
          currentStudentId: '',
          currentStudentName: '',
          estimatedSecondsRemaining: 0
        });
      } catch (dbError) {
        return res.json({
          status: 'PENDING',
          errorMessage: null,
          total: 0,
          completed: 0,
          currentStudentId: '',
          currentStudentName: '',
          estimatedSecondsRemaining: 0
        });
      }
    }

    res.json(progress);
  });

  app.get('/api/sessions/:id/results', authMiddleware, async (req, res) => {
    try {
      const results = await (prisma as any).studentResult.findMany({ 
        where: { sessionId: req.params.id }, 
        select: { 
          id: true, 
          studentId: true, 
          studentName: true, 
          percentage: true, 
          totalMarks: true, 
          maxMarks: true, 
          grade: true, 
          reviewed: true,
          createdAt: true
        }, 
        orderBy: { studentId: 'asc' } 
      });
      res.json(results);
    } catch (error: any) {
      logger.error('Failed to fetch results:', error.message);
      if (error.code === 'P2024') return res.status(503).json({ error: 'Database is busy.' });
      res.status(500).json({ error: 'Failed to fetch results' });
    }
  });

  // ============================================
  // ACTION BUTTONS: Approve All, Re-evaluate, Download ZIP, Email
  // ============================================

  app.patch('/api/sessions/:id/approve-all', authMiddleware, async (req, res) => {
    try {
      const { id } = req.params;
      await (prisma as any).studentResult.updateMany({
        where: { sessionId: id },
        data: { reviewed: true }
      });
      await (prisma as any).markingSession.update({
        where: { id },
        data: { status: 'COMPLETE' }
      });
      res.json({ success: true });
    } catch (error: any) {
      logger.error('Failed to approve all:', error);
      res.status(500).json({ error: error.message });
    }
  });

  app.post('/api/sessions/:id/students/:studentId/re-evaluate', authMiddleware, async (req, res) => {
    try {
      const { id, studentId } = req.params;
      const session = await (prisma as any).markingSession.findUnique({ where: { id } });
      const answerSheet = await (prisma as any).studentAnswerSheet.findUnique({
        where: { sessionId_studentId: { sessionId: id, studentId } }
      });

      if (!session || !answerSheet) {
        return res.status(404).json({ error: 'Session or Answer Sheet not found' });
      }

      if (!session.parsedQuestions || !session.parsedMarkScheme) {
        return res.status(400).json({ error: 'Session has no locked question structure. Please parse the paper first.' });
      }

      const parsedQuestions = session.parsedQuestions as any[];
      const parsedMarkScheme = session.parsedMarkScheme as any[];

      // Re-mark logic
      const resultData = await markStudentAnswers(
        answerSheet.extractedText,
        studentId,
        parsedQuestions,
        parsedMarkScheme,
        session
      );

      // Clean up previous results before creating new ones
      await (prisma as any).questionResult.deleteMany({
         where: { studentResult: { sessionId: id, studentId } }
      });
      await (prisma as any).studentResult.delete({
        where: { sessionId_studentId: { sessionId: id, studentId } }
      }).catch(() => {}); 

      const dbResult = await (prisma as any).studentResult.create({
        data: {
          sessionId: id,
          studentId: resultData.studentId,
          studentName: answerSheet.studentName,
          answerPdfUrl: answerSheet.pdfUrl,
          totalMarks: resultData.totalMarks,
          maxMarks: resultData.maxMarks,
          percentage: resultData.percentage,
          grade: resultData.grade,
          aiData: JSON.parse(JSON.stringify(resultData)),
          questions: {
             create: resultData.questions.map((q: any) => ({
                 questionNumber: q.questionNumber,
                 questionText: q.questionText,
                 topic: q.topic || 'General',
                 marksAwarded: q.marksAwarded,
                 marksAvailable: q.marksAvailable,
                 status: q.status,
                 studentAnswer: q.studentAnswer,
                 expectedAnswer: q.expectedAnswer,
                 aiFeedback: q.aiFeedback,
                 lostMarksReason: q.lostMarksReason,
                 improvementSuggestion: q.improvementSuggestion
             }))
          }
        }
      });
      res.json(dbResult);
    } catch (error: any) {
      logger.error('Failed to re-evaluate:', error);
      res.status(500).json({ error: error.message });
    }
  });

  app.get('/api/results/:id/pdf', authMiddleware, async (req, res) => {
    try {
      const { id } = req.params;
      const result = await (prisma as any).studentResult.findUnique({
        where: { id },
        include: { questions: true, session: true }
      });
      
      if (!result) return res.status(404).send('Not found');

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${result.studentId}_report.pdf"`);

      const doc = new PDFDocument({ margin: 50 });
      doc.pipe(res);

      doc.fontSize(20).text('MarkAI Feedback Report', { align: 'center' });
      doc.moveDown();
      doc.fontSize(14).text(`Student: ${result.studentName || result.studentId}`);
      doc.text(`Score: ${result.totalMarks}/${result.maxMarks} (${result.percentage}%)`);
      doc.text(`Grade: ${result.grade}`);
      doc.moveDown();
      doc.fontSize(16).text('Question Feedback:', { underline: true });
      doc.moveDown();

      for (const q of result.questions) {
         doc.fontSize(12).text(`Q${q.questionNumber}: ${q.marksAwarded}/${q.marksAvailable} marks`)
            .fillColor(q.status === 'CORRECT' ? 'green' : q.status === 'PARTIAL' ? 'orange' : 'red')
            .text(`[${q.status}]`);
         doc.fillColor('black').fontSize(10).text(`AI Feedback: ${q.aiFeedback}`);
         if (q.improvementSuggestion) {
            doc.fillColor('gray').text(`Suggestion: ${q.improvementSuggestion}`);
         }
         doc.moveDown();
      }

      doc.end();
    } catch (error: any) {
      logger.error('Failed to download pdf:', error);
      if (!res.headersSent) res.status(500).send('Error generating PDF');
    }
  });

  app.get('/api/sessions/:id/download-reports', authMiddleware, async (req, res) => {
    try {
      const { id } = req.params;
      const session = await (prisma as any).markingSession.findUnique({ where: { id } });
      const results = await (prisma as any).studentResult.findMany({
        where: { sessionId: id },
        include: { questions: true }
      });
      
      if (!session || !results) return res.status(404).send('Not found');

      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', `attachment; filename="${session.name.replace(/\W+/g, '_')}_reports.zip"`);

      const archive = archiver('zip', { zlib: { level: 9 } });
      archive.pipe(res);

      for (const result of results) {
         const doc = new PDFDocument({ margin: 50 });
         const buffers: Buffer[] = [];
         
         const pdfPromise = new Promise<Buffer>((resolve) => {
             doc.on('data', Buffer => buffers.push(Buffer));
             doc.on('end', () => resolve(Buffer.concat(buffers)));
         });

         doc.fontSize(20).text('MarkAI Feedback Report', { align: 'center' });
         doc.moveDown();
         doc.fontSize(14).text(`Student: ${result.studentName || result.studentId}`);
         doc.text(`Score: ${result.totalMarks}/${result.maxMarks} (${result.percentage}%)`);
         doc.text(`Grade: ${result.grade}`);
         doc.moveDown();
         doc.fontSize(16).text('Question Feedback:', { underline: true });
         doc.moveDown();

         for (const q of result.questions) {
            doc.fontSize(12).text(`Q${q.questionNumber}: ${q.marksAwarded}/${q.marksAvailable} marks`)
               .fillColor(q.status === 'CORRECT' ? 'green' : q.status === 'PARTIAL' ? 'orange' : 'red')
               .text(`[${q.status}]`);
            doc.fillColor('black').fontSize(10).text(`AI Feedback: ${q.aiFeedback}`);
            if (q.improvementSuggestion) {
               doc.fillColor('gray').text(`Suggestion: ${q.improvementSuggestion}`);
            }
            doc.moveDown();
         }

         doc.end();
         const finalBuffer = await pdfPromise;
         archive.append(finalBuffer, { name: `${result.studentId || 'unknown'}_report.pdf` });
      }

      await archive.finalize();
    } catch (error: any) {
      logger.error('Failed to download zip:', error);
      if (!res.headersSent) res.status(500).send('Error generating ZIP');
    }
  });

  app.post('/api/sessions/:id/email-reports', authMiddleware, async (req, res) => {
    try {
      const { id } = req.params;
      const session = await (prisma as any).markingSession.findUnique({ where: { id } });
      const results = await (prisma as any).studentResult.findMany({
        where: { sessionId: id },
        include: { questions: true }
      });

      if (!session || !results) return res.status(404).json({ error: 'Not found' });

      let count = 0;
      for (const result of results) {
          try {
             await resend.emails.send({
                 from: 'MarkAI <notifications@markai.edu>',
                 to: 'mock.student@institution.edu',
                 subject: `Your Exam Feedback: ${session.name}`,
                 text: `Hello ${result.studentName || result.studentId},\n\nYour result for ${session.name} is ready.\nScore: ${result.percentage}% (${result.totalMarks}/${result.maxMarks})\nGrade: ${result.grade}\n\nPlease review your detailed breakdown in MarkAI.`
             });
             count++;
          } catch (err) {
             logger.error(`Failed to email ${result.studentId}:`, err);
          }
      }
      res.json({ success: true, count });
    } catch (error: any) {
      logger.error('Failed to email all:', error);
      res.status(500).json({ error: error.message });
    }
  });

  app.delete('/api/sessions/:id', authMiddleware, async (req, res) => {
    try {
      const { id } = req.params;
      const user = (req as any).user;

      // 1. Fetch session to verify ownership and status
      const session = await (prisma as any).markingSession.findUnique({
        where: { id }
      });

      if (!session) {
        return res.status(404).json({ error: 'Session not found' });
      }

      // 2. Authorization check
      if (session.lecturerId !== user.id) {
        return res.status(403).json({ error: 'Forbidden: You do not own this session' });
      }

      // 3. Status check — block delete if currently marking
      if (session.status === 'MARKING') {
        return res.status(400).json({ error: 'Cannot delete a session that is currently being marked' });
      }

      logger.info(`🗑️ Lecturer ${user.id} requested deletion of session ${id}`);

      // 4. Sequential deletion to respect FKs and Supabase connection limits
      
      // a) Delete QuestionResults (linked via StudentResult)
      const results = await (prisma as any).studentResult.findMany({
        where: { sessionId: id },
        select: { id: true }
      });

      for (const result of results) {
        await (prisma as any).questionResult.deleteMany({
          where: { studentResultId: result.id }
        });
      }

      // b) Delete StudentResults
      await (prisma as any).studentResult.deleteMany({
        where: { sessionId: id }
      });

      // c) Delete StudentAnswerSheets
      await (prisma as any).studentAnswerSheet.deleteMany({
        where: { sessionId: id }
      });

      // d) Finally delete the Session itself
      await (prisma as any).markingSession.delete({
        where: { id }
      });

      logger.info(`✅ Session ${id} and all related data purged successfully`);
      res.json({ success: true, message: "Session deleted successfully" });
    } catch (error: any) {
      logger.error('Failed to delete session:', error);
      res.status(500).json({ error: error.message });
    }
  });


  app.get('/api/results/:id', authMiddleware, async (req, res) => {
    try {
      const result = await (prisma as any).studentResult.findUnique({ where: { id: req.params.id }, include: { questions: true, session: true } });
      res.json(result);
    } catch (error: any) {
      logger.error(`Failed to fetch result ${req.params.id}:`, error.message);
      res.status(500).json({ error: 'Failed to fetch result' });
    }
  });

  app.get('/api/results', authMiddleware, async (req, res) => {
    try {
      const { sessionId, studentId } = req.query;
      const result = await (prisma as any).studentResult.findFirst({ where: { sessionId: sessionId as string, studentId: studentId as string }, include: { questions: true } });
      res.json(result);
    } catch (error: any) {
      logger.error('Failed to fetch result by query:', error.message);
      res.status(500).json({ error: 'Failed to fetch result' });
    }
  });

  app.patch('/api/results/:resultId/override', authMiddleware, async (req, res) => {
    try {
      const { questionId, lecturerMark, lecturerNote } = overrideSchema.parse(req.body);
      await (prisma as any).questionResult.update({ where: { id: questionId }, data: { lecturerOverride: lecturerMark, lecturerNote } });

      const studentResult = await (prisma as any).studentResult.findUnique({ where: { id: req.params.resultId }, include: { questions: true } });
      const totalMarks = studentResult!.questions.reduce((acc: number, q: any) => acc + (q.lecturerOverride ?? q.marksAwarded), 0);
      const percentage = (totalMarks / studentResult!.maxMarks) * 100;
      let grade = 'F';
      if (percentage >= 90) grade = 'A*';
      else if (percentage >= 80) grade = 'A';
      else if (percentage >= 70) grade = 'B';
      else if (percentage >= 60) grade = 'C';
      else if (percentage >= 50) grade = 'D';
      else if (percentage >= 40) grade = 'E';

      const updated = await (prisma as any).studentResult.update({ where: { id: req.params.resultId }, data: { totalMarks, percentage, grade }, include: { questions: true } });
      res.json(updated);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  app.post('/api/results/:resultId/reevaluate', authMiddleware, async (req, res) => {
    try {
      const { resultId } = req.params;

      const existingResult = await (prisma as any).studentResult.findUnique({
        where: { id: resultId },
        include: { session: true }
      });

      if (!existingResult) {
        return res.status(404).json({ error: 'Result not found' });
      }

      const session = existingResult.session;

      if (!session.parsedQuestions || !session.parsedMarkScheme) {
        return res.status(400).json({ error: 'Session has no locked question structure.' });
      }

      const answerSheet = await (prisma as any).studentAnswerSheet.findFirst({
        where: { sessionId: session.id, studentId: existingResult.studentId }
      });

      if (!answerSheet || !answerSheet.extractedText || answerSheet.extractedText.trim().length < 5) {
        return res.status(400).json({ error: 'Original answer sheet text not found or empty.' });
      }

      // Create a job record and respond IMMEDIATELY — no blocking
      const job = await (prisma as any).uploadJob.create({
        data: { status: 'PROCESSING', filename: `reevaluate-${existingResult.studentId}` }
      });

      res.json({ jobId: job.id, status: 'PROCESSING' });

      // Background processing — runs after response is already sent
      (async () => {
        try {
          logger.info(`Re-evaluating ${existingResult.studentId} using stored text (length=${answerSheet.extractedText.length}), previous score: ${existingResult.totalMarks}/${existingResult.maxMarks}`);

          const newMarkingResult = await markStudentAnswersWithConsensus(
            answerSheet.extractedText,
            existingResult.studentId,
            session.parsedQuestions as any[],
            session.parsedMarkScheme as any[],
            session
          );

          logger.info(`Re-evaluation result for ${existingResult.studentId}: ${newMarkingResult.totalMarks}/${newMarkingResult.maxMarks} (previous: ${existingResult.totalMarks}/${existingResult.maxMarks})`);

          await (prisma as any).questionResult.deleteMany({ where: { studentResultId: resultId } });

          const updatedResult = await (prisma as any).studentResult.update({
            where: { id: resultId },
            data: {
              totalMarks: newMarkingResult.totalMarks,
              maxMarks: newMarkingResult.maxMarks,
              percentage: newMarkingResult.percentage,
              grade: newMarkingResult.grade,
              aiData: newMarkingResult,
              reviewed: false,
              questions: {
                create: newMarkingResult.questions.map((q: any) => ({
                  questionNumber: String(q.questionNumber),
                  questionText: q.questionText || '',
                  topic: q.topic || 'General',
                  marksAwarded: Number(q.marksAwarded) || 0,
                  marksAvailable: Number(q.marksAvailable) || 0,
                  status: q.status || 'INCORRECT',
                  studentAnswer: q.studentAnswer || '',
                  expectedAnswer: q.expectedAnswer || '',
                  aiFeedback: q.aiFeedback || '',
                  lostMarksReason: q.lostMarksReason || null,
                  improvementSuggestion: q.improvementSuggestion || '',
                  aiConfidence: q.aiConfidence || 'High',
                  consensusNote: q.consensusNote || null
                }))
              }
            }
          });

          await (prisma as any).uploadJob.update({
            where: { id: job.id },
            data: {
              status: 'COMPLETE',
              extractedText: JSON.stringify({
                previousTotal: existingResult.totalMarks,
                newTotal: updatedResult.totalMarks,
                changed: existingResult.totalMarks !== updatedResult.totalMarks
              }),
              completedAt: new Date()
            }
          });

        } catch (error: any) {
          logger.error(`Re-evaluation failed for ${existingResult.studentId}:`, error);
          await (prisma as any).uploadJob.update({
            where: { id: job.id },
            data: { status: 'ERROR', errorMessage: error.message, completedAt: new Date() }
          });
        }
      })();

    } catch (error: any) {
      logger.error('Re-evaluate route error:', error);
      res.status(500).json({ error: error.message });
    }
  });

  app.get('/api/student/results', authMiddleware, async (req, res) => {
    try {
      if (req.user.userType === 'STUDENT') {
        const results = await (prisma as any).studentResult.findMany({ where: { studentId: req.user.studentCode }, include: { session: true, questions: true }, orderBy: { createdAt: 'desc' } });
        res.json(results);
      } else if (req.user.userType === 'LECTURER') {
        const results = await (prisma as any).studentResult.findMany({ where: { session: { lecturerId: req.user.id } }, include: { session: true, questions: true }, orderBy: { createdAt: 'desc' } });
        res.json(results);
      } else {
        const results = await (prisma as any).studentResult.findMany({ include: { session: true, questions: true }, orderBy: { createdAt: 'desc' } });
        res.json(results);
      }
    } catch (error: any) {
      console.error('Error fetching results:', error);
      res.status(500).json({ error: 'Failed to fetch results' });
    }
  });

  app.get('/api/dashboard/stats', authMiddleware, async (req, res) => {
    try {
      const userType = (req.user.userType || '').toUpperCase();

      if (userType === 'LECTURER') {
        // Optimization: Run these sequentially but check for timeouts
        // results.length is papersMarked, so we can save one count query
        const results = await (prisma as any).studentResult.findMany({ 
          where: { session: { lecturerId: req.user.id } }, 
          select: { percentage: true } 
        });

        const totalSessions = await (prisma as any).markingSession.count({ where: { lecturerId: req.user.id } });
        const pendingReview = await (prisma as any).markingSession.count({ where: { lecturerId: req.user.id, status: 'REVIEW_REQUIRED' } });

        const papersMarked = results.length;
        const avgClassScore = papersMarked ? results.reduce((acc: number, r: any) => acc + r.percentage, 0) / papersMarked : 0;
        
        res.json({ totalSessions, papersMarked, pendingReview, avgClassScore });
      } else if (userType === 'STUDENT') {
        const results = await (prisma as any).studentResult.findMany({ 
          where: { studentId: req.user.studentCode || '' }, 
          select: { percentage: true, grade: true, createdAt: true } 
        });
        
        const papersSubmitted = results.length;
        const averageScore = papersSubmitted ? results.reduce((acc: number, r: any) => acc + r.percentage, 0) / papersSubmitted : 0;
        const bestGrade = results.length ? [...results].sort((a: any, b: any) => a.percentage - b.percentage).pop()!.grade : 'N/A';
        
        res.json({ papersSubmitted, averageScore, bestGrade, streak: 0 });
      } else {
        // Admin stats - simplified
        const totalSessions = await (prisma as any).markingSession.count();
        const totalStudents = await (prisma as any).user.count({ where: { userType: 'STUDENT' } });
        const totalResults = await (prisma as any).studentResult.count();
        res.json({ totalSessions, totalStudents, totalResults });
      }
    } catch (error: any) {
      logger.error('Dashboard stats error:', error.message);
      if (error.code === 'P2024') {
        return res.status(503).json({ error: 'Database is busy. Please try refreshing in a moment.' });
      }
      res.status(500).json({ error: 'Failed to fetch dashboard stats' });
    }
  });

  app.post('/api/ai/generate', authMiddleware, async (req, res) => {
    try {
      const { prompt, context } = req.body;
      const fullPrompt = context ? `AI context: ${JSON.stringify(context)}. ${prompt}` : prompt;
      const response = await groqWithRetry(fullPrompt);
      res.json({ text: response.text });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get('/api/db-status', authMiddleware, async (req, res) => {
    try {
      await (prisma as any).$connect();
      res.json({ status: 'connected', database: 'Supabase' });
    } catch {
      res.json({ status: 'disconnected' });
    }
  });

  app.post('/api/universities', authMiddleware, async (req, res) => {
    try {
      const university = await (prisma as any).university.create({ data: { name: req.body.name } });
      res.json(university);
    } catch (error: any) { res.status(500).json({ error: error.message }); }
  });

  app.get('/api/universities', authMiddleware, async (req, res) => {
    try {
      const universities = await (prisma as any).university.findMany();
      res.json(universities);
    } catch (error: any) { res.status(500).json({ error: error.message }); }
  });

  app.post('/api/classes', authMiddleware, async (req, res) => {
    try {
      const cls = await (prisma as any).class.create({ data: { name: req.body.name, universityId: req.body.universityId, lecturerId: req.body.lecturerId } });
      res.json(cls);
    } catch (error: any) { res.status(500).json({ error: error.message }); }
  });

  app.get('/api/classes', authMiddleware, async (req, res) => {
    try {
      const where: any = {};
      if (req.query.universityId) where.universityId = req.query.universityId as string;
      if (req.query.lecturerId) where.lecturerId = req.query.lecturerId as string;
      const classes = await (prisma as any).class.findMany({ where });
      res.json(classes);
    } catch (error: any) { res.status(500).json({ error: error.message }); }
  });

  app.get('/api/classes/:id/students', authMiddleware, async (req, res) => {
    try {
      const enrollments = await (prisma as any).classEnrollment.findMany({ where: { classId: req.params.id }, include: { class: true } });
      res.json(enrollments);
    } catch (error: any) { res.status(500).json({ error: error.message }); }
  });

  app.post('/api/classes/:id/enroll', authMiddleware, async (req, res) => {
    try {
      const enrollment = await (prisma as any).classEnrollment.create({ data: { classId: req.params.id, studentId: req.body.studentId } });
      res.json(enrollment);
    } catch (error: any) { res.status(500).json({ error: error.message }); }
  });

  // K. Global Error Handler
  app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
    logger.error(err.message, { stack: err.stack, path: req.path });
    res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
  });

  // API Fallback (Returns JSON instead of index.html for unknown /api/* routes)
  app.use('/api/*', (req, res) => {
    res.status(404).json({ error: 'API endpoint not found' });
  });



  // STEP 3: Verify Gemini model works before accepting uploads
  const geminiWorks = await verifyGeminiModel();
  if (!geminiWorks) {
    logger.warn('⚠️ WARNING: Gemini AI features may not work. Check your GEMINI_API_KEY and model availability.');
  }

  app.listen(PORT, '0.0.0.0', () => logger.info(`✅ Server running on port ${PORT}`));
}

startServer();
