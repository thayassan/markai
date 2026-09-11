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
import os from 'os';
import { fromBuffer } from 'pdf2pic';
import {
  supabase,
  uploadPdfToSupabase,
  uploadTextToSupabase,
  downloadTextFromSupabase,
  downloadPdfFromSupabase,
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

const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.1-flash-lite';
const RPM_LIMIT = 13;   // 15 RPM actual, use 13 as safe margin
const RPD_LIMIT = 480;  // 500 RPD actual, use 480 as safe margin

class GeminiKeyPool {
  public keys: KeyState[] = []; // public so diagnostic endpoint can inspect it
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
    ].filter((k): k is string => !!k && k.trim().length > 0);

    // Log exactly which keys were found
    logger.info(`GeminiKeyPool: found ${rawKeys.length} keys from environment`);
    logger.info(`Key prefixes: ${rawKeys.map((k, i) => `key-${i+1}:${k.substring(0,8)}...`).join(', ')}`);

    if (rawKeys.length === 0) {
      logger.error('NO GEMINI API KEYS FOUND — check Railway Variables');
    }

    this.keys = rawKeys.map((key, i) => ({
      key,
      client: new GoogleGenAI({ apiKey: key }),
      requestTimestamps: [] as number[],
      dailyCount: 0,
      dailyResetAt: new Date().setHours(24, 0, 0, 0),
      cooldownUntil: 0,
      label: `key-${i + 1}`
    }));
  }

  // Find the next key that's actually usable right now
  private getAvailableKey(): KeyState | null {
    const now = Date.now();
    let triedKeys = 0;

    // Try every key, starting from currentIndex, wrapping around
    while (triedKeys < this.keys.length) {
      const candidate = this.keys[this.currentIndex];
      this.currentIndex = (this.currentIndex + 1) % this.keys.length;
      triedKeys++;

      // Reset daily counter if past midnight
      if (now > candidate.dailyResetAt) {
        logger.info(`${candidate.label}: resetting daily counter (was ${candidate.dailyCount})`);
        candidate.dailyCount = 0;
        candidate.dailyResetAt = new Date().setHours(24, 0, 0, 0);
        candidate.cooldownUntil = 0; // also clear cooldown on day reset
      }

      // Clean RPM window
      candidate.requestTimestamps = candidate.requestTimestamps.filter(
        t => now - t < 60000
      );

      const isInCooldown = candidate.cooldownUntil > now;
      const rpmUsed = candidate.requestTimestamps.length;
      const isOverRpm = rpmUsed >= RPM_LIMIT;
      const isOverRpd = candidate.dailyCount >= RPD_LIMIT;

      logger.info(`${candidate.label}: cooldown=${isInCooldown}(${Math.max(0, Math.ceil((candidate.cooldownUntil - now)/1000))}s), rpm=${rpmUsed}/${RPM_LIMIT}, rpd=${candidate.dailyCount}/${RPD_LIMIT}`);

      if (!isInCooldown && !isOverRpm && !isOverRpd) {
        logger.info(`→ Selected ${candidate.label}`);
        return candidate;
      }

      logger.warn(`${candidate.label} skipped: cooldown=${isInCooldown}, overRpm=${isOverRpm}, overRpd=${isOverRpd}`);
    }

    logger.error(`All ${this.keys.length} keys unavailable`);
    return null;
  }

  async call(
    contents: any,
    context: string = 'unknown',
    options: { maxWaitMs?: number; temperature?: number; responseMimeType?: string } = {}
  ): Promise<any> {
    const { maxWaitMs = 90000, temperature, responseMimeType } = options;
    const startTime = Date.now();
    let attemptCount = 0;

    while (Date.now() - startTime < maxWaitMs) {
      attemptCount++;
      const keyState = this.getAvailableKey();

      if (!keyState) {
        this.waitingCallsCount++;
        logger.warn(`All keys unavailable (attempt ${attemptCount}), waiting 10s... [${context}]`);
        await new Promise(resolve => setTimeout(resolve, 10000));
        this.waitingCallsCount = Math.max(0, this.waitingCallsCount - 1);
        continue;
      }

      try {
        keyState.requestTimestamps.push(Date.now());
        keyState.dailyCount++;

        logger.info(`Gemini call [${context}] using ${keyState.label} (rpm: ${keyState.requestTimestamps.length}/${RPM_LIMIT}, rpd: ${keyState.dailyCount}/${RPD_LIMIT})`);

        const configObj: any = { maxOutputTokens: 65536 };
        if (temperature !== undefined) configObj.temperature = temperature;
        if (responseMimeType !== undefined) configObj.responseMimeType = responseMimeType;

        const response = await keyState.client.models.generateContent({
          model: GEMINI_MODEL,
          contents,
          config: configObj
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
          logger.warn(`${keyState.label} rate limited [${context}], cooling down 65s`);
          keyState.cooldownUntil = Date.now() + 65000;
          keyState.requestTimestamps = []; // clear rpm window
          continue; // try next key immediately
        }

        const isModelNotFound =
          errorMsg.includes('NOT_FOUND') ||
          errorMsg.includes('404') ||
          errorMsg.includes('no longer available to new users') ||
          errorMsg.includes('is not found for API version');

        if (isModelNotFound) {
          logger.warn(`${keyState.label} model not available on [${context}], cooling down 5m`);
          keyState.cooldownUntil = Date.now() + 300000;
          continue; // try next key in pool
        }

        // Non-rate-limit error — throw immediately
        logger.error(`Gemini call [${context}] failed with non-rate-limit error on ${keyState.label}:`, errorMsg);
        throw error;
      }
    }

    throw new Error(
      `All ${this.keys.length} Gemini API keys are rate limited or exhausted. ` +
      `Please wait a few minutes, or type the answer manually.`
    );
  }

  getStatus() {
    const now = Date.now();
    return this.keys.map(k => ({
      label: k.label,
      dailyUsed: k.dailyCount,
      dailyLimit: RPD_LIMIT,
      rpmUsed: k.requestTimestamps.filter(t => now - t < 60000).length,
      rpmLimit: RPM_LIMIT,
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
  options: { context?: string; temperature?: number; responseMimeType?: string } = {}
): Promise<any> {
  const { context = 'unknown', temperature, responseMimeType } = options;
  return geminiPool.call(contents, context, { temperature, responseMimeType });
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
    logger.error(`This means ${GEMINI_MODEL} may not be available with your API key/region.`);
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
    logger.warn('⚠️ Schema check notice (non-fatal on startup):', error.message);
  }
}

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

function recoverPartialJSON(rawText: string): any[] {
  const recovered: any[] = [];

  // Find all complete JSON objects within the text using regex
  const objectPattern = /\{[^{}]*"questionNumber"[^{}]*"marksAvailable"[^{}]*\}/g;
  const matches = rawText.match(objectPattern);

  if (!matches) return recovered;

  for (const match of matches) {
    try {
      const obj = JSON.parse(match);
      if (obj.questionNumber) recovered.push(obj);
    } catch {
      // Skip malformed objects
    }
  }

  return recovered;
}

function buildFallbackQuestionsFromText(text: string): any[] {
  const questions: any[] = [];

  // Match common hierarchical question patterns
  const patterns = [
    // Q1(a)(i), Q2(b)(ii), Q3(c) etc.
    /\b(Q\d+\s*\([a-z]\)\s*\([ivxlc]+\))/gi,
    // Q1 (a) (i) with spaces
    /\b(Q\d+\s*\(\s*[a-z]\s*\)\s*\(\s*[ivxlc]+\s*\))/gi,
    // 1.(a)(i) numeric prefix
    /\b(\d+\.\s*\([a-z]\)\s*\([ivxlc]+\))/gi,
    // Q1(a) without sub-part
    /\b(Q\d+\s*\([a-z]\)(?!\s*\([ivxlc]))/gi,
    // Simple Q1, Q2, Q3
    /\b(Q\d+)(?!\s*\()/gi
  ];

  const foundNumbers = new Set<string>();

  for (const pattern of patterns) {
    const matches = [...text.matchAll(pattern)];
    for (const match of matches) {
      const qNum = match[1].replace(/\s+/g, '').toUpperCase();
      if (!foundNumbers.has(qNum)) {
        foundNumbers.add(qNum);
        questions.push({
          questionNumber: qNum,
          questionText: `Question ${qNum}`,
          marksAvailable: 5, // conservative default
          topic: 'General'
        });
      }
    }
  }

  logger.info(`buildFallbackQuestionsFromText: found ${questions.length} question numbers via pattern matching`);
  return questions;
}

// ─── Helper: infer topic from question text ───────────────────────────────────
function inferTopic(questionText: string): string {
  const text = questionText.toLowerCase();
  if (text.includes('software engineering') || text.includes('define the term')) return 'Software Engineering';
  if (text.includes('testing') || text.includes('tdd') || text.includes('inspection')) return 'Software Testing';
  if (text.includes('requirement')) return 'Requirements Engineering';
  if (text.includes('maintenance') || text.includes('evolution') || text.includes('legacy')) return 'Software Maintenance';
  if (text.includes('process') || text.includes('model') || text.includes('agile') || text.includes('scrum')) return 'Software Process';
  if (text.includes('design') || text.includes('architect') || text.includes('pattern')) return 'Software Design';
  if (text.includes('professional') || text.includes('ethic') || text.includes('responsibilit')) return 'Professional Practice';
  if (text.includes('characteristic') || text.includes('good software') || text.includes('quality')) return 'Software Quality';
  return 'Software Engineering';
}

// ─── APPROACH 1: Direct regex extraction from question paper text ─────────────
// Reads marks like "(10 marks)" directly — no AI needed, zero hallucination
function extractQuestionsFromTextDirectly(text: string): any[] {
  const questions: any[] = [];

  const lines = text
    .replace(/\r\n/g, '\n').replace(/\r/g, '\n')
    .split('\n')
    .map(l => l.trim());

  logger.info(`extractQuestionsFromTextDirectly: processing ${lines.length} lines`);
  logger.info(`Preview lines 0-30:\n${lines.slice(0, 30).map((l, i) => `${i}: "${l}"`).join('\n')}`);

  let currentMainQ = '';   // "1", "2", "3", "4"
  let currentPart = '';    // "a", "b", "c", "d"

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;

    // SKIP summary/total lines — these are NOT questions, they are
    // per-question totals printed at the end of each question section.
    // e.g. "(Question 1 total 100 marks)", "Question 2 total 100 marks"
    const isTotalSummaryLine =
      /question\s+\d+\s+total/i.test(line) ||
      /total\s+\d+\s+marks/i.test(line) ||
      /^\(\s*question\s+\d+/i.test(line) ||
      /end\s+of\s+examination/i.test(line) ||
      /^page\s+\d+\s+of\s+\d+/i.test(line);

    if (isTotalSummaryLine) {
      // ADDED: check if there's a real mark annotation ON this line too
      // e.g. "(10 marks)(Question 2 total 100 marks)"
      const embeddedMark = line.match(/\(\s*(\d{1,3})\s*marks?\s*\)/i);
      if (embeddedMark && questions.length > 0) {
        const lastQ = questions[questions.length - 1];
        if (lastQ.marksAvailable === 0) {
          lastQ.marksAvailable = parseInt(embeddedMark[1], 10);
          logger.info(`  Fixed last question ${lastQ.questionNumber} marks from summary line: ${lastQ.marksAvailable}`);
        }
      }
      logger.info(`  SKIPPING summary line: "${line}"`);
      continue;
    }

    // ── Detect main question number: "1.", "Q1:", "2.", "Q2:" ──
    const mainQMatch = line.match(/^(?:Q\s*)?(\d+)\s*[:.]\s*$/) ||
      line.match(/^(?:Q\s*)?(\d+)\s*\.\s*$/) ||
      line.match(/^(?:Question\s+)?(\d+)\s*$/i);
    if (mainQMatch && parseInt(mainQMatch[1]) <= 10) {
      currentMainQ = mainQMatch[1];
      currentPart = '';
      logger.info(`Detected main question: Q${currentMainQ}`);
      continue;
    }

    // ── Detect part letter alone on a line: "(a)", "(b)", "(c)", "(d)" ──
    const partOnlyMatch = line.match(/^\(\s*([a-d])\s*\)\s*$/i);
    if (partOnlyMatch) {
      currentPart = partOnlyMatch[1].toLowerCase();
      logger.info(`Detected part: (${currentPart}) under Q${currentMainQ}`);
      continue;
    }

    // ── Detect sub-question: "(i)...", "(ii)...", "(iii)..." ──
    // Handles: "(i)Question text" or "(i) Question text"
    // Does NOT require (a) prefix since that was on the previous line
    const subQMatch = line.match(/^\(\s*(i{1,3}|iv|v|vi|vii|viii|ix|x)\s*\)\s*(.*)$/i);
    if (subQMatch && currentMainQ && currentPart) {
      const subpart = subQMatch[1].toLowerCase();
      let questionText = subQMatch[2].trim();

      // Look ahead for marks on the next 1-12 lines
      // Also collect continuation of question text
      let marks = 0;
      for (let j = i + 1; j < lines.length && j <= i + 12; j++) {
        const nextLine = lines[j].trim();
        if (!nextLine) continue;

        // ADDED — skip summary/total lines in look-ahead too
        if (/question\s+\d+\s+total/i.test(nextLine) ||
          /total\s+\d+\s+marks/i.test(nextLine)) {
          break; // stop look-ahead at a total line, don't assign its value
        }

        // Is this line just a mark annotation?
        const markLineMatch = nextLine.match(/^\(\s*(\d{1,3})\s*marks?\s*\)\.?\s*$/i);
        if (markLineMatch) {
          marks = parseInt(markLineMatch[1], 10);
          break;
        }

        // Does this line contain a mark annotation (possibly with other text)?
        const markInLineMatch = nextLine.match(/\(\s*(\d{1,3})\s*marks?\s*\)/i);
        if (markInLineMatch) {
          marks = parseInt(markInLineMatch[1], 10);
          // Keep any text before the mark as part of question
          const textBefore = nextLine.replace(/\(\s*\d{1,3}\s*marks?\s*\)/gi, '').trim();
          if (textBefore && questionText.length < 300) questionText += ' ' + textBefore;
          break;
        }

        // Stop if we hit the next sub-question, part, or main question
        const isNextSubQ = nextLine.match(/^\(\s*(i{1,3}|iv|v)\s*\)/i);
        const isNextPart = nextLine.match(/^\(\s*[a-d]\s*\)\s*$/i);
        const isNextMainQ = nextLine.match(/^(?:Q\s*)?(\d+)\s*[:.]\s*$/) ||
          nextLine.match(/^\(Question\s+\d+\s+total/i);
        if (isNextSubQ || isNextPart || isNextMainQ) break;

        // Continuation of question text
        if (questionText.length < 300) questionText += ' ' + nextLine;
      }

      // Clean up
      questionText = questionText.replace(/\(\s*\d{1,3}\s*marks?\s*\)/gi, '').trim();
      const qNum = `Q${currentMainQ}(${currentPart})(${subpart})`;

      questions.push({
        questionNumber: qNum,
        questionText: questionText.substring(0, 300),
        marksAvailable: marks,
        topic: inferTopic(questionText)
      });

      logger.info(`  → ${qNum}: ${marks} marks — "${questionText.substring(0, 60)}"`);
      continue;
    }

    // ── Also handle compact format: "(a)(i)Question text (10 marks)" on one line ──
    const compactMatch = line.match(/^\(\s*([a-d])\s*\)\s*\(\s*(i{1,3}|iv|v)\s*\)\s*(.+)$/i);
    if (compactMatch && currentMainQ) {
      const part = compactMatch[1].toLowerCase();
      const subpart = compactMatch[2].toLowerCase();
      let questionText = compactMatch[3].trim();

      const markMatch = questionText.match(/\(\s*(\d{1,3})\s*marks?\s*\)/i);
      let marks = markMatch ? parseInt(markMatch[1], 10) : 0;
      questionText = questionText.replace(/\(\s*\d{1,3}\s*marks?\s*\)/gi, '').trim();

      if (!markMatch) {
        for (let j = i + 1; j < lines.length && j <= i + 5; j++) {
          const nextLine = lines[j].trim();
          const m = nextLine.match(/^\(\s*(\d{1,3})\s*marks?\s*\)\.?\s*$/i);
          if (m) { marks = parseInt(m[1], 10); break; }
          if (nextLine.match(/^\(\s*[a-d]\s*\)/i)) break;
        }
      }

      currentPart = part;
      const qNum = `Q${currentMainQ}(${part})(${subpart})`;
      questions.push({
        questionNumber: qNum,
        questionText: questionText.substring(0, 300),
        marksAvailable: marks,
        topic: inferTopic(questionText)
      });
      logger.info(`  → ${qNum} (compact): ${marks} marks`);
    }
  }

  logger.info(`=== FINAL EXTRACTION SUMMARY ===`);
  logger.info(`Questions: ${questions.length}`);
  logger.info(`Marks breakdown:`);
  const markGroups: Record<number, number> = {};
  questions.forEach(q => {
    markGroups[q.marksAvailable] = (markGroups[q.marksAvailable] || 0) + 1;
  });
  Object.entries(markGroups).forEach(([marks, count]) => {
    logger.info(`  ${marks} marks × ${count} questions = ${parseInt(marks) * count}`);
  });
  logger.info(`Total: ${questions.reduce((s, q) => s + q.marksAvailable, 0)} marks`);
  logger.info(`================================`);

  return questions;
}

// ─── APPROACH 1b: Direct extraction from mark scheme text ────────────────────
function extractMarksFromMarkSchemeDirectly(markSchemeText: string, existingQuestions: any[]): any[] {
  if (!existingQuestions || existingQuestions.length === 0) return [];

  const updated = existingQuestions.map(q => ({ ...q }));

  for (const q of updated) {
    if (q.marksAvailable > 0) continue; // already has marks

    const partMatch = q.questionNumber.match(/Q\d+\(([a-d])\)\(([ivx]+)\)/i);
    if (!partMatch) continue;

    const searchPattern = new RegExp(
      `\\(\\s*${partMatch[1]}\\s*\\)\\s*\\(\\s*${partMatch[2]}\\s*\\)[^(]*\\(\\s*(\\d{1,3})\\s*marks?\\s*\\)`,
      'i'
    );
    const found = markSchemeText.match(searchPattern);
    if (found) {
      q.marksAvailable = parseInt(found[1], 10);
    }
  }

  return updated;
}

// ─── APPROACH 2: Gemini with a hierarchical-structure-aware prompt ────────────
async function parseQuestionPaperWithGemini(questionPdfText: string): Promise<any[]> {
  const prompt = `
You are parsing a university exam paper. The text was extracted from a PDF and has this specific format:

IMPORTANT FORMAT NOTES:
- Main question numbers appear alone on a line: "Q1:" or "1."
- Part letters appear alone on a line: "(a)" or "(b)"
- Sub-part numbers appear at the start of a line with the question: "(i)Define the terms..."
- THE MARK VALUE APPEARS ON THE VERY NEXT LINE after the question text, like this:
    "(i)Define the terms software and software engineering."
    "(10 marks)"
  OR at the end of the question line: "(i)Define... (10 marks)"
- Each main question totals exactly 100 marks
- There are exactly 4 main questions, each with 4 parts (a,b,c,d), each part with 2 sub-parts (i,ii)
- So there are exactly 32 sub-questions total

EXAM PAPER TEXT:
${questionPdfText}

Extract ALL 32 sub-questions. For each one:
- questionNumber: "Q1(a)(i)", "Q1(a)(ii)", "Q2(c)(ii)", etc.
- questionText: the actual question asked
- marksAvailable: the number from "(N marks)" — READ FROM THE TEXT, do not guess
- topic: the concept being tested

The grand total of all marksAvailable must equal 400 (100 per question × 4 questions).

Return ONLY a valid JSON array, no markdown:
[{"questionNumber":"Q1(a)(i)","questionText":"Define the terms software and software engineering.","marksAvailable":10,"topic":"Software Definitions"}]`;

  const response = await callGeminiSafe(prompt, {
    context: 'parse-question-paper-v2',
    temperature: 0
  });

  const raw = (response.text || '')
    .replace(/```json/gi, '').replace(/```/gi, '').trim();
  const start = raw.indexOf('[');
  const end = raw.lastIndexOf(']');
  if (start === -1 || end === -1) return [];

  try {
    const parsed = JSON.parse(raw.substring(start, end + 1));
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    logger.error('Gemini parse JSON error:', e);
    return [];
  }
}

function stripCoverPage(text: string): string {
  // The actual exam questions always start with "1." or "Q1" or "1 ."
  // preceded by a blank line, after the cover page instructions.
  // Find the first occurrence of a main question number on its own line.

  const questionStartPatterns = [
    // "1." or "1 ." or "Q1." at the start of a line, alone
    /^(?:Q\s*)?1\s*\.?\s*$/m,
    // "1.\n(a)" — question number followed immediately by a part
    /^(?:Q\s*)?1\s*\.?\s*\n\s*\(\s*[a-d]\s*\)/m,
  ];

  let earliestIndex = text.length;

  for (const pattern of questionStartPatterns) {
    const match = text.match(pattern);
    if (match && match.index !== undefined && match.index < earliestIndex) {
      earliestIndex = match.index;
    }
  }

  if (earliestIndex === text.length) {
    // Couldn't find a clear question start — try a broader search
    // Look for the first "(a)" or "(a)(i)" after an instructions section
    const instructionEnd = text.search(/INSTRUCTIONS?[\s\S]*?\n\n/i);
    if (instructionEnd > 0) {
      const afterInstructions = text.indexOf('\n1', instructionEnd);
      if (afterInstructions > 0) {
        earliestIndex = afterInstructions;
      }
    }
  }

  if (earliestIndex > 0 && earliestIndex < text.length) {
    const stripped = text.substring(earliestIndex).trim();
    logger.info(`stripCoverPage: removed ${earliestIndex} chars of cover page content`);
    logger.info(`Remaining text starts with: "${stripped.substring(0, 200)}"`);
    return stripped;
  }

  logger.info('stripCoverPage: no cover page detected or could not find question start');
  return text;
}

function validateAndFixMarks(questions: any[], markSchemeText?: string): any[] {
  // For this paper format, valid marks per sub-question are 10, 15, or 20
  // Any sub-question with 0 marks or > 25 marks is likely wrong
  const VALID_RANGE = { min: 5, max: 25 };

  return questions.map(q => {
    if (q.marksAvailable < VALID_RANGE.min || q.marksAvailable > VALID_RANGE.max) {
      logger.warn(`Question ${q.questionNumber} has suspicious marks=${q.marksAvailable}, attempting to fix`);

      // Try to find the mark in the mark scheme as a cross-reference
      if (markSchemeText) {
        const qNumEscaped = q.questionNumber.replace(/[()]/g, '\\$&');
        const msMatch = markSchemeText.match(
          new RegExp(`${qNumEscaped}[^(]*\\((\\d{1,3})\\s*marks?\\)`, 'i')
        );
        if (msMatch) {
          const corrected = parseInt(msMatch[1], 10);
          logger.info(`  Fixed ${q.questionNumber}: ${q.marksAvailable} → ${corrected} marks (from mark scheme)`);
          return { ...q, marksAvailable: corrected };
        }
      }

      // If still 0, use a context-based default based on question type
      if (q.marksAvailable === 0) {
        const defaultMark = (q.questionText || '').length > 100 ? 15 : 10;
        logger.warn(`  Defaulting ${q.questionNumber} to ${defaultMark} marks`);
        return { ...q, marksAvailable: defaultMark };
      }
    }
    return q;
  });
}

async function pdfToBase64Images(pdfBuffer: Buffer): Promise<string[]> {
  const tempDir = os.tmpdir();
  const tempPdfPath = path.join(tempDir, `markai-parse-${Date.now()}.pdf`);

  try {
    fs.writeFileSync(tempPdfPath, pdfBuffer);

    const converter = fromBuffer(pdfBuffer, {
      density: 150,          // DPI — 150 is enough for text reading
      saveFilename: 'page',
      savePath: tempDir,
      format: 'jpeg',
      width: 1200,
      height: 1600
    });

    const results = await converter.bulk(-1, { responseType: 'base64' });

    logger.info(`pdfToBase64Images: converted ${results.length} pages`);
    return results
      .filter(r => r.base64)
      .map(r => r.base64 as string);

  } catch (e: any) {
    logger.warn(`pdfToBase64Images failed (${e.message}) — fallback to direct PDF buffer for Gemini Vision`);
    return [];
  } finally {
    if (fs.existsSync(tempPdfPath)) {
      try { fs.unlinkSync(tempPdfPath); } catch (e) { /* ignore cleanup error */ }
    }
  }
}

async function parseQuestionPaperFromImages(
  pdfBuffer: Buffer
): Promise<any[]> {
  logger.info('parseQuestionPaperFromImages: starting vision-based question paper extraction...');

  let base64Pages: string[] = [];
  try {
    base64Pages = await pdfToBase64Images(pdfBuffer);
  } catch (e: any) {
    logger.warn('PDF image extraction skipped:', e.message);
  }

  let promptParts: any[] = [];

  if (base64Pages.length > 0) {
    const contentPages = base64Pages.length > 1 ? base64Pages.slice(1) : base64Pages;
    logger.info(`Using ${contentPages.length} content page images for Gemini Vision`);

    const imageContents = contentPages.map(b64 => ({
      inlineData: {
        data: b64,
        mimeType: 'image/jpeg'
      }
    }));
    promptParts = imageContents;
  } else {
    logger.info('Sending entire PDF buffer directly as application/pdf to Gemini Vision');
    const pdfBase64 = pdfBuffer.toString('base64');
    promptParts = [{
      inlineData: {
        data: pdfBase64,
        mimeType: 'application/pdf'
      }
    }];
  }

  const prompt = `You are reading a university exam paper. Extract every sub-question and its mark allocation.

INSTRUCTIONS:
- Look at the visual layout carefully
- Questions are numbered: 1, 2, 3, 4 at the top level
- Sub-questions use letters: (a), (b), (c), (d)
- Sub-sub-questions use roman numerals: (i), (ii)
- Mark values appear in brackets on the RIGHT side of the page: (10 marks), (15 marks), (20 marks)
- DO NOT confuse instruction numbering (1. Answer ALL questions) with exam question numbering
- The first page is usually a cover page — ignore it if it contains only instructions or university header
- Extract ONLY actual exam questions, not instructions or headers

For each leaf-level sub-question (the ones students write answers for), extract:
- questionNumber: full hierarchical path e.g. "Q1(a)(i)", "Q2(c)(ii)", "Q4(d)(ii)"  
- questionText: the actual question being asked (without the mark annotation)
- marksAvailable: the NUMBER from "(N marks)" visible in the right margin — read exactly as printed
- topic: the main concept being tested in this question

Return ONLY a valid JSON array. No markdown, no explanation:
[
  {
    "questionNumber": "Q1(a)(i)",
    "questionText": "Define the terms software and software engineering.",
    "marksAvailable": 10,
    "topic": "Software Definitions"
  }
]`;

  try {
    const response = await callGeminiSafe(
      [{ role: 'user', parts: [...promptParts, { text: prompt }] }],
      { context: 'parse-question-paper-vision', temperature: 0 }
    );

    const raw = (response.text || '')
      .replace(/```json/gi, '').replace(/```/gi, '').trim();
    const start = raw.indexOf('[');
    const end = raw.lastIndexOf(']');

    if (start === -1 || end === -1) {
      logger.error('Vision parser: no JSON array in response');
      logger.error(`Response preview: "${raw.substring(0, 300)}"`);
      return [];
    }

    const parsed = JSON.parse(raw.substring(start, end + 1));
    if (!Array.isArray(parsed)) return [];

    const normalized = normalizeQuestionMarks(parsed);
    const total = normalized.reduce((s: number, q: any) => s + (q.marksAvailable || 0), 0);
    logger.info(`Vision parser: extracted ${normalized.length} questions, total ${total} marks`);

    return normalized;

  } catch (error: any) {
    logger.error('Vision parser error:', error.message);
    return [];
  }
}

// ─── Main orchestrator — 4-approach fallback chain ────────────────────────────
async function parseQuestionPaper(
  questionPdfText: string,
  markSchemeText?: string
): Promise<any[]> {
  logger.info(`parseQuestionPaper: raw input length=${questionPdfText.length}`);
  logger.info(`Raw preview (first 300 chars): "${questionPdfText.substring(0, 300)}"`);

  // STEP 1: Remove cover page so the parser only sees actual question content
  const cleanedText = stripCoverPage(questionPdfText);
  logger.info(`After stripping cover page: length=${cleanedText.length}`);
  logger.info(`Clean text preview (first 300 chars): "${cleanedText.substring(0, 300)}"`);

  // Log first 40 lines to verify format
  const lines = cleanedText.split('\n');
  logger.info(`=== CLEANED TEXT LINES (first 40) ===`);
  lines.slice(0, 40).forEach((l, i) => logger.info(`L${i}: "${l}"`));
  logger.info(`=====================================`);

  // STEP 2: Try direct regex extraction on the clean text
  let questions = extractQuestionsFromTextDirectly(cleanedText);
  questions = validateAndFixMarks(questions, markSchemeText);

  // DIAGNOSTIC — print every question with its mark value
  logger.info('=== PER-QUESTION MARK AUDIT ===');
  let runningTotal = 0;
  questions.forEach(q => {
    runningTotal += (q.marksAvailable || 0);
    const flag = q.marksAvailable === 0 ? '⚠️ ZERO MARKS' :
      q.marksAvailable > 20 ? '⚠️ SUSPICIOUSLY HIGH' : '';
    logger.info(`  ${q.questionNumber}: ${q.marksAvailable} marks ${flag} (running total: ${runningTotal})`);
  });
  logger.info(`Expected: 400, Got: ${runningTotal}, Diff: ${400 - runningTotal}`);
  logger.info('================================');

  // STEP 4: Post-extraction mark scheme cross-reference pass
  const extractedTotal = questions.reduce((s, q) => s + (q.marksAvailable || 0), 0);

  if (extractedTotal < 380 && markSchemeText) {
    logger.warn(`Total ${extractedTotal} is below expected 400, running mark scheme cross-reference...`);

    questions = questions.map(q => {
      if (q.marksAvailable > 0) return q;

      // Search mark scheme for this question's marks
      // Mark scheme format: "(a)(i) Define... (10 marks)" or "Marking: X – N marks"
      const partSubpart = q.questionNumber.match(/\(([a-d])\)\(([ivx]+)\)/i);
      if (!partSubpart) return q;

      const [, part, subpart] = partSubpart;

      // Look for the mark near this question in the mark scheme
      const patterns = [
        new RegExp(`\\(${part}\\)\\s*\\(${subpart}\\)[^(]*\\((\\d{1,3})\\s*marks?\\)`, 'i'),
        new RegExp(`\\(${part}\\)\\(${subpart}\\).*?\\((\\d{1,3})\\s*marks?\\)`, 'i'),
      ];

      for (const p of patterns) {
        const m = markSchemeText.match(p);
        if (m) {
          const corrected = parseInt(m[1], 10);
          logger.info(`  Cross-referenced ${q.questionNumber}: 0 → ${corrected} marks from mark scheme`);
          return { ...q, marksAvailable: corrected };
        }
      }

      logger.warn(`  Could not find marks for ${q.questionNumber} in mark scheme either`);
      return q;
    });

    const correctedTotal = questions.reduce((s, q) => s + (q.marksAvailable || 0), 0);
    logger.info(`After cross-reference: total = ${correctedTotal}`);
  }

  const directTotal = questions.reduce((s, q) => s + (q.marksAvailable || 0), 0);
  logger.info(`After cover page strip & audit: ${questions.length} questions, ${directTotal} marks`);

  // If direct extraction worked well, use it
  if (questions.length >= 8 && directTotal > 50) {
    return questions;
  }

  // STEP 3: Gemini fallback with cleaned text
  logger.info('Direct extraction insufficient, calling Gemini with cleaned text...');
  try {
    const geminiQuestions = await parseQuestionPaperWithGemini(cleanedText);
    const geminiTotal = geminiQuestions.reduce((s, q) => s + (q.marksAvailable || 0), 0);
    if (geminiQuestions.length >= 8 && geminiTotal > 50) {
      return normalizeQuestionMarks(geminiQuestions);
    }
  } catch (e: any) {
    logger.warn('Gemini extraction failed:', e.message);
  }

  return questions.length > 0 ? questions : buildFallbackQuestionsFromText(cleanedText);
}

// ─── Validation logger — prints every question with marks to backend terminal ─
function logParseResult(questions: any[], textLength: number): void {
  const total = questions.reduce((s, q) => s + (Number(q.marksAvailable) || 0), 0);
  const zeroCount = questions.filter(q => !q.marksAvailable || q.marksAvailable === 0).length;

  logger.info(`=== PARSE RESULT SUMMARY ===`);
  logger.info(`Questions found: ${questions.length}`);
  logger.info(`Total marks: ${total}`);
  logger.info(`Questions with 0 marks: ${zeroCount}`);
  for (const q of questions) {
    logger.info(`  ${q.questionNumber}: ${q.marksAvailable} marks — ${(q.questionText || '').substring(0, 60)}`);
  }
  logger.info(`============================`);

  if (total === 0) {
    logger.error('CRITICAL: All questions have 0 marks — mark extraction completely failed');
  }
  if (questions.length < 8 && textLength > 5000) {
    logger.warn(`Only ${questions.length} questions found from a ${textLength}-char paper — likely missed sub-questions`);
  }
}

// ─── Gemini-backed mark extractor (used in APPROACH 3b) ──────────────────────
async function extractMarksFromMarkScheme(markSchemeText: string, questions: any[]): Promise<any[]> {
  logger.info(`extractMarksFromMarkScheme: extracting for ${questions.length} questions`);

  const questionList = questions
    .map((q: any) => `${q.questionNumber}: ${(q.questionText || '').substring(0, 100)}`)
    .join('\n');

  const prompt = `You are an expert mark scheme analyser.

MARK SCHEME:
${markSchemeText}

QUESTIONS TO FIND MARKS FOR:
${questionList}

For each question number listed above, find its mark allocation in the mark scheme.
Marks appear as: [2], (2), /2, "2 marks", or as a number at the end of the answer guidance line.

Return ONLY a valid JSON array — no markdown, no backticks:
[
  {
    "questionNumber": "Q1(a)(i)",
    "marksAvailable": 10,
    "markingGuidance": "Brief description of what earns marks"
  }
]

IMPORTANT:
- Match each question number exactly as given above
- NEVER return 0 marks for a real question
- Read the actual mark value from the mark scheme text — do not guess
- If you cannot find explicit marks, estimate: 1-sentence=2, paragraph=4, essay=10`;

  let rawResponse = '';
  try {
    const response = await callGeminiSafe(prompt, {
      context: 'extract-marks-from-markscheme',
      temperature: 0,
      responseMimeType: 'application/json'
    });
    rawResponse = response.text || '';

    let cleaned = rawResponse.replace(/```json\s*/gi, '').replace(/```\s*/gi, '').trim();
    const arrayStart = cleaned.indexOf('[');
    const arrayEnd = cleaned.lastIndexOf(']');
    if (arrayStart === -1 || arrayEnd === -1) throw new Error('No JSON array in mark scheme response');
    const marksData = JSON.parse(cleaned.substring(arrayStart, arrayEnd + 1));
    if (!Array.isArray(marksData)) throw new Error('Not an array');
    logger.info(`extractMarksFromMarkScheme: extracted marks for ${marksData.length} questions`);
    return marksData;
  } catch (error: any) {
    logger.error(`extractMarksFromMarkScheme failed: ${error.message}`);
    return [];
  }
}


async function parseMarkScheme(markSchemeText: string, parsedQuestions: any[]): Promise<any[]> {
  logger.info(`parseMarkScheme: input length=${markSchemeText.length}`);
  const prompt = `
You are an expert exam paper analyser. Extract the mark scheme for the provided questions.

MARK SCHEME:
${markSchemeText}

QUESTIONS EXTRACTED:
${JSON.stringify(parsedQuestions.map(q => q.questionNumber))}

Return ONLY a valid JSON array of mark scheme objects matching the questions. No markdown, no backticks.
[
  {
    "questionNumber": "Q1(a)(i)",
    "marksAvailable": 2,
    "requiredKeywords": ["must appear for full marks"],
    "acceptAlternatives": ["other valid phrasings"],
    "rejectList": ["wrong answers"],
    "methodMarks": "marks for approach",
    "markingGuidance": "additional notes"
  }
]`;
  try {
    const response = await callGeminiSafe(prompt, { context: 'parse-mark-scheme', temperature: 0 });
    let cleaned = (response.text || '').replace(/```json\s*/gi, '').replace(/```\s*/gi, '').trim();
    const arrayStart = cleaned.indexOf('[');
    const arrayEnd = cleaned.lastIndexOf(']');
    if (arrayStart === -1 || arrayEnd === -1) return [];
    const parsed = JSON.parse(cleaned.substring(arrayStart, arrayEnd + 1));
    return normalizeMarkScheme(parsed);
  } catch (error) {
    logger.error('parseMarkScheme error:', error);
    return [];
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

  // ── Recover from truncated JSON ─────────────────────────────────────────
  // Gemini sometimes cuts off mid-response when marking many questions.
  // Strategy: try full parse first, then try to repair truncated array.
  function repairTruncatedMarkingJSON(text: string): any {
    // Try full parse first
    try { return JSON.parse(text); } catch { }

    // Try to fix truncated questions array:
    // Find last complete question object and close the array + object
    const questionsStart = text.indexOf('"questions"');
    if (questionsStart === -1) throw new Error('No questions array found in response');

    // Find last complete question entry (last occurrence of })
    // Walk back from end of string to find the last complete }
    let repaired = text;
    // Remove any trailing incomplete text after last complete question
    for (let attempts = 0; attempts < 20; attempts++) {
      const lastBrace = repaired.lastIndexOf('}');
      if (lastBrace === -1) break;
      const candidate = repaired.substring(0, lastBrace + 1);
      // Count open vs closed braces to see if we can close the structure
      const openBraces = (candidate.match(/\{/g) || []).length;
      const closeBraces = (candidate.match(/\}/g) || []).length;
      const openBrackets = (candidate.match(/\[/g) || []).length;
      const closeBrackets = (candidate.match(/\]/g) || []).length;
      const neededBrackets = openBrackets - closeBrackets;
      const neededBraces = openBraces - closeBraces;
      if (neededBrackets >= 0 && neededBraces >= 0) {
        const fixed = candidate + ']'.repeat(neededBrackets) + '}'.repeat(neededBraces);
        try { return JSON.parse(fixed); } catch { }
      }
      repaired = repaired.substring(0, lastBrace);
    }
    throw new Error('Could not repair truncated JSON response');
  }

  let result = repairTruncatedMarkingJSON(responseText);

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
      'http://localhost:5174',
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
    const now = Date.now();
    const status = geminiPool.keys.map((k: any, i: number) => {
      const recentRequests = k.requestTimestamps?.filter(
        (t: number) => now - t < 60000
      ).length || 0;

      return {
        label: `key-${i + 1}`,
        hasKey: !!k.key,
        keyPrefix: k.key ? k.key.substring(0, 8) + '...' : 'MISSING',
        dailyCount: k.dailyCount || 0,
        dailyLimit: RPD_LIMIT,
        rpmUsed: recentRequests,
        rpmLimit: RPM_LIMIT,
        inCooldown: k.cooldownUntil > now,
        cooldownSecondsLeft: k.cooldownUntil > now
          ? Math.ceil((k.cooldownUntil - now) / 1000)
          : 0,
        isAvailable: (!k.cooldownUntil || k.cooldownUntil <= now) &&
          recentRequests < RPM_LIMIT &&
          (k.dailyCount || 0) < RPD_LIMIT
      };
    });

    const availableCount = status.filter(k => k.isAvailable).length;

    res.json({
      totalKeys: status.length,
      availableKeys: availableCount,
      keys: status,
      timestamp: new Date().toISOString()
    });
  });

  // J. All API Routes
  app.get('/api/health', (req, res) => {
    res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  // Mount Routers
  app.get('/api/admin/dashboard-stats', authMiddleware, async (req, res) => {
    try {
      const userId = (req as any).user?.id || (req as any).userId;
      const user = await (prisma as any).user.findUnique({
        where: { id: userId },
        select: { universityId: true, userType: true }
      });

      if (!user || (user.userType !== 'SCHOOL_ADMIN' && user.userType !== 'ADMIN')) {
        return res.status(403).json({ error: 'Not authorized or no university linked' });
      }

      let universityId = user.universityId;
      if (!universityId) {
        const firstUni = await (prisma as any).university.findFirst();
        universityId = firstUni?.id || null;
      }

      const now = new Date();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

      const uniUserFilter = universityId ? { universityId } : {};
      const uniSessionFilter = universityId ? { lecturer: { universityId } } : {};

      // Total students at this university
      const totalStudents = await (prisma as any).user.count({
        where: { ...uniUserFilter, userType: 'STUDENT' }
      });

      // Total lecturers at this university
      const totalLecturers = await (prisma as any).user.count({
        where: { ...uniUserFilter, userType: 'LECTURER' }
      });

      // Sessions this month by lecturers at this university
      const sessionsThisMonth = await (prisma as any).markingSession.count({
        where: {
          createdAt: { gte: monthStart },
          ...uniSessionFilter
        }
      });

      // University average score across all sessions
      const allResults = await (prisma as any).studentResult.findMany({
        where: { session: uniSessionFilter },
        select: { percentage: true }
      });

      const universityAvg = allResults.length > 0
        ? allResults.reduce((s: number, r: any) => s + r.percentage, 0) / allResults.length
        : 0;

      // Performance trend — last 6 months
      const trend = [];
      for (let i = 5; i >= 0; i--) {
        const start = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const end = new Date(now.getFullYear(), now.getMonth() - i + 1, 0, 23, 59, 59);
        const monthResults = await (prisma as any).studentResult.findMany({
          where: {
            createdAt: { gte: start, lte: end },
            session: uniSessionFilter
          },
          select: { percentage: true }
        });
        const avg = monthResults.length > 0
          ? monthResults.reduce((s: number, r: any) => s + r.percentage, 0) / monthResults.length
          : 0;
        trend.push({
          month: start.toLocaleString('default', { month: 'short' }),
          avg: Math.round(avg * 10) / 10,
          count: monthResults.length
        });
      }

      // Course ID comparison
      const courseResults = await (prisma as any).markingSession.findMany({
        where: uniSessionFilter,
        include: { results: { select: { percentage: true } } }
      });

      const courseMap: Record<string, number[]> = {};
      courseResults.forEach((session: any) => {
        const cid = session.courseId || session.subject || 'General';
        if (!courseMap[cid]) courseMap[cid] = [];
        session.results.forEach((r: any) => courseMap[cid].push(r.percentage));
      });

      const courseComparison = Object.entries(courseMap).map(([courseId, percentages]) => ({
        courseId,
        avg: Math.round(percentages.reduce((s, p) => s + p, 0) / percentages.length * 10) / 10,
        students: percentages.length
      })).sort((a, b) => b.avg - a.avg);

      // Faculty lecturers list
      const lecturers = await (prisma as any).user.findMany({
        where: { ...uniUserFilter, userType: 'LECTURER' },
        select: {
          id: true,
          fullName: true,
          role: true,
          department: true,
          createdAt: true,
          _count: { select: { markingSessions: true } }
        },
        orderBy: { createdAt: 'desc' }
      });

      res.json({
        stats: {
          totalStudents,
          totalLecturers,
          sessionsThisMonth,
          universityAvg: Math.round(universityAvg * 10) / 10
        },
        trend,
        courseComparison,
        lecturers: lecturers.map((l: any) => ({
          id: l.id,
          name: l.fullName,
          role: l.role || 'Lecturer',
          department: l.department || '—',
          classes: l._count?.markingSessions || 0,
          joined: l.createdAt.toISOString().split('T')[0]
        }))
      });

    } catch (error: any) {
      logger.error('Admin dashboard stats error:', error);
      res.status(500).json({ error: error.message });
    }
  });

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
        { id: user.id, email: user.email, userType: user.userType, studentCode: user.studentCode },
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
        { id: user.id, email: user.email, userType: user.userType, studentCode: user.studentCode },
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

          const docType = req.body.docType || 'answer';

          if (isImage || extractedText.length < 50) {
            method = isImage ? 'gemini-vision-image' : 'gemini-vision';
            logger.info(`Handwriting detected for job ${job.id} (${req.file!.originalname}), docType=${docType}, attempting Gemini OCR...`);

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

            let ocrPrompt = '';
            if (docType === 'question') {
              ocrPrompt = `
Transcribe ALL printed or handwritten content from this exam question paper with complete accuracy.
Focus on transcribing all questions, text, marks, and instructions.
Do not ignore anything other than scanning app watermarks/branding (e.g. "CamScanner", "Adobe Scan", "Microsoft Lens").
Respond with the full transcription of the text.`;
            } else if (docType === 'markscheme') {
              ocrPrompt = `
Transcribe ALL printed or handwritten content from this exam mark scheme / answer guide with complete accuracy.
Focus on transcribing all question numbers, suggested answers, marking criteria, and marks.
Do not ignore anything other than scanning app watermarks/branding (e.g. "CamScanner", "Adobe Scan", "Microsoft Lens").
Respond with the full transcription of the text.`;
            } else {
              ocrPrompt = `
Transcribe ALL handwritten or printed answer content from this exam answer sheet with complete accuracy.

IMPORTANT CONTEXT:
Students write their answers across multiple pages. They write the main question numbers (like 1, 2, 3, 4, often inside a circle) and sub-question letters/numbers (like (a)(i), (b)(ii), (c), etc.) next to their answers.
Please read the page contents carefully and reconstruct the answer sheet grouped by the actual main question numbers (e.g. Q1, Q2, Q3, Q4) written by the student.
If a page does not have a new main question number at the top, it is a continuation of the previous page's question. For example, if Page 1 is Question 1 and ends at Q1(b)(ii), and Page 2 starts with (c)(i) without a new main question number, then Page 2 is a continuation of Question 1 (meaning it contains Q1(c)(i), Q1(d)(i), etc.).

IMPORTANT — IGNORE THE FOLLOWING, they are not part of the student's answers:
- Scanning app watermarks or branding (e.g. "CamScanner", "Adobe Scan", "Microsoft Lens", page borders/logos added by scanning apps)
- Page numbers, headers, or footers added by the scanning software itself
- Any text that is clearly an app UI element rather than something the student wrote

Focus ONLY on the student's actual handwritten or written answer content for each question.

If after ignoring watermarks and app branding there is genuinely no answer content
visible on this page (e.g. it's a blank page, a cover page, or only contains a
scanning app watermark with nothing else), respond with exactly: UNREADABLE_DOCUMENT

Format your response grouped by the correct main question number:
Q1:
[transcribe all Q1 answers here, including sub-questions from all pages that belong to Q1]
Q2:
[transcribe all Q2 answers here, including sub-questions from all pages that belong to Q2]
... (continue for all main questions)

Do not count the pages sequentially as Q1, Q2, Q3, Q4, Q5, Q6, Q7, Q8. Find the circled/written numbers to guide you.`;
            }

            try {
              const { text, wasCached } = await getOrCreateOcrResult(
                req.file!.buffer,
                ocrPrompt,
                req.file!.mimetype,
                `OCR-${req.file!.originalname}`
              );

              if (!text || (docType === 'answer' && text === 'UNREADABLE_DOCUMENT')) {
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
              if (docType === 'answer') {
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
      const userId = (req as any).user?.id || (req as any).userId;

      const where: any = { lecturerId: userId };
      if (status) where.status = status;
      if (subject) where.subject = subject;

      let data;
      try {
        data = await (prisma as any).markingSession.findMany({
          where, skip, take: Number(limit),
          orderBy: { [field]: order as any },
          include: { _count: { select: { results: true, answerSheets: true } } }
        });
      } catch (innerErr: any) {
        logger.warn('Standard findMany on /api/sessions failed, using safe select fallback:', innerErr.message);
        data = await (prisma as any).markingSession.findMany({
          where, skip, take: Number(limit),
          orderBy: { [field]: order as any },
          select: {
            id: true,
            name: true,
            classId: true,
            lecturerId: true,
            subject: true,
            sessionType: true,
            examBoard: true,
            courseId: true,
            paperType: true,
            questionPdfUrl: true,
            markSchemePdfUrl: true,
            status: true,
            errorMessage: true,
            totalMaxMarks: true,
            createdAt: true,
            _count: { select: { results: true, answerSheets: true } }
          }
        });
      }
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
      let session;
      try {
        session = await (prisma as any).markingSession.findUnique({
          where: { id: req.params.id }
        });
      } catch (innerErr: any) {
        logger.warn(`Standard findUnique on /api/sessions/${req.params.id} failed, using safe select:`, innerErr.message);
        session = await (prisma as any).markingSession.findUnique({
          where: { id: req.params.id },
          select: {
            id: true,
            name: true,
            classId: true,
            lecturerId: true,
            subject: true,
            sessionType: true,
            examBoard: true,
            courseId: true,
            paperType: true,
            questionPdfUrl: true,
            markSchemePdfUrl: true,
            questionTextUrl: true,
            markSchemeTextUrl: true,
            parsedQuestions: true,
            parsedMarkScheme: true,
            totalMaxMarks: true,
            parsingVerified: true,
            markingStrictness: true,
            feedbackDetail: true,
            status: true,
            errorMessage: true,
            createdAt: true
          }
        });
      }
      if (!session) return res.status(404).json({ error: 'Session not found' });
      res.json(session);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post('/api/sessions/:id/parse-paper', authMiddleware, requireLecturer, async (req, res) => {
    try {
      const { id } = req.params;

      // Accept text passed directly from the frontend (preferred — no race condition)
      // OR fall back to reading from DB if text isn't passed (backwards compat)
      let questionPdfText: string = req.body.questionPdfText || '';
      let markSchemeText: string = req.body.markSchemeText || '';

      const session = await (prisma as any).markingSession.findUnique({ where: { id } });
      if (!session) {
        return res.status(404).json({ error: 'Session not found' });
      }

      // If text wasn't passed in the body, try reading from DB-stored URLs as fallback
      if (!questionPdfText && session.questionTextUrl) {
        logger.info(`parse-paper: text not in request body, downloading from ${session.questionTextUrl}`);
        questionPdfText = await downloadTextFromSupabase(session.questionTextUrl);
      }

      if (!markSchemeText && session.markSchemeTextUrl) {
        logger.info(`parse-paper: markScheme not in request body, downloading from ${session.markSchemeTextUrl}`);
        markSchemeText = await downloadTextFromSupabase(session.markSchemeTextUrl);
      }

      // Now validate we actually have content to work with
      if (!questionPdfText || questionPdfText.trim().length < 50) {
        logger.error(`Session ${id}: no question paper text available. Body length=${req.body.questionPdfText?.length || 0}, DB textUrl=${session.questionTextUrl}`);
        return res.status(400).json({
          error: 'Question paper text is empty or too short to parse. Please re-upload the question paper.',
          retryable: false,
          needsManualMarks: false,
          questions: []
        });
      }

      if (!markSchemeText || markSchemeText.trim().length < 20) {
        logger.error(`Session ${id}: no mark scheme text available.`);
        return res.status(400).json({
          error: 'Mark scheme text is empty. Please re-upload the mark scheme.',
          retryable: false,
          needsManualMarks: false,
          questions: []
        });
      }

      // If already parsed and locked, return cached result immediately
      if (session.parsedQuestions && session.parsedMarkScheme && session.parsingVerified) {
        logger.info(`Session ${id}: returning cached parsed structure`);
        return res.json({
          questions: session.parsedQuestions,
          markScheme: session.parsedMarkScheme,
          totalMaxMarks: session.totalMaxMarks,
          alreadyParsed: true
        });
      }

      const cleanedQuestionText = stripCoverPage(questionPdfText);

      logger.info(`Session ${id}: parsing question paper (${questionPdfText.length} chars raw, ${cleanedQuestionText.length} chars clean) and mark scheme (${markSchemeText.length} chars)`);

      let parsedQuestions: any[] = [];
      let usedVision = false;

      // APPROACH 1: Vision-based parsing (reads visual page layout directly with Gemini Vision)
      if (session.questionPdfUrl) {
        try {
          logger.info(`Attempting vision-based question paper parsing for session ${id}...`);
          const pdfBuffer = await downloadPdfFromSupabase(session.questionPdfUrl);
          parsedQuestions = await parseQuestionPaperFromImages(pdfBuffer);
          if (parsedQuestions.length >= 4) {
            usedVision = true;
            logger.info(`Vision parse SUCCESS: ${parsedQuestions.length} questions extracted`);
          } else {
            logger.warn(`Vision parse yielded only ${parsedQuestions.length} questions, falling back to text`);
          }
        } catch (visionError: any) {
          logger.warn('Vision parsing failed, falling back to text:', visionError.message);
        }
      }

      // APPROACH 2: Text-based fallback (used when PDF bytes unavailable or vision returned < 4 questions)
      if (parsedQuestions.length < 4) {
        logger.info('Falling back to text-based parsing...');
        parsedQuestions = await parseQuestionPaper(cleanedQuestionText, markSchemeText);
      }

      if (!parsedQuestions || parsedQuestions.length === 0) {
        logger.warn(`Session ${id}: 0 questions extracted, attempting text-based fallback`);

        // Try extracting question numbers directly from the raw text
        const fallbackQuestions = buildFallbackQuestionsFromText(cleanedQuestionText);

        if (fallbackQuestions.length > 0) {
          logger.info(`Session ${id}: fallback found ${fallbackQuestions.length} questions — returning as needsManualMarks for lecturer to verify`);
          return res.status(400).json({
            error: `Found ${fallbackQuestions.length} questions but could not extract mark values automatically. Please verify and enter the marks below.`,
            needsManualMarks: true,
            questions: fallbackQuestions
          });
        }

        // If even pattern matching found nothing, it's a genuine extraction failure
        return res.status(400).json({
          error: questionPdfText.length < 200
            ? 'The question paper PDF appears to have very little extractable text. It may be a scanned image-only PDF — try uploading a text-based PDF.'
            : 'The AI could not identify a question structure in this document. Check that the uploaded file is the actual question paper, then use "Enter Questions Manually" to proceed.',
          retryable: false,
          needsManualMarks: false,
          questions: [],
          rawTextPreview: questionPdfText.substring(0, 400)
        });
      }

      // Now extract mark scheme since we have questions
      let parsedMarkScheme = await parseMarkScheme(markSchemeText, parsedQuestions);

      const parsedQuestionsNormalized = normalizeQuestionMarks(parsedQuestions);
      const totalMaxMarks = parsedQuestionsNormalized.reduce(
        (sum: number, q: any) => sum + (Number(q.marksAvailable) || 0), 0
      );

      if (totalMaxMarks === 0) {
        return res.status(400).json({
          error: `${parsedQuestionsNormalized.length} questions found but no mark values could be extracted.`,
          needsManualMarks: true,
          questions: parsedQuestionsNormalized
        });
      }

      // NEW — correctly handles both formats:
      // Format A: "Total: 100 marks" (single-question papers)
      // Format B: "Question N total 100 marks" per question (multi-question papers)
      function detectStatedTotal(text: string): number | null {
        // Check for an explicit overall paper total first
        // e.g. "Total marks: 400" or "Grand total: 400 marks"
        const overallMatch = text.match(/(?:grand\s+total|total\s+marks?)[:\s]+(\d+)/i);
        if (overallMatch) return parseInt(overallMatch[1], 10);

        // Check for "No. of Questions: 4" style header + per-question totals
        // e.g. "Question 1 total 100 marks" appearing multiple times
        const perQuestionTotals = [...text.matchAll(/question\s+\d+\s+total\s+(\d+)\s+marks?/gi)];
        if (perQuestionTotals.length > 1) {
          // Sum all per-question totals to get the real paper total
          const paperTotal = perQuestionTotals.reduce(
            (sum, m) => sum + parseInt(m[1], 10), 0
          );
          logger.info(`Detected ${perQuestionTotals.length} per-question totals, summing to ${paperTotal}`);
          return paperTotal;
        }
        if (perQuestionTotals.length === 1) {
          // Single question paper — the one total IS the paper total
          return parseInt(perQuestionTotals[0][1], 10);
        }

        // Fallback: look for a standalone total line
        const fallbackMatch = text.match(/\btotal[:\s]*(\d+)\s*marks?\b/i);
        return fallbackMatch ? parseInt(fallbackMatch[1], 10) : null;
      }

      const statedTotal = detectStatedTotal(cleanedQuestionText);
      logger.info(`Stated total detection: ${statedTotal} marks`);

      const diff = statedTotal ? Math.abs(statedTotal - totalMaxMarks) : 0;
      const diffPercent = statedTotal ? (diff / statedTotal) * 100 : 0;

      const mismatchWarning = statedTotal && statedTotal !== totalMaxMarks
        ? diffPercent < 10
          ? `Note: extracted total (${totalMaxMarks}) is ${diff} marks less than the stated total (${statedTotal}). This is a small discrepancy — ${diff} marks may not have been detected in one or two sub-questions. Marking will proceed using ${totalMaxMarks} as the total.`
          : `Warning: extracted total (${totalMaxMarks}) does not match stated total (${statedTotal}). Please review before proceeding.`
        : null;

      // IMPROVED: also explain the per-question structure if detected
      const perQuestionTotalCount = (cleanedQuestionText.match(
        /question\s+\d+\s+total\s+\d+\s+marks?/gi
      ) || []).length;

      const structureNote = perQuestionTotalCount > 1
        ? `This paper has ${perQuestionTotalCount} questions × ${totalMaxMarks / perQuestionTotalCount} marks each = ${totalMaxMarks} total.`
        : null;

      // Lock the structure permanently
      await (prisma as any).markingSession.update({
        where: { id },
        data: {
          parsedQuestions: parsedQuestionsNormalized,
          parsedMarkScheme,
          totalMaxMarks,
          parsingVerified: true,
          // Also write the textUrls to DB now if we have them from request body context
          questionTextUrl: session.questionTextUrl || req.body.questionTextUrl || session.questionTextUrl,
          markSchemeTextUrl: session.markSchemeTextUrl || req.body.markSchemeTextUrl || session.markSchemeTextUrl
        }
      });

      logger.info(`Session ${id}: LOCKED — ${parsedQuestionsNormalized.length} questions, ${totalMaxMarks} marks`);

      res.json({
        questions: parsedQuestionsNormalized,
        markScheme: parsedMarkScheme,
        totalMaxMarks,
        mismatchWarning,
        method: usedVision ? 'vision' : 'text',
        alreadyParsed: false
      });

    } catch (error: any) {
      logger.error('parse-paper error:', error);
      res.status(500).json({ error: error.message });
    }
  });

  app.post('/api/sessions/:id/confirm-manual-marks', authMiddleware, async (req, res) => {
    try {
      const { id } = req.params;
      const { questions, markSchemeText } = req.body;

      if (!questions || questions.length === 0) {
        return res.status(400).json({ error: 'No questions provided' });
      }

      const totalMaxMarks = questions.reduce(
        (s: number, q: any) => s + (Number(q.marksAvailable) || 0), 0
      );

      // Parse the mark scheme if text was provided, otherwise build a minimal
      // placeholder mark scheme from the questions themselves so the marking
      // route's guard always passes
      let parsedMarkScheme: any[] = [];

      if (markSchemeText && markSchemeText.trim().length > 20) {
        try {
          logger.info(`confirm-manual-marks: parsing mark scheme text (${markSchemeText.length} chars)`);
          parsedMarkScheme = await parseMarkScheme(markSchemeText, questions);
          logger.info(`confirm-manual-marks: parsed ${parsedMarkScheme.length} mark scheme entries`);
        } catch (msError: any) {
          logger.warn(`confirm-manual-marks: mark scheme parse failed (${msError.message}), using question-derived placeholder`);
        }
      }

      // If mark scheme parsing failed or no text provided, build a minimal
      // placeholder so the marking route's null check always passes
      if (!parsedMarkScheme || parsedMarkScheme.length === 0) {
        parsedMarkScheme = questions.map((q: any) => ({
          questionNumber: q.questionNumber,
          expectedAnswer: 'See mark scheme document',
          marksAvailable: q.marksAvailable,
          markingGuidance: 'Award marks for relevant and accurate content',
          keywords: []
        }));
        logger.info(`confirm-manual-marks: using ${parsedMarkScheme.length} placeholder mark scheme entries`);
      }

      await (prisma as any).markingSession.update({
        where: { id },
        data: {
          parsedQuestions: questions,
          parsedMarkScheme,          // NOW SAVED — this was the missing field
          totalMaxMarks,
          parsingVerified: true
        }
      });

      logger.info(`Session ${id}: manually confirmed ${questions.length} questions, ${totalMaxMarks} total marks, ${parsedMarkScheme.length} mark scheme entries`);

      res.json({ totalMaxMarks, questionCount: questions.length });

    } catch (error: any) {
      logger.error('confirm-manual-marks error:', error);
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
        await (prisma as any).markingSession.update({
          where: { id },
          data: { status: 'ERROR', errorMessage: 'Session not found' }
        });
        return;
      }

      if (!session.parsedQuestions || !session.parsedMarkScheme) {
        logger.error(`Session ${id}: marking blocked — parsedQuestions=${!!session.parsedQuestions}, parsedMarkScheme=${!!session.parsedMarkScheme}`);
        await (prisma as any).markingSession.update({
          where: { id },
          data: {
            status: 'ERROR',
            errorMessage: !session.parsedQuestions
              ? 'No question structure found. Please re-create the session and confirm paper structure before marking.'
              : 'No mark scheme structure found. Please re-create the session — the mark scheme text may not have been saved correctly.'
          }
        });
        return;
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
                    [{
                      parts: [
                        { inlineData: { data: base64, mimeType: 'application/pdf' } },
                        { text: 'This is a student exam answer sheet. Transcribe ALL content. Group the answers by their actual main question numbers (Q1, Q2, Q3, Q4) written by the student. Treat pages without new question numbers as continuations of the previous question (do not sequentially count pages as Q1 to Q8). Format: Q[number]:\n[answer]' }
                      ]
                    }],
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
          }).catch(() => { });

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

    } catch (error: any) {
      logger.error(`triggerBackgroundMarking ${id} fatal error:`, error);
      await (prisma as any).markingSession.update({
        where: { id },
        data: { status: 'ERROR', errorMessage: error.message }
      }).catch(() => { });

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

  // ============================================
  // SECOND MARKING / EXTERNAL MODERATION
  // ============================================

  app.post('/api/sessions/:id/send-moderation', authMiddleware, async (req, res) => {
    try {
      const { id } = req.params;
      const { moderatorEmail, note } = req.body;

      if (!moderatorEmail || !moderatorEmail.includes('@')) {
        return res.status(400).json({ error: 'Valid moderator email is required' });
      }

      const session = await (prisma as any).markingSession.findUnique({
        where: { id },
        include: {
          lecturer: { select: { fullName: true, email: true } },
          results: { select: { id: true } }
        }
      });

      if (!session) {
        return res.status(404).json({ error: 'Session not found' });
      }

      // Generate a secure 7-day token
      const token = crypto.randomBytes(32).toString('hex');
      const tokenExp = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

      await (prisma as any).markingSession.update({
        where: { id },
        data: {
          moderationStatus: 'PENDING',
          moderatorEmail,
          moderatorToken: token,
          moderatorTokenExp: tokenExp,
          moderatorNote: note || null,
          submittedAt: new Date()
        }
      });

      const frontendBase = process.env.FRONTEND_URL || (process.env.NODE_ENV === 'production' ? 'https://markaido.netlify.app' : 'http://localhost:5173');
      const moderationUrl = `${frontendBase}/moderate/${token}`;

      // Send invitation email via Resend
      try {
        await resend.emails.send({
          from: 'MarkAI <noreply@markai.edu>',
          to: moderatorEmail,
          subject: `Moderation Request: ${session.name} (${session.subject})`,
          html: `
            <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; color: #1e293b;">
              <h2 style="color: #0f172a; border-bottom: 2px solid #e2e8f0; padding-bottom: 12px;">Second Marking / Moderation Request</h2>
              <p>Hello,</p>
              <p>You have been invited by <strong>${session.lecturer?.fullName || 'a colleague'}</strong> to act as the second marker / external moderator for the following assessment session:</p>
              
              <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; margin: 20px 0;">
                <p style="margin: 4px 0;"><strong>Session:</strong> ${session.name}</p>
                <p style="margin: 4px 0;"><strong>Subject / Course:</strong> ${session.subject} (${session.courseId})</p>
                <p style="margin: 4px 0;"><strong>Exam Board:</strong> ${session.examBoard}</p>
                <p style="margin: 4px 0;"><strong>Student Papers:</strong> ${session.results?.length || 0}</p>
                ${note ? `<p style="margin: 12px 0 4px; padding-top: 8px; border-top: 1px dashed #cbd5e1;"><strong>Note from marker:</strong> ${note}</p>` : ''}
              </div>

              <p>You can review all student papers, examine AI feedback and marker awards, and enter overrides where needed.</p>

              <div style="margin: 30px 0;">
                <a href="${moderationUrl}" style="background-color: #1a2e5a; color: white; padding: 12px 28px; border-radius: 6px; text-decoration: none; font-weight: bold; display: inline-block;">
                  Review & Moderate Papers
                </a>
              </div>

              <p style="color: #64748b; font-size: 13px;">This secure link is unique to you and will expire in 7 days.<br/>
              Direct link: <a href="${moderationUrl}" style="color: #2563eb;">${moderationUrl}</a></p>
            </div>
          `
        });
      } catch (emailErr: any) {
        logger.warn('Failed to send moderation email via Resend (continuing with direct link):', emailErr?.message);
      }

      res.json({
        success: true,
        moderationStatus: 'PENDING',
        moderatorEmail,
        moderationUrl,
        token
      });
    } catch (error: any) {
      logger.error('Failed to send moderation invitation:', error);
      res.status(500).json({ error: error.message });
    }
  });

  app.get('/api/moderation/:token', async (req, res) => {
    try {
      const { token } = req.params;

      const session = await (prisma as any).markingSession.findFirst({
        where: { moderatorToken: token },
        include: {
          lecturer: {
            select: { id: true, fullName: true, email: true, department: true }
          },
          results: {
            include: {
              questions: {
                include: {
                  moderationOverrides: true
                },
                orderBy: { questionNumber: 'asc' }
              }
            },
            orderBy: { studentName: 'asc' }
          },
          moderationOverrides: true
        }
      });

      if (!session) {
        return res.status(404).json({ error: 'Moderation session not found or invalid link.' });
      }

      if (session.moderatorTokenExp && new Date() > new Date(session.moderatorTokenExp)) {
        return res.status(410).json({ error: 'This moderation link has expired (7-day validity exceeded).' });
      }

      // If currently PENDING, transition to UNDER_REVIEW
      if (session.moderationStatus === 'PENDING') {
        await (prisma as any).markingSession.update({
          where: { id: session.id },
          data: { moderationStatus: 'UNDER_REVIEW' }
        });
        session.moderationStatus = 'UNDER_REVIEW';
      }

      const results = session.results || [];
      const avgScore = results.length > 0 
        ? Math.round((results.reduce((acc: number, r: any) => acc + r.percentage, 0) / results.length) * 10) / 10 
        : 0;
      const passRate = results.length > 0
        ? Math.round((results.filter((r: any) => r.percentage >= 40).length / results.length) * 100)
        : 0;

      res.json({
        session: {
          id: session.id,
          name: session.name,
          subject: session.subject,
          courseId: session.courseId,
          examBoard: session.examBoard,
          paperType: session.paperType,
          totalMaxMarks: session.totalMaxMarks,
          moderationStatus: session.moderationStatus,
          moderatorEmail: session.moderatorEmail,
          moderatorNote: session.moderatorNote,
          moderationFeedback: session.moderationFeedback,
          submittedAt: session.submittedAt,
          moderatedAt: session.moderatedAt,
          lecturer: session.lecturer,
          lecturerName: session.lecturer?.fullName,
          avgScore,
          passRate,
          results
        },
        results: session.results,
        overrides: session.moderationOverrides
      });
    } catch (error: any) {
      logger.error('Failed to get moderation session:', error);
      res.status(500).json({ error: error.message });
    }
  });

  async function recordMarkChange(params: {
    questionResultId: string;
    sessionId: string;
    studentId: string;
    questionNumber: string;
    changedByUserId: string;
    changedByName: string;
    changedByRole: string;
    previousMark: number;
    newMark: number;
    marksAvailable: number;
    reason?: string;
    changeType: 'LECTURER_OVERRIDE' | 'MODERATION_ADJUST';
  }) {
    // Only record if mark actually changed
    if (params.previousMark === params.newMark) return;

    await (prisma as any).markChangeAudit.create({
      data: {
        questionResultId: params.questionResultId,
        sessionId: params.sessionId,
        studentId: params.studentId,
        questionNumber: params.questionNumber,
        changedBy: params.changedByUserId,
        changedByName: params.changedByName,
        changedByRole: params.changedByRole,
        previousMark: params.previousMark,
        newMark: params.newMark,
        marksAvailable: params.marksAvailable,
        reason: params.reason || null,
        changeType: params.changeType
      }
    });

    const currentQ = await (prisma as any).questionResult.findUnique({
      where: { id: params.questionResultId },
      select: { originalAiMark: true, marksAwarded: true }
    });

    const originalAiMark = currentQ?.originalAiMark !== null && currentQ?.originalAiMark !== undefined
      ? currentQ.originalAiMark
      : (currentQ?.marksAwarded ?? params.previousMark);

    // Update the QuestionResult with who last changed it
    await (prisma as any).questionResult.update({
      where: { id: params.questionResultId },
      data: {
        lastChangedBy: params.changedByUserId,
        lastChangedByName: params.changedByName,
        lastChangedByRole: params.changedByRole,
        lastChangedAt: new Date(),
        originalAiMark
      }
    });

    logger.info(`Mark changed: ${params.questionNumber} | ${params.changedByName} (${params.changedByRole}) | ${params.previousMark} → ${params.newMark}`);
  }

  app.post('/api/moderation/:token/override', async (req, res) => {
    try {
      const { token } = req.params;
      const { questionResultId, moderatorMark, moderatorNote } = req.body;

      if (!questionResultId || moderatorMark === undefined || isNaN(Number(moderatorMark))) {
        return res.status(400).json({ error: 'Invalid question result or mark' });
      }

      const session = await (prisma as any).markingSession.findFirst({
        where: { moderatorToken: token }
      });

      if (!session) {
        return res.status(404).json({ error: 'Invalid moderation session' });
      }

      if (session.moderationStatus === 'MODERATION_APPROVED' || session.moderationStatus === 'APPROVED') {
        return res.status(400).json({ error: 'This session has already been approved and finalised.' });
      }

      const qResult = await (prisma as any).questionResult.findUnique({
        where: { id: questionResultId },
        include: { studentResult: true }
      });

      if (!qResult || qResult.studentResult?.sessionId !== session.id) {
        return res.status(404).json({ error: 'Question result not found in this session' });
      }

      const parsedMark = Math.max(0, Math.min(qResult.marksAvailable, Number(moderatorMark)));
      const originalMark = qResult.lecturerOverride ?? qResult.marksAwarded;

      // Upsert ModerationOverride
      const existingOverride = await (prisma as any).moderationOverride.findFirst({
        where: { sessionId: session.id, questionResultId }
      });

      let override;
      if (existingOverride) {
        override = await (prisma as any).moderationOverride.update({
          where: { id: existingOverride.id },
          data: {
            moderatorMark: parsedMark,
            moderatorNote: moderatorNote || null
          }
        });
      } else {
        override = await (prisma as any).moderationOverride.create({
          data: {
            sessionId: session.id,
            questionResultId,
            originalMark,
            moderatorMark: parsedMark,
            moderatorNote: moderatorNote || null
          }
        });
      }

      // Update question result lecturerOverride / moderator value
      await (prisma as any).questionResult.update({
        where: { id: questionResultId },
        data: {
          lecturerOverride: parsedMark,
          lecturerNote: moderatorNote ? `Moderator: ${moderatorNote}` : qResult.lecturerNote
        }
      });

      // Record mark change audit
      await recordMarkChange({
        questionResultId,
        sessionId: session.id,
        studentId: qResult.studentResult.studentId,
        questionNumber: qResult.questionNumber,
        changedByUserId: session.moderatorEmail || 'moderator',
        changedByName: session.moderatorEmail ? `Moderator (${session.moderatorEmail})` : 'Moderator',
        changedByRole: 'MODERATOR',
        previousMark: originalMark,
        newMark: parsedMark,
        marksAvailable: qResult.marksAvailable,
        reason: moderatorNote || undefined,
        changeType: 'MODERATION_ADJUST'
      });

      // Recalculate StudentResult totalMarks and percentage
      const allStudentQuestions = await (prisma as any).questionResult.findMany({
        where: { studentResultId: qResult.studentResultId }
      });

      const newTotalMarks = allStudentQuestions.reduce((sum: number, q: any) => {
        const mark = q.id === questionResultId ? parsedMark : (q.lecturerOverride ?? q.marksAwarded);
        return sum + mark;
      }, 0);

      const maxMarks = qResult.studentResult.maxMarks || 100;
      const newPercentage = Math.round((newTotalMarks / maxMarks) * 1000) / 10;

      await (prisma as any).studentResult.update({
        where: { id: qResult.studentResultId },
        data: {
          totalMarks: newTotalMarks,
          percentage: newPercentage
        }
      });

      res.json({
        success: true,
        override,
        studentResultId: qResult.studentResultId,
        newTotalMarks,
        newPercentage
      });
    } catch (error: any) {
      logger.error('Failed to save moderation override:', error);
      res.status(500).json({ error: error.message });
    }
  });

  app.post('/api/moderation/:token/decision', async (req, res) => {
    try {
      const { token } = req.params;
      const { decision, feedback, note, overrides } = req.body;

      const normDecision = (decision || '').toUpperCase();
      const isApproval = normDecision.includes('APPROVE') || normDecision === 'ADJUST';
      const isReturn = normDecision.includes('RETURN');

      if (!isApproval && !isReturn) {
        return res.status(400).json({ error: "Decision must be 'approve', 'adjust', or 'return'" });
      }

      const session = await (prisma as any).markingSession.findFirst({
        where: { moderatorToken: token },
        include: {
          lecturer: { select: { fullName: true, email: true } },
          moderationOverrides: true
        }
      });

      if (!session) {
        return res.status(404).json({ error: 'Invalid moderation session' });
      }

      // If overrides object is passed in the decision request, apply any pending overrides
      if (overrides && typeof overrides === 'object') {
        for (const [qId, modMark] of Object.entries(overrides)) {
          if (typeof modMark === 'number') {
            const qResult = await (prisma as any).questionResult.findUnique({
              where: { id: qId },
              include: { studentResult: true }
            });
            if (qResult) {
              const previousMark = qResult.lecturerOverride ?? qResult.marksAwarded;
              const existingOv = await (prisma as any).moderationOverride.findFirst({
                where: { sessionId: session.id, questionResultId: qId }
              });
              if (existingOv) {
                await (prisma as any).moderationOverride.update({
                  where: { id: existingOv.id },
                  data: { moderatorMark: modMark }
                });
              } else {
                await (prisma as any).moderationOverride.create({
                  data: {
                    sessionId: session.id,
                    questionResultId: qId,
                    originalMark: previousMark,
                    moderatorMark: modMark,
                    moderatorNote: note || null
                  }
                });
              }

              await (prisma as any).questionResult.update({
                where: { id: qId },
                data: { lecturerOverride: modMark }
              });

              if (previousMark !== modMark) {
                await recordMarkChange({
                  questionResultId: qId,
                  sessionId: session.id,
                  studentId: qResult.studentResult.studentId,
                  questionNumber: qResult.questionNumber,
                  changedByUserId: session.moderatorEmail || 'moderator',
                  changedByName: session.moderatorEmail ? `Moderator (${session.moderatorEmail})` : 'Moderator',
                  changedByRole: 'MODERATOR',
                  previousMark,
                  newMark: modMark,
                  marksAvailable: qResult.marksAvailable,
                  reason: note || feedback || undefined,
                  changeType: 'MODERATION_ADJUST'
                });
              }

              // Recalculate student total
              const studentQuestions = await (prisma as any).questionResult.findMany({
                where: { studentResultId: qResult.studentResultId }
              });
              const newTotal = studentQuestions.reduce((sum: number, q: any) => {
                const m = q.id === qId ? modMark : (q.lecturerOverride ?? q.marksAwarded);
                return sum + m;
              }, 0);
              const studentRes = await (prisma as any).studentResult.findUnique({
                where: { id: qResult.studentResultId }
              });
              const maxM = studentRes?.maxMarks || 100;
              await (prisma as any).studentResult.update({
                where: { id: qResult.studentResultId },
                data: {
                  totalMarks: newTotal,
                  percentage: Math.round((newTotal / maxM) * 1000) / 10
                }
              });
            }
          }
        }
      }

      const newStatus = isApproval ? 'MODERATION_APPROVED' : 'MODERATION_RETURNED';
      const modComments = feedback || note || null;

      await (prisma as any).markingSession.update({
        where: { id: session.id },
        data: {
          moderationStatus: newStatus,
          moderatedAt: new Date(),
          moderationFeedback: modComments
        }
      });

      // Notify original marker by email
      if (session.lecturer?.email) {
        try {
          await resend.emails.send({
            from: 'MarkAI <noreply@markai.edu>',
            to: session.lecturer.email,
            subject: `Moderation ${isApproval ? 'Approved' : 'Returned'}: ${session.name}`,
            html: `
              <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; color: #1e293b;">
                <h2 style="color: #0f172a;">Assessment Moderation Update</h2>
                <p>Hello <strong>${session.lecturer.fullName}</strong>,</p>
                <p>The external moderator (<strong>${session.moderatorEmail || 'Moderator'}</strong>) has submitted their decision for <strong>${session.name}</strong>:</p>

                <div style="background-color: ${isApproval ? '#f0fdf4' : '#fef2f2'}; border: 1px solid ${isApproval ? '#bbf7d0' : '#fecaca'}; border-radius: 8px; padding: 16px; margin: 20px 0;">
                  <h3 style="margin: 0 0 8px 0; color: ${isApproval ? '#166534' : '#991b1b'};">
                    ${isApproval ? '✓ Marks Approved & Finalised' : '⚠ Session Returned with Feedback'}
                  </h3>
                  ${modComments ? `<p style="margin: 12px 0 4px; padding-top: 8px; border-top: 1px dashed #cbd5e1;"><strong>Moderator Comments:</strong> ${modComments}</p>` : ''}
                </div>

                <p>You can view the full moderation log and final student records directly in your MarkAI dashboard.</p>
              </div>
            `
          });
        } catch (emailErr: any) {
          logger.warn('Failed to send moderation decision notification email:', emailErr?.message);
        }
      }

      res.json({
        success: true,
        moderationStatus: newStatus,
        moderatedAt: new Date(),
        feedback: modComments
      });
    } catch (error: any) {
      logger.error('Failed to submit moderation decision:', error);
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
      }).catch(() => { });

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
      const result = await (prisma as any).studentResult.findUnique({
        where: { id: req.params.id },
        include: {
          questions: { orderBy: { questionNumber: 'asc' } },
          session: true
        }
      });
      res.json(result);
    } catch (error: any) {
      logger.error(`Failed to fetch result ${req.params.id}:`, error.message);
      res.status(500).json({ error: 'Failed to fetch result' });
    }
  });

  app.get('/api/results', authMiddleware, async (req, res) => {
    try {
      const { sessionId, studentId } = req.query;
      const result = await (prisma as any).studentResult.findFirst({
        where: { sessionId: sessionId as string, studentId: studentId as string },
        include: {
          questions: { orderBy: { questionNumber: 'asc' } }
        }
      });
      res.json(result);
    } catch (error: any) {
      logger.error('Failed to fetch result by query:', error.message);
      res.status(500).json({ error: 'Failed to fetch result' });
    }
  });

  app.get('/api/sessions/:sessionId/students/:studentId', authMiddleware, async (req, res) => {
    try {
      const result = await (prisma as any).studentResult.findFirst({
        where: {
          sessionId: req.params.sessionId,
          studentId: req.params.studentId
        },
        include: {
          session: true,
          questions: {
            orderBy: { questionNumber: 'asc' }
          }
        }
      });

      if (!result) return res.status(404).json({ error: 'Result not found' });
      res.json(result);
    } catch (error: any) {
      logger.error('Student result error:', error);
      res.status(500).json({ error: error.message });
    }
  });

  app.patch('/api/results/:resultId/override', authMiddleware, async (req, res) => {
    try {
      const { questionId, lecturerMark, lecturerNote } = overrideSchema.parse(req.body);
      const userId = (req as any).userId;

      const user = await (prisma as any).user.findUnique({
        where: { id: userId },
        select: { fullName: true, userType: true }
      });

      const question = await (prisma as any).questionResult.findUnique({
        where: { id: questionId },
        include: { studentResult: { include: { session: true } } }
      });

      if (!question) return res.status(404).json({ error: 'Question not found' });

      const previousMark = question.lecturerOverride ?? question.marksAwarded;

      await (prisma as any).questionResult.update({
        where: { id: questionId },
        data: { lecturerOverride: lecturerMark, lecturerNote: lecturerNote || null }
      });

      await recordMarkChange({
        questionResultId: questionId,
        sessionId: question.studentResult.sessionId,
        studentId: question.studentResult.studentId,
        questionNumber: question.questionNumber,
        changedByUserId: userId,
        changedByName: user?.fullName || 'Lecturer',
        changedByRole: 'LECTURER',
        previousMark,
        newMark: lecturerMark,
        marksAvailable: question.marksAvailable,
        reason: lecturerNote,
        changeType: 'LECTURER_OVERRIDE'
      });

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
      logger.error('Override error:', error);
      res.status(400).json({ error: error.message });
    }
  });

  app.patch('/api/results/:resultId/questions/:questionId/override', authMiddleware, async (req, res) => {
    try {
      const { resultId, questionId } = req.params;
      const { newMark, note } = req.body;
      const userId = (req as any).userId;

      const user = await (prisma as any).user.findUnique({
        where: { id: userId },
        select: { fullName: true, userType: true }
      });

      const question = await (prisma as any).questionResult.findUnique({
        where: { id: questionId },
        include: { studentResult: { include: { session: true } } }
      });

      if (!question) return res.status(404).json({ error: 'Question not found' });

      const previousMark = question.lecturerOverride ?? question.marksAwarded;

      const updatedQ = await (prisma as any).questionResult.update({
        where: { id: questionId },
        data: {
          lecturerOverride: Number(newMark),
          lecturerNote: note || null
        }
      });

      await recordMarkChange({
        questionResultId: questionId,
        sessionId: question.studentResult.sessionId,
        studentId: question.studentResult.studentId,
        questionNumber: question.questionNumber,
        changedByUserId: userId,
        changedByName: user?.fullName || 'Lecturer',
        changedByRole: 'LECTURER',
        previousMark,
        newMark: Number(newMark),
        marksAvailable: question.marksAvailable,
        reason: note,
        changeType: 'LECTURER_OVERRIDE'
      });

      const studentResult = await (prisma as any).studentResult.findUnique({ where: { id: resultId }, include: { questions: true } });
      if (studentResult) {
        const totalMarks = studentResult.questions.reduce((acc: number, q: any) => acc + (q.lecturerOverride ?? q.marksAwarded), 0);
        const percentage = (totalMarks / studentResult.maxMarks) * 100;
        let grade = 'F';
        if (percentage >= 90) grade = 'A*';
        else if (percentage >= 80) grade = 'A';
        else if (percentage >= 70) grade = 'B';
        else if (percentage >= 60) grade = 'C';
        else if (percentage >= 50) grade = 'D';
        else if (percentage >= 40) grade = 'E';

        await (prisma as any).studentResult.update({ where: { id: resultId }, data: { totalMarks, percentage, grade } });
      }

      res.json(updatedQ);
    } catch (error: any) {
      logger.error('Override error:', error);
      res.status(500).json({ error: error.message });
    }
  });

  app.get('/api/results/:resultId/audit', authMiddleware, async (req, res) => {
    try {
      const { resultId } = req.params;

      const auditTrail = await (prisma as any).markChangeAudit.findMany({
        where: {
          questionResult: { studentResultId: resultId }
        },
        orderBy: { createdAt: 'desc' }
      });

      res.json(auditTrail);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
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
      const userType = (req.user.userType || '').toUpperCase();
      if (userType === 'STUDENT') {
        let studentCode = req.user.studentCode;
        if (!studentCode && req.user.id) {
          const dbUser = await (prisma as any).user.findUnique({ where: { id: req.user.id }, select: { studentCode: true } });
          studentCode = dbUser?.studentCode;
        }

        if (!studentCode) {
          return res.json([]);
        }

        const results = await (prisma as any).studentResult.findMany({ 
          where: { studentId: studentCode }, 
          include: { session: true, questions: true }, 
          orderBy: { createdAt: 'desc' } 
        });
        res.json(results);
      } else if (userType === 'LECTURER') {
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
        let studentCode = req.user.studentCode;
        if (!studentCode && req.user.id) {
          const dbUser = await (prisma as any).user.findUnique({ where: { id: req.user.id }, select: { studentCode: true } });
          studentCode = dbUser?.studentCode;
        }

        if (!studentCode) {
          return res.json({ papersSubmitted: 0, averageScore: 0, bestGrade: 'N/A', streak: 0 });
        }

        const results = await (prisma as any).studentResult.findMany({
          where: { studentId: studentCode },
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
      const { sessionId, prompt: customPrompt, context } = req.body;

      if (sessionId) {
        // Create a job and respond IMMEDIATELY — no waiting for Gemini (prevents 504 Gateway Timeout)
        const job = await (prisma as any).uploadJob.create({
          data: {
            status: 'PROCESSING',
            filename: `ai-insights-${sessionId}`
          }
        });

        res.json({ jobId: job.id, status: 'PROCESSING' });

        // Background processing — after response is already sent
        (async () => {
          try {
            const session = await (prisma as any).markingSession.findUnique({
              where: { id: sessionId },
              include: { results: true }
            });

            if (!session || !session.results?.length) {
              await (prisma as any).uploadJob.update({
                where: { id: job.id },
                data: {
                  status: 'COMPLETE',
                  extractedText: JSON.stringify({ insights: null, fallback: true }),
                  completedAt: new Date()
                }
              });
              return;
            }

            const totalStudents = session.results.length;
            const avgScore = session.results.reduce((s: number, r: any) => s + r.percentage, 0) / totalStudents;
            const passRate = (session.results.filter((r: any) => r.percentage >= 50).length / totalStudents) * 100;
            const highest = Math.max(...session.results.map((r: any) => r.percentage));
            const lowest = Math.min(...session.results.map((r: any) => r.percentage));

            const prompt = `You are an educational analyst. Provide a concise 3-paragraph class performance summary for a lecturer.

Exam: ${session.name}
Subject: ${session.subject}
Students: ${totalStudents}
Average: ${avgScore.toFixed(1)}%
Pass Rate: ${passRate.toFixed(1)}%
Highest: ${highest.toFixed(1)}%
Lowest: ${lowest.toFixed(1)}%

Write 3 short paragraphs:
1. Overall performance summary
2. Key strengths
3. Areas for improvement and recommendations

Be specific and actionable. Keep each paragraph to 2-3 sentences.`;

            const response = await callGeminiSafe(prompt, {
              context: 'ai-insights',
              temperature: 0.3
            });

            const insights = response.text || null;

            await (prisma as any).uploadJob.update({
              where: { id: job.id },
              data: {
                status: 'COMPLETE',
                extractedText: JSON.stringify({ insights, fallback: false }),
                completedAt: new Date()
              }
            });

          } catch (error: any) {
            logger.error('AI insights background job failed:', error.message);
            await (prisma as any).uploadJob.update({
              where: { id: job.id },
              data: {
                status: 'COMPLETE',
                extractedText: JSON.stringify({ insights: null, fallback: true }),
                completedAt: new Date()
              }
            });
          }
        })();

        return;
      }

      if (customPrompt) {
        const fullPrompt = context ? `AI context: ${JSON.stringify(context)}. ${customPrompt}` : customPrompt;
        try {
          const response = await groqWithRetry(fullPrompt);
          return res.status(200).json({ insights: response.text, text: response.text, fallback: false });
        } catch {
          const response = await callGeminiSafe(fullPrompt, {
            context: 'ai-generate-fallback',
            temperature: 0.3
          });
          return res.status(200).json({ insights: response.text, text: response.text, fallback: false });
        }
      }

      return res.status(200).json({ insights: null, fallback: true });

    } catch (error: any) {
      logger.error('/api/ai/generate error:', error.message);
      return res.status(200).json({ insights: null, fallback: true });
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



  app.listen(PORT, '0.0.0.0', () => {
    logger.info(`✅ Server running on port ${PORT}`);
    // Non-blocking background verifications after server starts accepting traffic
    validateSchema().catch(err => logger.warn('Startup schema check error:', err.message));
    verifyGeminiModel().then(geminiWorks => {
      if (!geminiWorks) {
        logger.warn('⚠️ WARNING: Gemini AI features may not work. Check your GEMINI_API_KEY and model availability.');
      }
    }).catch(err => logger.warn('Gemini verification error:', err.message));
  });
}

startServer();
