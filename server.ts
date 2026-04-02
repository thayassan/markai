import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI } from '@google/genai';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { Resend } from 'resend';
import dotenv from 'dotenv';
import jwt from 'jsonwebtoken';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import multer from 'multer';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const pdf = require('pdf-parse');
import { z } from 'zod';
import winston from 'winston';
import fs from 'fs';
import {
  supabase,
  uploadPdfToSupabase,
  getSignedFileUrl
} from './src/lib/supabase.js';

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
    ...(process.env.NODE_ENV === 'production'
      ? [new winston.transports.File({ filename: 'logs/app.log' })]
      : [])
  ]
});

// D. Service Initialization
const prisma = new PrismaClient();
const resend = new Resend(process.env.RESEND_API_KEY || 're_mock');

let genAI: GoogleGenAI | null = null;
function getGenAI() {
  if (!genAI) {
    genAI = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
  }
  return genAI;
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

// F. Zod Validation Schemas
const loginSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters')
});

const registerSchema = z.object({
  name: z.string().min(2).max(100),
  email: z.string().email(),
  password: z.string()
    .min(8)
    .regex(
      /^(?=.*[A-Z])(?=.*[0-9])/,
      'Password must contain at least one uppercase letter and one number'
    ),
  role: z.enum(['STUDENT', 'LECTURER', 'SCHOOL_ADMIN']),
  schoolId: z.string().optional(),
  studentCode: z.string().optional()
});

const sessionSchema = z.object({
  name: z.string().min(2).max(100),
  subject: z.string().min(2),
  sessionType: z.enum(['CA', 'Mid Term', 'Semester']),
  examBoard: z.enum([
    'UGC', 'QAAC', 'Cambridge', 'Edexcel', 'IB', 'AQA', 'OCR'
  ]),
  courseId: z.string()
    .regex(/^[A-Za-z0-9-]{1,20}$/, 'Invalid Course ID format'),
  questionPdfUrl: z.string(),
  markSchemePdfUrl: z.string(),
  classId: z.string().optional(),
  markingStrictness: z.enum(['Strict', 'Standard', 'Lenient']).optional(),
  feedbackDetail: z.enum(['Brief', 'Detailed']).optional(),
  status: z.string().optional()
});

const overrideSchema = z.object({
  questionId: z.string(),
  lecturerMark: z.number().min(0),
  lecturerNote: z.string().optional()
});

// G. Auth Middleware
const authMiddleware = (
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authorization token required' });
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET!);
    req.user = decoded;
    next();
  } catch (error) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
};

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
  const PORT = 3000;

  // Security middleware
  app.use(helmet({
    contentSecurityPolicy: false // disable for Vite dev
  }));
  app.use(cors({
    origin: process.env.ALLOWED_ORIGIN || '*',
    credentials: true
  }));
  app.use(express.json({ limit: '10mb' }));

  // Rate limiting on auth routes
  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    message: { error: 'Too many attempts. Please try again in 15 minutes.' }
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

  app.post('/api/auth/register', authLimiter, async (req, res) => {
    try {
      const { name, email, password, role, schoolId, studentCode } = registerSchema.parse(req.body);
      
      const exists = await (prisma as any).user.findUnique({ where: { email } });
      if (exists) return res.status(409).json({ error: 'Email already registered' });

      if (role === 'STUDENT') {
        if (!studentCode) return res.status(400).json({ error: 'Student code required' });
        const codeExists = await (prisma as any).user.findUnique({ where: { studentCode } });
        if (codeExists) return res.status(409).json({ error: 'Student code already used' });
      }

      const hashedPassword = await bcrypt.hash(password, 12);
      const user = await (prisma as any).user.create({
        data: { name, email, password: hashedPassword, role, schoolId, studentCode }
      });

      const token = jwt.sign({ id: user.id, email: user.email, role: user.role, studentCode: user.studentCode }, process.env.JWT_SECRET!, { expiresIn: '7d' });
      res.status(201).json({ user: { id: user.id, email: user.email, name: user.name, role: user.role, studentCode: user.studentCode }, token });
    } catch (error: any) {
      res.status(400).json({ error: error.errors || error.message });
    }
  });

  app.post('/api/auth/login', authLimiter, async (req, res) => {
    try {
      const { email, password } = loginSchema.parse(req.body);
      const user = await (prisma as any).user.findUnique({ where: { email } });
      if (!user) return res.status(401).json({ error: 'Invalid credentials' });

      const isValid = await bcrypt.compare(password, user.password);
      if (!isValid) return res.status(401).json({ error: 'Invalid credentials' });

      const token = jwt.sign({ id: user.id, email: user.email, role: user.role, studentCode: user.studentCode }, process.env.JWT_SECRET!, { expiresIn: '7d' });
      res.json({ user: { id: user.id, email: user.email, name: user.name, role: user.role, studentCode: user.studentCode }, token });
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

  app.post('/api/upload/answer-pdf', authMiddleware, upload.single('file'), async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

      let extractedText = '';
      let method = 'pdf-parse';
      try {
        const pdfData = await pdf(req.file.buffer);
        extractedText = pdfData.text?.trim() || '';
      } catch (e) {
        logger.error('pdf-parse failed:', e);
      }

      if (extractedText.length < 50) {
        method = 'gemini-vision';
        const base64Pdf = req.file.buffer.toString('base64');
        const response = await getGenAI().models.generateContent({
          model: 'gemini-2.0-flash',
          contents: [
            { inlineData: { data: base64Pdf, mimeType: 'application/pdf' } },
            { text: `This is a handwritten student exam answer sheet. Please carefully extract and transcribe ALL text you can see. Preserve the structure including question numbers, student answers, and any written content. Be as accurate as possible.` }
          ]
        });
        extractedText = response.text || '';
      }

      const filePath = await uploadPdfToSupabase(req.file.buffer, req.file.originalname, 'answers');
      res.json({ success: true, text: extractedText, method, filename: req.file.originalname, fileUrl: filePath });
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
    const { page = 1, limit = 10, status, subject, sort = 'createdAt_desc' } = req.query;
    const skip = (Number(page) - 1) * Number(limit);
    const [field, order] = (sort as string).split('_');

    const where: any = { lecturerId: req.user.id };
    if (status) where.status = status;
    if (subject) where.subject = subject;

    const [data, total] = await Promise.all([
      (prisma as any).markingSession.findMany({
        where, skip, take: Number(limit),
        orderBy: { [field]: order as any },
        include: { _count: { select: { results: true } } }
      }),
      (prisma as any).markingSession.count({ where })
    ]);

    res.json({ data, total, page: Number(page), totalPages: Math.ceil(total / Number(limit)) });
  });

  app.post('/api/sessions', authMiddleware, async (req, res) => {
    try {
      const data = sessionSchema.parse(req.body);
      const session = await (prisma as any).markingSession.create({
        data: { ...data, lecturerId: req.user.id, status: data.status || 'PENDING' }
      });
      res.status(201).json(session);
    } catch (error: any) {
      res.status(400).json({ error: error.errors || error.message });
    }
  });

  app.post('/api/sessions/:id/answer-sheets', authMiddleware, async (req, res) => {
    const { students } = req.body;
    try {
      const sheets = await (prisma as any).$transaction(
        students.map((s: any) => (prisma as any).studentAnswerSheet.create({
          data: {
            sessionId: req.params.id,
            studentId: s.studentId,
            studentName: s.studentName,
            extractedText: s.extractedText,
            pdfUrl: s.pdfUrl,
            extractMethod: s.extractMethod
          }
        }))
      );
      res.json(sheets);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  app.get('/api/sessions/:id/answer-sheets', authMiddleware, async (req, res) => {
    const sheets = await (prisma as any).studentAnswerSheet.findMany({ where: { sessionId: req.params.id } });
    res.json(sheets);
  });

  app.post('/api/sessions/:id/mark', authMiddleware, async (req, res) => {
    const { id } = req.params;
    try {
      const session = await (prisma as any).markingSession.findUnique({ where: { id } });
      if (!session) return res.status(404).json({ error: 'Session not found' });

      const answerSheets = await (prisma as any).studentAnswerSheet.findMany({ where: { sessionId: id, status: 'PENDING' } });
      if (answerSheets.length === 0) return res.status(400).json({ error: 'No pending answer sheets found' });

      const { questionPdfText, markSchemeText } = req.body;
      if (!questionPdfText || !markSchemeText) return res.status(400).json({ error: 'Question text and mark scheme text required' });

      markingProgress.set(id, { total: answerSheets.length, completed: 0, currentStudentId: '', currentStudentName: '', status: 'MARKING', estimatedSecondsRemaining: answerSheets.length * 30 });
      await (prisma as any).markingSession.update({ where: { id }, data: { status: 'MARKING' } });
      res.json({ message: 'Marking started', total: answerSheets.length, status: 'MARKING' });

      (async () => {
        let completed = 0;
        const session = await (prisma as any).markingSession.findUnique({ where: { id } });
        if (!session) return;
        for (const sheet of answerSheets) {
          try {
            const prompt = `You are an expert exam marker for ${session.examBoard} ${session.sessionType} assessments. Subject: ${session.subject}, Course ID: ${session.courseId}. Marking Strictness: ${session.markingStrictness}. Feedback Detail: ${session.feedbackDetail}. 
            QUESTION PAPER: ${questionPdfText}. MARK SCHEME: ${markSchemeText}. STUDENT ANSWER: ${sheet.extractedText}. 
            Return ONLY a valid JSON object: { "totalMarks": number, "maxMarks": number, "percentage": number, "grade": string, "questions": [{ "questionNumber": string, "topic": string, "marksAwarded": number, "marksAvailable": number, "status": "CORRECT or PARTIAL or INCORRECT", "aiFeedback": string, "lostMarksReason": string, "improvementSuggestion": string }] }`;

            const response = await getGenAI().models.generateContent({
              model: 'gemini-2.0-flash',
              contents: prompt
            });
            let responseText = (response.text || "").replace(/```json/g, '').replace(/```/g, '').trim();
            const markingResult = JSON.parse(responseText);

            await (prisma as any).studentResult.create({
              data: {
                sessionId: id, studentId: sheet.studentId, studentName: sheet.studentName, studentCode: sheet.studentId, answerPdfUrl: sheet.pdfUrl,
                totalMarks: markingResult.totalMarks, maxMarks: markingResult.maxMarks, percentage: markingResult.percentage, grade: markingResult.grade, aiData: markingResult,
                questions: { create: markingResult.questions.map((q: any) => ({ questionNumber: q.questionNumber, topic: q.topic, marksAwarded: q.marksAwarded, marksAvailable: q.marksAvailable, status: q.status, aiFeedback: q.aiFeedback, lostMarksReason: q.lostMarksReason, improvementSuggestion: q.improvementSuggestion })) }
              }
            });

            await (prisma as any).studentAnswerSheet.update({ where: { id: sheet.id }, data: { status: 'COMPLETE' } });
            completed++;
          } catch (e) {
            logger.error(`Error marking ${sheet.studentId}:`, e);
            completed++;
          }
        }
        await (prisma as any).markingSession.update({ where: { id }, data: { status: 'REVIEW_REQUIRED' } });
        markingProgress.set(id, { total: answerSheets.length, completed: answerSheets.length, currentStudentId: '', currentStudentName: '', status: 'COMPLETE', estimatedSecondsRemaining: 0 });
      })();
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get('/api/sessions/:id/progress', authMiddleware, (req, res) => {
    res.json(markingProgress.get(req.params.id) || { total: 0, completed: 0, currentStudentId: '', currentStudentName: '', status: 'PENDING', estimatedSecondsRemaining: 0 });
  });

  app.get('/api/sessions/:id/results', authMiddleware, async (req, res) => {
    const results = await (prisma as any).studentResult.findMany({ where: { sessionId: req.params.id }, include: { questions: true }, orderBy: { studentId: 'asc' } });
    res.json(results);
  });

  app.get('/api/results/:id', authMiddleware, async (req, res) => {
    const result = await (prisma as any).studentResult.findUnique({ where: { id: req.params.id }, include: { questions: true, session: true } });
    res.json(result);
  });

  app.get('/api/results', authMiddleware, async (req, res) => {
    const { sessionId, studentId } = req.query;
    const result = await (prisma as any).studentResult.findFirst({ where: { sessionId: sessionId as string, studentId: studentId as string }, include: { questions: true } });
    res.json(result);
  });

  app.patch('/api/ результаты/:resultId/override', authMiddleware, async (req, res) => {
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
      if (req.user.role === 'LECTURER') {
        const [totalSessions, papersMarked, pendingReview, results] = await Promise.all([
          (prisma as any).markingSession.count({ where: { lecturerId: req.user.id } }),
          (prisma as any).studentResult.count({ where: { session: { lecturerId: req.user.id } } }),
          (prisma as any).markingSession.count({ where: { lecturerId: req.user.id, status: 'REVIEW_REQUIRED' } }),
          (prisma as any).studentResult.findMany({ where: { session: { lecturerId: req.user.id } }, select: { percentage: true } })
        ]);
        const avgClassScore = results.length ? results.reduce((acc: number, r: any) => acc + r.percentage, 0) / results.length : 0;
        res.json({ totalSessions, papersMarked, pendingReview, avgClassScore });
      } else if (req.user.role === 'STUDENT') {
        const results = await (prisma as any).studentResult.findMany({ where: { studentId: req.user.studentCode }, select: { percentage: true, grade: true, createdAt: true } });
        const papersSubmitted = results.length;
        const averageScore = papersSubmitted ? results.reduce((acc: number, r: any) => acc + r.percentage, 0) / papersSubmitted : 0;
        const bestGrade = results.length ? results.sort((a: any, b: any) => a.percentage - b.percentage).pop()!.grade : 'N/A';
        res.json({ papersSubmitted, averageScore, bestGrade, streak: 0 });
      } else {
        // Admin stats
        const [totalSessions, totalStudents, totalResults] = await Promise.all([
          (prisma as any).markingSession.count(),
          (prisma as any).user.count({ where: { role: 'STUDENT' } }),
          (prisma as any).studentResult.count()
        ]);
        res.json({ totalSessions, totalStudents, totalResults });
      }
    } catch (error: any) {
      console.error('Error fetching dashboard stats:', error);
      res.status(500).json({ error: 'Failed to fetch stats' });
    }
  });

  app.post('/api/ai/generate', authMiddleware, async (req, res) => {
    try {
      const { prompt, context } = req.body;
      const fullPrompt = context ? `AI context: ${JSON.stringify(context)}. ${prompt}` : prompt;
      const response = await getGenAI().models.generateContent({
        model: 'gemini-2.0-flash',
        contents: fullPrompt
      });
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

  app.post('/api/schools', authMiddleware, async (req, res) => {
    const school = await (prisma as any).school.create({ data: { name: req.body.name } });
    res.json(school);
  });

  app.get('/api/schools', authMiddleware, async (req, res) => {
    const schools = await (prisma as any).school.findMany();
    res.json(schools);
  });

  app.post('/api/classes', authMiddleware, async (req, res) => {
    const cls = await (prisma as any).class.create({ data: { name: req.body.name, schoolId: req.body.schoolId, lecturerId: req.body.lecturerId } });
    res.json(cls);
  });

  app.get('/api/classes', authMiddleware, async (req, res) => {
    const where: any = {};
    if (req.query.schoolId) where.schoolId = req.query.schoolId as string;
    if (req.query.lecturerId) where.lecturerId = req.query.lecturerId as string;
    const classes = await (prisma as any).class.findMany({ where });
    res.json(classes);
  });

  app.get('/api/classes/:id/students', authMiddleware, async (req, res) => {
    const enrollments = await (prisma as any).classEnrollment.findMany({ where: { classId: req.params.id }, include: { class: true } });
    res.json(enrollments);
  });

  app.post('/api/classes/:id/enroll', authMiddleware, async (req, res) => {
    const enrollment = await (prisma as any).classEnrollment.create({ data: { classId: req.params.id, studentId: req.body.studentId } });
    res.json(enrollment);
  });

  // K. Global Error Handler
  app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
    logger.error(err.message, { stack: err.stack, path: req.path });
    res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
  });

  // L. Vite Middleware
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({ server: { middlewareMode: true }, appType: 'spa' });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => res.sendFile(path.join(distPath, 'index.html')));
  }

  app.listen(PORT, '0.0.0.0', () => logger.info(`✅ Server running on http://localhost:${PORT}`));
}

startServer();
