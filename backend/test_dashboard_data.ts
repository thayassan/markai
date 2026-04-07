import { prisma } from './src/prisma.js';

async function test() {
  try {
    const totalStudents = await (prisma as any).user.count({ 
      where: { userType: 'STUDENT' } 
    });
    console.log('Total Students:', totalStudents);

    const users = await (prisma as any).user.findMany();
    console.log('Total Users (findMany):', users.length);
    if (users.length > 0) {
      console.log('Sample User Type:', users[0].userType);
    }

    const sessions = await (prisma as any).markingSession.count();
    console.log('Total Sessions:', sessions);
  } catch (err) {
    console.error('Test failed:', err);
  } finally {
    await prisma.$disconnect();
  }
}

test();
