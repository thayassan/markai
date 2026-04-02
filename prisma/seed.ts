import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  const school = await prisma.school.upsert({
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
    await prisma.user.upsert({
      where: { email: user.email },
      update: {
        password: hashedPassword,
        name: user.name,
        role: user.role as any,
        schoolId: school.id,
        studentCode: user.studentCode,
      },
      create: {
        email: user.email,
        password: hashedPassword,
        name: user.name,
        role: user.role as any,
        schoolId: school.id,
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
      schoolId: school.id,
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
