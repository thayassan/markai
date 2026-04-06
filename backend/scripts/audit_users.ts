import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load env vars
dotenv.config({ path: path.join(__dirname, '../.env') });

const prisma = new PrismaClient();

async function auditUsers() {
  try {
    console.log('--- USER AUDIT REPORT ---');
    console.log(`Time: ${new Date().toISOString()}\n`);

    const users = await (prisma as any).user.findMany({
      select: {
        id: true,
        email: true,
        fullName: true,
        userType: true,
        role: true,
        createdAt: true
      },
      orderBy: { createdAt: 'desc' }
    });

    const admins = users.filter((u: any) => 
      (u.userType || '').toUpperCase() === 'ADMIN' || 
      (u.role || '').toUpperCase() === 'ADMIN'
    );

    const lecturers = users.filter((u: any) => 
      (u.userType || '').toUpperCase() === 'LECTURER' || 
      (u.role || '').toUpperCase() === 'LECTURER'
    );

    console.log(`Total Users: ${users.length}`);
    console.log(`Admins: ${admins.length}`);
    console.log(`Lecturers: ${lecturers.length}`);
    console.log(`Students: ${users.length - admins.length - lecturers.length}\n`);

    if (admins.length > 0) {
      console.log('--- ADMIN USERS ---');
      admins.forEach((u: any) => {
        console.log(`- ${u.fullName} (${u.email}) [Type: ${u.userType}, Role: ${u.role}]`);
      });
      console.log('');
    }

    if (lecturers.length > 0) {
      console.log('--- LECTURER USERS ---');
      lecturers.forEach((u: any) => {
        console.log(`- ${u.fullName} (${u.email}) [Type: ${u.userType}, Role: ${u.role}]`);
      });
      console.log('');
    }

    // Flag potential anomalies
    const mismatched = users.filter((u: any) => u.userType !== u.role && u.role !== null);
    if (mismatched.length > 0) {
      console.log('--- ROLE MISMATCH WARNING ---');
      mismatched.forEach((u: any) => {
        console.log(`! ${u.email}: userType=${u.userType}, role=${u.role}`);
      });
    }

  } catch (error) {
    console.error('Audit failed:', error);
  } finally {
    await prisma.$disconnect();
  }
}

auditUsers();
