import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function run() {
  try {
    // We just need a dummy lecturer ID or any ID to see if the query validates
    const lecturerId = 'fake_id';
    
    // Test 1: StudentResult
    console.log('Testing studentResult findMany...');
    const results = await prisma.studentResult.findMany({ 
      where: { session: { lecturerId: lecturerId } }, 
      select: { percentage: true } 
    });
    console.log('Success 1', results.length);

    // Test 2: MarkingSession count
    console.log('Testing markingSession count...');
    const totalSessions = await prisma.markingSession.count({ where: { lecturerId } });
    console.log('Success 2', totalSessions);

    // Test 3: Pending review count
    console.log('Testing pending review count...');
    const pendingReview = await prisma.markingSession.count({ where: { lecturerId, status: 'REVIEW_REQUIRED' } });
    console.log('Success 3', pendingReview);

  } catch (error) {
    console.error('DATABASE ERROR:', error);
  } finally {
    await prisma.$disconnect();
  }
}

run();
