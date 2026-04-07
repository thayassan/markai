import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';
dotenv.config();

const prisma = new PrismaClient();

async function test() {
  console.log('Testing connection to:', process.env.DATABASE_URL?.replace(/:[^@]+@/, ':****@'));
  try {
    const res = await prisma.$queryRaw`SELECT 1`;
    console.log('✅ DB SUCCESS:', res);
  } catch (e: any) {
    console.error('❌ DB FAIL:', e.message);
  } finally {
    await prisma.$disconnect();
  }
}

test();
