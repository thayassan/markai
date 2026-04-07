import { z } from 'zod';
import express from 'express';
import jwt from 'jsonwebtoken';

// Zod Validation Schemas
export const loginSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters')
});

export const registerSchema = z.object({
  fullName: z.string().min(2).max(100),
  email: z.string().email(),
  password: z.string()
    .min(8, 'Password must be at least 8 characters')
    .regex(
      /^(?=.*[A-Z])(?=.*[0-9])/,
      'Password must contain at least one uppercase letter and one number'
    ),
  userType: z.enum(['STUDENT', 'LECTURER', 'ADMIN']),
  inviteCode: z.string().optional(), // Added for Lecturer registration
  universityId: z.string().optional(),
  universityName: z.string().optional(),
  studentCode: z.string().optional()
});

export const profileUpdateSchema = z.object({
  fullName: z.string().min(2).optional(),
  email: z.string().email().optional(),
  phoneNumber: z.string().optional(),
  location: z.string().optional(),
  bio: z.string().optional(),
  department: z.string().optional(),
  role: z.string().optional(),
});

export const sessionSchema = z.object({
  name: z.string().min(2).max(100),
  subject: z.string().min(2),
  sessionType: z.enum(['CA', 'Mid Term', 'Semester']),
  examBoard: z.enum([
    'UGC', 'QAAC', 'Cambridge', 'Edexcel', 'IB', 'AQA', 'OCR'
  ]),
  courseId: z.string()
    .regex(/^[A-Za-z0-9-]{1,20}$/, 'Invalid Course ID format'),
  paperType: z.string().min(1).default('Theory'),
  questionPdfUrl: z.string(),
  markSchemePdfUrl: z.string(),
  questionTextUrl: z.string().optional(),
  markSchemeTextUrl: z.string().optional(),
  classId: z.string().optional(),
  markingStrictness: z.enum(['Strict', 'Standard', 'Lenient']).optional(),
  feedbackDetail: z.enum(['Brief', 'Detailed']).optional(),
  status: z.string().optional()
});

export const overrideSchema = z.object({
  questionId: z.string(),
  lecturerMark: z.number().min(0),
  lecturerNote: z.string().optional()
});

export const settingsUpdateSchema = z.object({
  twoFactorAuth: z.boolean().optional(),
  emailAlerts: z.boolean().optional()
});

export const feedbackSchema = z.object({
  rating: z.number().min(1).max(5),
  quote: z.string().min(1)
});

// Auth Middleware
export const authMiddleware = (
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
) => {
  const authHeader = req.headers.authorization;
  let token = '';

  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.split(' ')[1];
  } else if (req.query.token) {
    token = req.query.token as string;
  }

  if (!token) {
    return res.status(401).json({ error: 'Authorization token required' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET!);
    (req as any).user = decoded;
    next();
  } catch (error) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
};

export const requireLecturer = (
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
) => {
  const userType = ((req as any).user?.userType || (req as any).user?.role || '').toUpperCase();
  if (userType !== 'LECTURER' && userType !== 'ADMIN') {
    return res.status(403).json({
      error: 'Lecturer access required',
      yourType: userType
    });
  }
  next();
};

export const requireAdmin = (
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
) => {
  const userType = ((req as any).user?.userType || (req as any).user?.role || '').toUpperCase();
  if (userType !== 'ADMIN') {
    return res.status(403).json({
      error: 'Admin access required',
      yourType: userType
    });
  }
  next();
};
