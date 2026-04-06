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
      studentCode: 'S2024-0042',
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

  // Add a sample class
  const sampleClass = await prisma.class.upsert({
    where: { id: 'sample-class' },
    update: {},
    create: {
      id: 'sample-class',
      name: 'Biology 101',
      universityId: university.id,
      lecturerId: 'lecturer_id', // This will be updated if needed
    },
  });

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
