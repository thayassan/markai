import express from 'express';
import { prisma } from '../src/prisma.js';
import { authMiddleware, requireAdmin } from '../src/lib/auth_shared.js';
import { resend } from '../server.js';

const router = express.Router();

// GET /api/admin/dashboard
router.get('/dashboard', authMiddleware, requireAdmin, async (req: any, res: any) => {
  try {
    // 1. Core Counts & Average
    const totalStudents = await (prisma as any).user.count({ 
      where: { userType: 'STUDENT' } 
    }) || 0;
    
    const totalLecturers = await (prisma as any).user.count({ 
      where: { userType: 'LECTURER' } 
    }) || 0;
    
    const now = new Date();
    const firstDayOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const sessionsThisMonth = await (prisma as any).markingSession.count({
      where: { createdAt: { gte: firstDayOfMonth } }
    }) || 0;
    
    const avgResult = await (prisma as any).studentResult.aggregate({ 
      _avg: { percentage: true } 
    });
    
    const universityAverage = avgResult?._avg?.percentage
      ? Math.round(avgResult._avg.percentage * 10) / 10 
      : 0;

    // 2. Staff Metrics (Real counts)
    const staffMembers = await (prisma as any).user.findMany({
      where: { userType: { in: ['LECTURER', 'ADMIN'] } },
      select: { 
        id: true, 
        fullName: true, 
        userType: true,
        department: true, 
        createdAt: true 
      },
      orderBy: { createdAt: 'desc' }
    }) || [];

    const staff = [];
    for (const l of staffMembers) {
      const classesCount = await (prisma as any).class.count({ where: { lecturerId: l.id } });
      const sessionsCount = await (prisma as any).markingSession.count({ where: { lecturerId: l.id } });
      staff.push({
        id: l.id,
        name: l.fullName,
        role: l.userType,
        dept: l.department || 'General',
        classes: classesCount,
        sessions: sessionsCount,
        joined: new Date(l.createdAt).toLocaleDateString(undefined, { month: 'short', year: 'numeric' })
      });
    }

    // 3. Trends (Monthly Averages for last 6 months)
    const trends = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const nextD = new Date(now.getFullYear(), now.getMonth() - i + 1, 1);
      const mLabel = d.toLocaleString('default', { month: 'short' });
      
      const mAvg = await (prisma as any).studentResult.aggregate({
        _avg: { percentage: true },
        where: { createdAt: { gte: d, lt: nextD } }
      });
      
      trends.push({
        month: mLabel,
        avg: mAvg?._avg?.percentage ? Math.round(mAvg._avg.percentage) : 0
      });
    }

    // 4. Course Comparison (Real scores)
    const allSessions = await (prisma as any).markingSession.findMany({
      select: { courseId: true, subject: true, results: { select: { percentage: true } } }
    });

    const comparisonMap = new Map();
    allSessions.forEach((s: any) => {
      const existing = comparisonMap.get(s.courseId) || { total: 0, count: 0, subject: s.subject };
      s.results.forEach((r: any) => {
        existing.total += r.percentage;
        existing.count++;
      });
      comparisonMap.set(s.courseId, existing);
    });

    const courseComparison = Array.from(comparisonMap.entries())
      .map(([courseId, data]: [string, any]) => ({
        subject: `${courseId} - ${data.subject.substring(0, 10)}`,
        avg: data.count > 0 ? Math.round(data.total / data.count) : 0
      }))
      .slice(0, 5); // Limit to top 5 for chart clarity

    res.json({ 
      stats: {
        totalStudents, 
        totalLecturers, 
        sessionsThisMonth, 
        universityAverage
      },
      trends,
      courseComparison,
      staff
    });
  } catch (error: any) {
    console.error('Admin dashboard error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/admin/invite-staff
router.post('/invite', authMiddleware, requireAdmin, async (req: any, res: any) => {
  try {
    const { email, userType = 'LECTURER' } = req.body;

    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    // Generate unique one-time invite code
    const code = 'INV-' + Math.random().toString(36).toUpperCase().slice(2, 10);

    // Set expiry to 7 days from now
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);

    // Delete any existing unused invitation for this email
    await (prisma as any).invitation.deleteMany({
      where: { email, used: false }
    });

    // Save new invitation to database
    const invitation = await (prisma as any).invitation.create({
      data: {
        email,
        code,
        userType: userType.toUpperCase(),
        expiresAt,
        createdBy: req.user.id
      }
    });

    // Using shared resend instance from server.ts


    try {
      const emailResult = await resend.emails.send({
        from: `MarkAI <${process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev'}>`,
        to: email,
        subject: 'You have been invited to join MarkAI',
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden;">
            <div style="background: #0f172a; padding: 30px; text-align: center;">
              <h1 style="color: white; margin: 0; font-size: 24px;">MarkAI Platform</h1>
            </div>
            <div style="padding: 40px; background: #ffffff;">
              <h2 style="color: #0f172a; margin-top: 0;">Institutional Invitation</h2>
              <p style="color: #475569; line-height: 1.6;">You have been invited by an administrator to join the MarkAI platform as a <strong>${userType.toUpperCase()}</strong>.</p>
              
              <div style="background: #f8fafc; border: 2px dashed #e2e8f0; color: #0f172a; padding: 24px; text-align: center; border-radius: 8px; margin: 30px 0;">
                <p style="margin: 0 0 10px 0; font-size: 12px; color: #64748b; text-transform: uppercase; letter-spacing: 1px;">Your Secure Invite Code</p>
                <h2 style="margin: 0; letter-spacing: 6px; font-family: monospace; font-size: 32px;">${code}</h2>
              </div>
              
              <p style="color: #475569; line-height: 1.6;">This code is valid for <strong>7 days</strong> and can only be used once for the email address: <strong>${email}</strong>.</p>
              
              <div style="text-align: center; margin-top: 40px;">
                <a href="${process.env.FRONTEND_URL || 'http://localhost:5173'}/register"
                   style="background: #0f172a; color: white; padding: 14px 28px; text-decoration: none; border-radius: 8px; display: inline-block; font-weight: bold;">
                  Complete Registration
                </a>
              </div>
              
              <p style="color: #94a3b8; font-size: 12px; margin-top: 40px; text-align: center;">
                If you did not expect this invitation, please ignore this email.
              </p>
            </div>
          </div>
        `
      });
      console.log('✅ Email sent successfully:', emailResult);
    } catch (emailError: any) {
      console.error('❌ Email failed to send:', emailError.message);
      return res.json({
        success: true,
        warning: 'Invitation saved, but email failed: ' + emailError.message,
        inviteCode: code,
        expiresAt
      });
    }

    res.json({
      success: true,
      message: `Invitation sent to ${email}`,
      inviteCode: code,
      expiresAt
    });
  } catch (error: any) {
    console.error('Invite error:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/admin/invitations
router.get('/invitations', authMiddleware, requireAdmin, async (req: any, res: any) => {
  try {
    const invitations = await (prisma as any).invitation.findMany({
      orderBy: { createdAt: 'desc' }
    });
    res.json(invitations);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/admin/invitations/:id
router.delete('/invitations/:id', authMiddleware, requireAdmin, async (req: any, res: any) => {
  try {
    await (prisma as any).invitation.delete({
      where: { id: req.params.id }
    });
    res.json({ success: true, message: 'Invitation revoked successfully' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/admin/progress
router.get('/progress', authMiddleware, requireAdmin, async (req: any, res: any) => {
  try {
    // 1. University-wide Statistics
    const totalSessions = await (prisma as any).markingSession.count() || 0;
    const allResults = await (prisma as any).studentResult.findMany({
      include: { session: true }
    }) || [];
    
    const totalScore = allResults.reduce((acc: number, r: any) => acc + r.percentage, 0);
    const avgScore = allResults.length > 0 ? Math.round(totalScore / allResults.length) : 0;
    const passRate = allResults.length > 0
      ? Math.round(allResults.filter((r: any) => r.percentage >= 40).length / allResults.length * 100)
      : 0;

    // 2. Department performance
    const deptMap = new Map();
    allResults.forEach((r: any) => {
      const dept = r.session?.subject || 'General';
      const stats = deptMap.get(dept) || { total: 0, count: 0, passes: 0 };
      stats.total += r.percentage;
      stats.count++;
      if (r.percentage >= 40) stats.passes++;
      deptMap.set(dept, stats);
    });

    const departments = Array.from(deptMap.entries()).map(([name, s]: [string, any]) => ({
      name,
      avgScore: Math.round(s.total / s.count),
      passRate: Math.round((s.passes / s.count) * 100),
      studentCount: s.count
    }));

    // 3. Top Performing Students
    const topStudents = await (prisma as any).studentResult.findMany({
      orderBy: { percentage: 'desc' },
      take: 5,
      include: { session: true }
    }) || [];

    // 4. Sessions Overview
    const recentSessions = await (prisma as any).markingSession.findMany({
      orderBy: { createdAt: 'desc' },
      take: 10,
      include: { 
        _count: { select: { results: true } }
      }
    }) || [];

    // 5. System Health
    const totalAnswers = await (prisma as any).studentAnswerSheet.count() || 0;
    const totalMarked = allResults.length;
    const successRate = totalAnswers > 0 ? Math.round((totalMarked / totalAnswers) * 100) : 100;

    res.json({
      stats: {
        totalExams: totalMarked,
        passRate,
        avgScore,
        activeDept: departments.sort((a,b) => b.studentCount - a.studentCount)[0]?.name || 'N/A'
      },
      departments,
      topStudents: topStudents.map((s: any) => ({
        id: s.studentCode || s.studentId,
        score: Math.round(s.percentage),
        subject: s.session?.subject,
        lecturer: s.session?.lecturerId
      })),
      recentSessions: recentSessions.map((s: any) => ({
        id: s.id,
        name: s.name,
        subject: s.subject,
        status: s.status,
        students: s._count?.results || 0
      })),
      health: {
        markingSuccessRate: successRate,
        avgMarkingTime: '45s',
        storageUsed: '1.2GB' 
      }
    });
  } catch (error: any) {
    console.error('Admin progress error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

export default router;
