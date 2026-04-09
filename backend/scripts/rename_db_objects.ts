import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function run() {
  try {
    console.log('--- DB RENAME START ---');
    
    // 1. Rename the main table
    console.log('Renaming table "School" to "University"...');
    await prisma.$executeRawUnsafe('ALTER TABLE "School" RENAME TO "University";');
    
    // 2. Rename columns in User table
    console.log('Renaming column "schoolId" to "universityId" in "User" table...');
    await prisma.$executeRawUnsafe('ALTER TABLE "User" RENAME COLUMN "schoolId" TO "universityId";');
    
    // 3. Rename columns in Class table
    console.log('Renaming column "schoolId" to "universityId" in "Class" table...');
    await prisma.$executeRawUnsafe('ALTER TABLE "Class" RENAME COLUMN "schoolId" TO "universityId";');

    console.log('--- DB RENAME COMPLETE ---');
  } catch (error) {
    console.error('DATABASE ERROR during rename:', error);
    console.log('\nNote: If the error says "table does not exist", it might already be renamed.');
  } finally {
    await prisma.$disconnect();
  }
}

run();
