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
  'GEMINI_API_KEY',
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
// Add keys as GEMINI_API_KEY_1, GEMINI_API_KEY_2, ... in .env
// Falls back to GEMINI_API_KEY for backward compatibility
const geminiKeyPool: string[] = [];
for (let i = 1; ; i++) {
  const key = process.env[`GEMINI_API_KEY_${i}`];
  if (!key) break;
  geminiKeyPool.push(key);
}
if (geminiKeyPool.length === 0 && process.env.GEMINI_API_KEY) {
  geminiKeyPool.push(process.env.GEMINI_API_KEY);
}

if (geminiKeyPool.length === 0) {
  console.error('❌ No Gemini API keys configured. Set GEMINI_API_KEY or GEMINI_API_KEY_1 in .env');
  process.exit(1);
}

logger.info(`🔑 Gemini key pool initialized with ${geminiKeyPool.length} key(s)`);

let currentKeyIndex = 0;
const exhaustedKeys = new Set<number>(); // tracks keys that hit daily quota

// Reset exhausted key tracking every hour
setInterval(() => {
  if (exhaustedKeys.size > 0) {
    logger.info(`Resetting exhausted Gemini key tracking (${exhaustedKeys.size} keys)`);
    exhaustedKeys.clear();
  }
}, 60 * 60 * 1000);

function getActiveGenAI(): { client: GoogleGenAI; keyIndex: number } {
  // Find next non-exhausted key
  for (let i = 0; i < geminiKeyPool.length; i++) {
    const idx = (currentKeyIndex + i) % geminiKeyPool.length;
    if (!exhaustedKeys.has(idx)) {
      currentKeyIndex = idx;
      return { client: new GoogleGenAI({ apiKey: geminiKeyPool[idx] }), keyIndex: idx };
    }
  }
  // All keys exhausted — reset and use first
  exhaustedKeys.clear();
  currentKeyIndex = 0;
  logger.warn('All Gemini API keys exhausted — resetting pool and retrying from key 1');
  return { client: new GoogleGenAI({ apiKey: geminiKeyPool[0] }), keyIndex: 0 };
}

// Legacy helper — some code paths (OCR, /api/ai/generate) call this directly
function getGenAI(): GoogleGenAI {
  return getActiveGenAI().client;
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
  maxTokens?: number
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
        ...(maxTokens ? { max_tokens: maxTokens } : {})
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

async function parseQuestionPaper(
  questionPdfText: string
): Promise<any[]> {

  logger.info('Gemini: Parsing question paper...');

  const prompt = `
You are an expert exam paper analyser.

Read this entire question paper carefully and extract every question
including all sub-questions.

QUESTION PAPER:
${questionPdfText}

Instructions:
- Identify every question and sub-question in the paper
- Understand exactly what each question is asking the student
- Extract the marks available for each question
- Identify the topic or concept each question is testing
- Include questions numbered like 1, 1a, 1(b), Q1, Q1a etc

Return ONLY a valid JSON array.
No markdown. No backticks. No explanation. Just the JSON array.

Format:
[
  {
    "questionNumber": "1a",
    "questionText": "Write the full question text exactly as it appears",
    "marksAvailable": 2,
    "topic": "topic this question tests",
    "questionType": "short answer or calculation or definition or essay or diagram"
  }
]

Rules:
1. questionNumber must match exactly what is printed in the paper
2. questionText must be the complete unmodified question
3. Extract marks from patterns like [2] or (3 marks) or /4
4. If marks not visible set marksAvailable to null
5. Every question including sub-questions must be included
6. Do not skip any question no matter how short`;

  try {
    const response = await groqWithRetry(prompt);

    const text = extractJSON(response.text || '[]', 'array');
    const parsed = JSON.parse(text);

    logger.info(`Gemini parsed ${parsed.length} questions from paper`);
    return parsed;

  } catch (error) {
    logger.error('Gemini failed to parse question paper:', error);
    return [];
  }
}

async function parseMarkScheme(
  markSchemeText: string,
  parsedQuestions: any[]
): Promise<any[]> {

  logger.info('Gemini: Parsing mark scheme...');

  const prompt = `
Extract the KEY MARKING CRITERIA from this mark scheme.
For each question identify:
1. Required keywords (must appear for full marks)
2. Accept alternatives (other valid phrasings)
3. Reject list (wrong answers that look correct)
4. Method marks (marks for correct approach even if answer wrong)

MARK SCHEME:
${markSchemeText}

QUESTIONS FROM PAPER (use these to match question numbers):
${JSON.stringify(parsedQuestions, null, 2)}

Return ONLY a valid JSON array. No markdown.

Format:
[
  {
    "questionNumber": "1a",
    "requiredKeywords": ["must appear for full marks"],
    "acceptAlternatives": ["other valid phrasings"],
    "rejectList": ["wrong answers that look correct"],
    "methodMarks": "marks for correct approach even if answer wrong"
  }
]`;

  try {
    const response = await groqWithRetry(prompt);

    const text = extractJSON(response.text || '[]', 'array');
    const parsed = JSON.parse(text);

    logger.info(`Gemini parsed ${parsed.length} mark scheme entries`);
    return parsed;

  } catch (error) {
    logger.error('Gemini failed to parse mark scheme:', error);
    return [];
  }
}

async function markStudentAnswers(
  studentAnswerText: string,
  studentId: string,
  questionPdfText: string,
  markSchemeText: string,
  parsedQuestions: any[],
  parsedMarkScheme: any[],
  session: any
): Promise<any> {
  console.log('✅ markStudentAnswers CALLED for student:', studentId);
  console.log('📝 Answer text length:', studentAnswerText?.length);
  console.log('❓ Questions count:', parsedQuestions?.length);
  console.log('📊 Mark scheme count:', parsedMarkScheme?.length);

  logger.info(`Gemini: Marking student ${studentId}...`);

  // Build strictness instruction based on session setting
  const strictnessInstruction =
    session.markingStrictness === 'Strict'
      ? `STRICT MARKING:
         Award marks ONLY when the student uses exact keywords from the mark scheme.
         Do not give benefit of the doubt.
         Vague or imprecise answers receive zero marks.
         Partial credit only when the mark scheme explicitly allows it.`
      : session.markingStrictness === 'Lenient'
      ? `LENIENT MARKING:
         Award marks when the student clearly understands the concept.
         Accept reasonable alternative phrasings.
         Give benefit of the doubt for minor errors.
         Award partial marks generously for partially correct answers.`
      : `STANDARD MARKING:
         Award marks for answers demonstrating correct understanding.
         Allow minor variations in wording.
         Do not penalise spelling mistakes unless they change the meaning.
         Be fair and consistent.`;

  // Build feedback instruction based on session setting
  const feedbackInstruction =
    session.feedbackDetail === 'Brief'
      ? 'Write ONE short sentence of feedback per question.'
      : `Write detailed feedback per question including:
         what the student wrote, what was required,
         why marks were awarded or lost,
         and one specific improvement suggestion.`;

  // Split text into 3000 char chunks to support proper chunking
  const CHUNK_SIZE = 3000;
  let textToProcess = studentAnswerText || '';
  const numChunks = Math.ceil(textToProcess.length / CHUNK_SIZE) || 1;
  let allQuestions: any[] = [];
  let overallFeedbackStatements: string[] = [];

  const compactQuestions = parsedQuestions.map((q: any) => 
    `Q${q.questionNumber} (${q.marksAvailable || q.marks || 0} marks): ${(q.questionText || '').substring(0, 500)}${(q.questionText || '').length > 500 ? '...' : ''}`
  ).join('\n');

  const compactMarkScheme = parsedMarkScheme.map((q: any) => 
    `Q${q.questionNumber}: Req:[${(q.requiredKeywords || []).slice(0, 15).join(',')}] Alt:[${(q.acceptAlternatives || []).slice(0, 15).join(',')}] Reject:[${(q.rejectList || []).slice(0, 10).join(',')}] Method:[${(q.methodMarks || '').substring(0, 300)}]`
  ).join('\n');

  for (let c = 0; c < numChunks; c++) {
    const chunkStart = c * CHUNK_SIZE;
    const chunkText = textToProcess.substring(chunkStart, chunkStart + CHUNK_SIZE);

    const prompt = `
You are an expert ${session.examBoard} senior examiner with 20+ years experience.
Your marking must be CONSISTENT, FAIR, and EVIDENCE-BASED.

CRITICAL RULES — NEVER BREAK THESE:
- Never award marks you cannot justify with specific text from the student answer
- Never penalise correct answers just because they use different wording
- Always find the BEST interpretation of an ambiguous answer
- If a student shows understanding but uses wrong terminology, award method marks
- Never award more marks than the maximum available for any question
- If answer is blank or completely irrelevant, award exactly 0 marks
- Match student answer to mark scheme MEANING not just keywords

ANSWER MATCHING RULES:
- Students may answer questions out of order
- Look for question numbers written as: 1, 1a, Q1, Question 1, (1)
- If no question number found, match by topic/content
- Never skip a question — always check the full answer sheet
- A student may continue an answer on a new page

CRITICAL JSON RULES:
- Return ONLY valid JSON — no markdown, no backticks, no comments
- Never use smart quotes (" ") — use straight quotes (" ") only
- Never leave trailing commas
- Escape all special characters in strings
- If you cannot determine a value, use null not undefined

Assessment type: ${session.sessionType}
Subject: ${session.subject}
Course: ${session.courseId}
Student ID: ${studentId}

${strictnessInstruction}

${feedbackInstruction}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
QUESTIONS EXTRACTED FROM PAPER:
${compactQuestions}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ACCEPTED ANSWERS FROM MARK SCHEME:
${compactMarkScheme}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
STUDENT ${studentId} ANSWER SHEET (Chunk ${c + 1} of ${numChunks})
${chunkText}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

MARKING INSTRUCTIONS:
1. Compare student answers to mark scheme criteria. Award marks accurately based on mode.
2. Calculate total marks, max marks, percentage (1 decimal place).
3. Assign grade: >=90(A*), >=80(A), >=70(B), >=60(C), >=50(D), >=40(E), <40(F).
4. Write brief overall student performance feedback.

Return ONLY a valid JSON object. No markdown.
CRITICAL: Only include questions actually answered in this text chunk.

JSON Structure:
{
  "studentId": "${studentId}",
  "totalMarks": <num>, "maxMarks": <num>, "percentage": <num>,
  "grade": "<A*/A/B/C/D/E/F>",
  "overallFeedback": "<summary>",
  "questions": [{
    "questionNumber": "<id>", "questionText": "<text>", "topic": "<topic>",
    "marksAwarded": <num>, "marksAvailable": <num>,
    "status": "<CORRECT|PARTIAL|INCORRECT>", "studentAnswer": "<text>",
    "expectedAnswer": "<text>", "keywordsMissing": ["<word>"], 
    "aiFeedback": "<feedback>", "lostMarksReason": "<reason|null>", "improvementSuggestion": "<idea>",
    "confidence": <num 0-100>, "confidenceReason": "<why uncertain if < 70>"
  }]
}`;

    const promptTokenEstimate = Math.ceil(prompt.length / 4);
    console.log(`Chunk ${c+1} prompt size: ~${promptTokenEstimate} tokens`);

    try {
      const maxTokens = 4000;
      const response = await groqWithRetry(prompt, 'llama-3.3-70b-versatile', 3, maxTokens);
      const text = extractJSON(response.text || '', 'object');
      const parsedResult = JSON.parse(text);

      if (parsedResult.questions && Array.isArray(parsedResult.questions)) {
        allQuestions.push(...parsedResult.questions);
      }
      if (parsedResult.overallFeedback) {
        overallFeedbackStatements.push(parsedResult.overallFeedback);
      }
    } catch (error: any) {
      logger.error(`Groq marking failed for student ${studentId} (Chunk ${c + 1}/${numChunks}):`, error);
      throw new Error(`Groq marking failed (Chunk ${c + 1}/${numChunks}): ` + (error.status ? error.status + ' ' : '') + (error.message || 'Unknown'));
    }
  }

  // Combine and deduplicate questions across chunks
  // Keep the version with the highest marksAwarded if duplicated
  const mergedQuestionsMap = new Map();
  for (const q of allQuestions) {
    const existing = mergedQuestionsMap.get(q.questionNumber);
    if (!existing || Number(q.marksAwarded) > Number(existing.marksAwarded) || (q.studentAnswer && q.studentAnswer !== '[NO ANSWER]' && (!existing.studentAnswer || existing.studentAnswer === '[NO ANSWER]'))) {
      mergedQuestionsMap.set(q.questionNumber, q);
    }
  }
  
  const mergedQuestions = Array.from(mergedQuestionsMap.values());

  let result: any = {
    studentId,
    overallFeedback: overallFeedbackStatements.join(' '),
    questions: mergedQuestions,
    totalMarks: 0,
    maxMarks: 0,
    percentage: 0,
    grade: 'F'
  };

  // Recalculate safely in code
  if (result.questions.length > 0) {
    const recalcTotal = result.questions.reduce((sum: number, q: any) => sum + (Number(q.marksAwarded) || 0), 0);
    const recalcMax = result.questions.reduce((sum: number, q: any) => sum + (Number(q.marksAvailable) || 0), 0);

    result.totalMarks = recalcTotal;

    if (recalcMax > 0) {
      result.maxMarks = recalcMax;
      result.percentage = Math.round((recalcTotal / recalcMax) * 1000) / 10;
    }

    const pct = result.percentage;
    result.grade =
      pct >= 90 ? 'A*' :
      pct >= 80 ? 'A'  :
      pct >= 70 ? 'B'  :
      pct >= 60 ? 'C'  :
      pct >= 50 ? 'D'  :
      pct >= 40 ? 'E'  : 'F';
  }

  logger.info(
    `Groq marked student ${studentId} in ${numChunks} chunks: ` +
    `${result.totalMarks}/${result.maxMarks} ` +
    `(${result.percentage}%) Grade: ${result.grade}`
  );

  return validateMarkingResult(result);
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
    origin: process.env.ALLOWED_ORIGIN || '*',
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
        { 
          id: user.id, 
          email: user.email, 
          role: (user.role || user.userType || 'STUDENT').toUpperCase(), 
          userType: (user.userType || user.role || 'STUDENT').toUpperCase()
        }, 
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

  app.post('/api/auth/login', authLimiter, async (req, res) => {
    try {
      const { email, password } = loginSchema.parse(req.body);
      const user = await (prisma as any).user.findUnique({ where: { email } });
      if (!user) return res.status(401).json({ error: 'Invalid credentials' });

      const isValid = await bcrypt.compare(password, user.password);
      if (!isValid) return res.status(401).json({ error: 'Invalid credentials' });

      const token = jwt.sign(
        { 
          id: user.id, 
          email: user.email, 
          role: (user.role || user.userType || 'STUDENT').toUpperCase(), 
          userType: (user.userType || user.role || 'STUDENT').toUpperCase()
        }, 
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
        to: 'admin@markai.edu',
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

  app.post('/api/upload/answer-pdf', authMiddleware, upload.single('file'), async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

      let extractedText = '';
      let method = 'pdf-parse';

      try {
        const pdfData = await pdf(req.file.buffer);
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

      if (extractedText.length < 50) {
        method = 'gemini-vision';
        logger.info('Handwriting detected, using Gemini OCR');
        const base64Pdf = req.file.buffer.toString('base64');
        const ocrPrompt = `This is a handwritten student exam answer sheet.

Please transcribe ALL content you can see with these rules:
1. Preserve question numbers exactly as written (Q1, Q1a, 1., etc.)
2. Transcribe each student answer completely
3. If a question is left blank write [NO ANSWER]
4. If handwriting is unclear write best interpretation with [UNCLEAR] marker
5. Preserve crossed out text as [CROSSED OUT: text]
6. Maintain structure: question number on its own line, answer below it

Format output exactly as:
Q[number]:
[student answer here]`;

        try {
          let response;
          try {
            response = await getGenAI().models.generateContent({
              model: 'gemini-2.0-flash',
              contents: [{ parts: [{ inlineData: { data: base64Pdf, mimeType: 'application/pdf' } }, { text: ocrPrompt }] }]
            });
          } catch (e: any) {
            if (e.status === 429 || e.message?.includes('429')) {
              logger.info('Gemini rate limit hit, retrying after 2s delay');
              await new Promise(r => setTimeout(r, 2000));
              response = await getGenAI().models.generateContent({
                model: 'gemini-2.0-flash',
                contents: [{ parts: [{ inlineData: { data: base64Pdf, mimeType: 'application/pdf' } }, { text: ocrPrompt }] }]
              });
            } else {
              throw e;
            }
          }
          extractedText = response.text?.trim() || '';
        } catch (ocrErr: any) {
          logger.error('Gemini OCR fallback failed:', ocrErr.message);
          if (ocrErr.status === 429 || ocrErr.message?.includes('429')) {
             throw new Error('AI rate limits exceeded across all models. Please wait 1 minute before uploading.');
          }
          throw new Error('Failed to process PDF with OCR: ' + ocrErr.message);
        }
      }

      const pdfFilePath = await uploadPdfToSupabase(req.file.buffer, req.file.originalname, 'answers');
      const textFilePath = await uploadTextToSupabase(extractedText, req.file.originalname, 'texts');
      
      let warning = undefined;
      if (extractedText.substring(0, 100).toLowerCase().includes('marking scheme') || extractedText.length < 100) {
        warning = 'This document looks like a Marking Scheme or is very short. Please verify it is a student answer sheet.';
        logger.warn(`Suspicious answer sheet uploaded: ${req.file.originalname} - ${warning}`);
      }

      logger.info(`Uploaded PDF: ${pdfFilePath}, Text: ${textFilePath}, Method: ${method}`);

      res.json({ success: true, text: extractedText, method, filename: req.file.originalname, fileUrl: pdfFilePath, textUrl: textFilePath, warning });
    } catch (error: any) {
      logger.error('Upload error:', error);
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
        include: { _count: { select: { results: true } } }
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

  app.post('/api/sessions/:id/answer-sheets', authMiddleware, requireLecturer, async (req, res) => {
    const { id } = req.params;
    const { students } = req.body;

    logger.info(`Uploading metadata for ${students?.length || 0} answer sheets in session ${id}`);

    if (!students || !Array.isArray(students)) {
      return res.status(400).json({ error: 'Invalid students data. Expected an array.' });
    }

    if (students.length === 0) {
      return res.status(400).json({ error: 'No student answer sheets provided.' });
    }

    try {
      // Use a transaction for atomic insertion
      const sheets = await (prisma as any).$transaction(
        students.map((s: any) => (prisma as any).studentAnswerSheet.create({
          data: {
            sessionId: id,
            // Ensure studentId is unique or generated
            studentId: s.studentId && s.studentId.trim() !== '' 
              ? s.studentId 
              : `TEMP_${Math.random().toString(36).substr(2, 9)}`,
            studentName: s.studentName || s.studentId || s.filename || 'Unknown Student',
            extractedText: s.extractedText || '',
            pdfUrl: s.pdfUrl || '',
            extractMethod: s.extractMethod || 'AI'
          }
        }))
      );

      logger.info(`Successfully saved ${sheets.length} answer sheets for session ${id}`);
      res.json(sheets);
    } catch (error: any) {
      logger.error(`Failed to save answer sheets for session ${id}:`, error);
      
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
      // Priority 1: Supabase Storage text URL
      if (session.questionTextUrl) {
        try {
          questionPdfText = await downloadTextFromSupabase(session.questionTextUrl);
          logger.info(`Question paper text loaded from Supabase Storage (${questionPdfText.length} chars)`);
        } catch (e) {
          logger.error('Failed to load question paper text from Supabase:', e);
        }
      }

      // Priority 2: Request body fallback
      if (!questionPdfText && req.body.questionPdfText) {
        questionPdfText = req.body.questionPdfText;
        logger.warn('Using question paper text from request body fallback');
      }

      // Priority 3: Re-extract from stored PDF using Gemini
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
              const resp = await getGenAI().models.generateContent({
                model: 'gemini-2.0-flash',
                contents: [{ parts: [{ inlineData: { data: base64, mimeType: 'application/pdf' } }, { text: 'Extract ALL text from this exam question paper. Preserve question numbers and marks. Return only the text content.' }] }]
              });
              questionPdfText = resp.text?.trim() || '';
            }
            if (questionPdfText.length >= 10) {
              logger.info(`Re-extracted question paper text (${questionPdfText.length} chars)`);
              // Save for future use
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

      // Priority 3: Re-extract from stored PDF
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
              const resp = await getGenAI().models.generateContent({
                model: 'gemini-2.0-flash',
                contents: [{ parts: [{ inlineData: { data: base64, mimeType: 'application/pdf' } }, { text: 'Extract ALL text from this mark scheme. Preserve question numbers, accepted answers, marks, and marking guidance. Return only the text content.' }] }]
              });
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

      // Fetch all pending or errored student answer sheets for retry
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

      // Initialize progress tracker
      markingProgress.set(id, {
        total: answerSheets.length,
        completed: 0,
        currentStudentId: '',
        currentStudentName: '',
        status: 'MARKING',
        estimatedSecondsRemaining: answerSheets.length * 30
      });

      // Update session status in Supabase PostgreSQL
      await (prisma as any).markingSession.update({
        where: { id },
        data: { status: 'MARKING' }
      });

      // Send immediate response so frontend can poll progress
      res.json({
        message: 'Marking started',
        total: answerSheets.length,
        status: 'MARKING'
      });

      // ─────────────────────────────────────────────────
      // BACKGROUND PROCESS — runs after response is sent
      // ─────────────────────────────────────────────────
      (async () => {
        let completed = 0;
        const errors: string[] = [];

        console.log('📄 Extracting text from question paper...');
        console.log('✅ Question paper extracted:', questionPdfText?.length, 'chars');

        console.log('📄 Extracting text from mark scheme...');
        console.log('✅ Mark scheme extracted:', markSchemeText?.length, 'chars');

        // ───────────────────────────────────────────────
        // PRE-PROCESS ONCE FOR ALL STUDENTS
        // Parse question paper and mark scheme using Gemini
        // These results are reused for every student
        // ───────────────────────────────────────────────

        console.log('🧠 Skipping Groq pre-processing passes for Question Paper and Mark Scheme...');
        // Step 1: Gemini reads and understands question paper (SKIPPED)
        const parsedQuestions: any[] = [];
        
        console.log('🧠 Skipping Mark Scheme extraction pass...');
        // Step 2: Gemini reads and understands mark scheme (SKIPPED)
        const parsedMarkScheme: any[] = [];

        // ───────────────────────────────────────────────
        // MARK EACH STUDENT
        // ───────────────────────────────────────────────
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
            // Update progress
            markingProgress.set(id, {
              total: answerSheets.length,
              completed,
              currentStudentId: sheet.studentId,
              currentStudentName: sheet.studentName || sheet.studentId,
              status: 'MARKING',
              estimatedSecondsRemaining: (answerSheets.length - completed) * 30
            });

            // Get student answer text
            let studentAnswerText = sheet.extractedText;

            // Try Supabase Storage text file if text not in DB
            if (
              (!studentAnswerText || studentAnswerText.trim().length < 5) &&
              (sheet as any).textUrl
            ) {
              try {
                studentAnswerText = await downloadTextFromSupabase(
                  (sheet as any).textUrl
                );
                logger.info(`Loaded answer text for ${sheet.studentId} from Supabase Storage (${studentAnswerText.length} chars)`);
              } catch (e) {
                logger.error(
                  `Cannot load answer text for ${sheet.studentId}:`, e
                );
              }
            }

            // Re-extract from stored PDF if still no text
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
                    const ocrResp = await getGenAI().models.generateContent({
                      model: 'gemini-2.0-flash',
                      contents: [{ parts: [
                        { inlineData: { data: base64, mimeType: 'application/pdf' } },
                        { text: 'This is a student exam answer sheet. Transcribe ALL content. Preserve question numbers (Q1, 1a, etc). If handwritten, do your best to read it. Format: Q[number]:\n[answer]' }
                      ] }]
                    });
                    studentAnswerText = ocrResp.text?.trim() || '';
                  }
                  if (studentAnswerText.length >= 5) {
                    logger.info(`Re-extracted answer text for ${sheet.studentId} (${studentAnswerText.length} chars)`);
                    // Update the answer sheet with the extracted text
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

            // Skip student if still no answer text after all attempts
            if (!studentAnswerText || studentAnswerText.trim().length < 5) {
              logger.warn(`Skipping ${sheet.studentId} — no answer text after all extraction attempts`);
              await (prisma as any).studentAnswerSheet.update({
                where: { id: sheet.id },
                data: { status: 'SKIPPED' }
              });
              completed++;
              return;
            }

            // Step 3: Gemini marks this student
            // Passes full question paper, full mark scheme,
            // parsed JSON of both, and student answer text
            const markingResult = await markStudentAnswers(
              studentAnswerText,
              sheet.studentId,
              questionPdfText,
              markSchemeText,
              parsedQuestions,
              parsedMarkScheme,
              session
            );

            // Step 4: Save result to Supabase PostgreSQL via Prisma with Retry
            await dbRetry(() => (prisma as any).studentResult.create({
              data: {
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
                    improvementSuggestion: q.improvementSuggestion || ''
                  }))
                }
              }
            }));

            // Update answer sheet status in Supabase PostgreSQL with Retry
            await dbRetry(() => (prisma as any).studentAnswerSheet.update({
              where: { id: sheet.id },
              data: { status: 'COMPLETE' }
            }));

            completed++;

            logger.info(
              `✅ ${sheet.studentId}: ` +
              `${markingResult.totalMarks}/${markingResult.maxMarks} ` +
              `Grade ${markingResult.grade}`
            );

          } catch (studentError: any) {
            const errorDetails = studentError.response?.data || studentError.message;
            logger.error(`❌ Failed marking student ${sheet.studentId} in session ${id}:`, {
              error: errorDetails,
              studentId: sheet.studentId,
              stack: studentError.stack
            });
            errors.push(`${sheet.studentId}: ${studentError.message}`);

            const errMsg = studentError.message || String(errorDetails);
            const truncatedErr = errMsg.substring(0, 500);

            await (prisma as any).studentAnswerSheet.update({
              where: { id: sheet.id },
              data: { 
                status: 'ERROR',
                errorMessage: truncatedErr
               }
            }).catch(() => {});

            completed++;
          }
        })));

        // Finalize session status in Supabase PostgreSQL
        const finalStatus =
          errors.length === answerSheets.length
            ? 'ERROR'
            : 'REVIEW_REQUIRED';

        await (prisma as any).markingSession.update({
          where: { id },
          data: { status: finalStatus }
        });

        // Final progress update
        markingProgress.set(id, {
          total: answerSheets.length,
          completed: answerSheets.length,
          currentStudentId: '',
          currentStudentName: '',
          status: 'COMPLETE',
          estimatedSecondsRemaining: 0
        });

        logger.info(
          `🎓 Marking complete for session ${id}. ` +
          `Success: ${completed - errors.length} ` +
          `Errors: ${errors.length}`
        );

        // Send email via Resend
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

      })();

    } catch (error: any) {
      logger.error('Marking route error:', error);
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

  app.get('/api/sessions/:id/progress', authMiddleware, (req, res) => {
    res.json(markingProgress.get(req.params.id) || { total: 0, completed: 0, currentStudentId: '', currentStudentName: '', status: 'PENDING', estimatedSecondsRemaining: 0 });
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

      // Fetch texts
      const questionPdfText = await downloadTextFromSupabase(session.questionTextUrl || '');
      const markSchemeText = await downloadTextFromSupabase(session.markSchemeTextUrl || '');
      
      const parsedQuestions = await parseQuestionPaper(questionPdfText);
      const parsedMarkScheme = await parseMarkScheme(markSchemeText, parsedQuestions);

      // Re-mark logic
      const resultData = await markStudentAnswers(
        answerSheet.extractedText,
        studentId,
        questionPdfText,
        markSchemeText,
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

  app.get('/api/student/results', authMiddleware, async (req, res) => {
    try {
      if (req.user.role === 'STUDENT') {
        const results = await (prisma as any).studentResult.findMany({ where: { studentId: req.user.studentCode }, include: { session: true, questions: true }, orderBy: { createdAt: 'desc' } });
        res.json(results);
      } else if (req.user.role === 'LECTURER') {
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
      const userRole = (req.user.role || '').toUpperCase();
      const userType = (req.user.userType || '').toUpperCase();

      if (userRole === 'LECTURER' || userType === 'LECTURER') {
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
      } else if (req.user.role === 'STUDENT') {
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
        const totalStudents = await (prisma as any).user.count({ where: { role: 'STUDENT' } });
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



  app.listen(PORT, '0.0.0.0', () => logger.info(`✅ Server running on port ${PORT}`));
}

startServer();
