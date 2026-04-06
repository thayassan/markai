import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load env vars
dotenv.config({ path: path.join(__dirname, '../.env') });

const prisma = new PrismaClient();

async function createAdmin() {
  const email = process.argv[2];
  const password = process.argv[3];
  const fullName = process.argv[4] || 'System Admin';

  if (!email || !password) {
    console.log('Usage: npx tsx scripts/create_admin.ts <email> <password> ["Full Name"]');
    process.exit(1);
  }

  try {
    console.log(`Creating admin user: ${email}...`);
    
    const hashedPassword = await (bcrypt as any).hash(password, 12);
    
    const user = await (prisma as any).user.upsert({
      where: { email },
      update: {
        userType: 'ADMIN',
        role: 'ADMIN',
        password: hashedPassword
      },
      create: {
        email,
        fullName,
        password: hashedPassword,
        userType: 'ADMIN',
        role: 'ADMIN'
      }
    });

    console.log('✅ Admin user created/updated successfully:', user.id);
  } catch (error) {
    console.error('❌ Failed to create admin:', error);
  } finally {
    await prisma.$disconnect();
  }
}

createAdmin();
