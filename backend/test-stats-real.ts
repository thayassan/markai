import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function run() {
  try {
    const user = await prisma.user.findFirst({
      where: { role: 'LECTURER' }
    });
    console.log('Lecturer:', user?.id, user?.email);

    if (!user) {
        console.log("No lecturer found!");
        return;
    }

    const lecturerId = user.id;
    
    // Simulate API query
    const results = await prisma.studentResult.findMany({ 
        where: { session: { lecturerId: lecturerId } }, 
        select: { percentage: true } 
    });

    const totalSessions = await prisma.markingSession.count({ where: { lecturerId } });
    const pendingReview = await prisma.markingSession.count({ where: { lecturerId, status: 'REVIEW_REQUIRED' } });

    console.log({
        totalSessions,
        papersMarked: results.length,
        pendingReview,
        avg: results.length ? results[0].percentage : 0
    });

    // Let's also check if there is an ADMIN user
    const admin = await prisma.user.findFirst({
      where: { role: 'ADMIN' }
    });
    console.log('Admin:', admin?.id, admin?.email);
    if(admin) {
        const adminSessions = await prisma.markingSession.count({ where: { lecturerId: admin.id } });
        console.log('Admin sessions count with their lecturerID:', adminSessions);
    }
  } catch (error) {
    console.error('DATABASE ERROR:', error);
  } finally {
    await prisma.$disconnect();
  }
}

run();
