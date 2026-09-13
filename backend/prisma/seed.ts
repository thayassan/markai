import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  const university = await prisma.university.upsert({
    where: { id: 'university-of-kelaniya' },
    update: {},
    create: {
      id: 'university-of-kelaniya',
      name: 'University Of Kelaniya',
    },
  });

  const users = [
    {
      email: 'student@markai.demo',
      password: 'Student@1234',
      name: 'Fatima Al-Rashidi',
      role: 'STUDENT',
      studentCode: 'CS/2024/042',
    },
    {
      email: 'lecturer@markai.demo',
      password: 'Lecturer@1234',
      name: 'Dr. Sanjay Mehta',
      role: 'LECTURER',
    },
    {
      email: 'admin@markai.demo',
      password: 'Admin@1234',
      name: 'Prof. Linda Wanjiru',
      role: 'SCHOOL_ADMIN',
    },
  ];

  for (const user of users) {
    const hashedPassword = await bcrypt.hash(user.password, 12);
    await (prisma as any).user.upsert({
      where: { email: user.email },
      update: {
        password: hashedPassword,
        fullName: user.name,
        userType: user.role as any,
        universityId: university.id,
        studentCode: user.studentCode,
      },
      create: {
        email: user.email,
        password: hashedPassword,
        fullName: user.name,
        userType: user.role as any,
        universityId: university.id,
        studentCode: user.studentCode,
      },
    });
  }

  // Migrate any previous demo student results/answer sheets from S2024-0042 to CS/2024/042
  const updatedResults = await (prisma as any).studentResult.updateMany({
    where: {
      OR: [
        { studentId: { contains: 'S2024-0042' } },
        { studentCode: { contains: 'S2024-0042' } }
      ]
    },
    data: {
      studentId: 'CS/2024/042',
      studentCode: 'CS/2024/042'
    }
  });
  if (updatedResults.count > 0) {
    console.log(`Migrated ${updatedResults.count} StudentResult record(s) to CS/2024/042`);
  }

  const updatedSheets = await (prisma as any).studentAnswerSheet.updateMany({
    where: {
      studentId: { contains: 'S2024-0042' }
    },
    data: {
      studentId: 'CS/2024/042'
    }
  });
  if (updatedSheets.count > 0) {
    console.log(`Migrated ${updatedSheets.count} StudentAnswerSheet record(s) to CS/2024/042`);
  }

  // Add a sample class
  const lecturerUser = await prisma.user.findFirst({
    where: { email: 'lecturer@markai.demo' }
  });

  if (lecturerUser) {
    const sampleClass = await prisma.class.upsert({
      where: { id: 'sample-class' },
      update: {
        lecturerId: lecturerUser.id,
      },
      create: {
        id: 'sample-class',
        name: 'Biology 101',
        universityId: university.id,
        lecturerId: lecturerUser.id,
      },
    });
  }

  console.log('Seed data created successfully!');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
