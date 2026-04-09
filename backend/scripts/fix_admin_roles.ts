import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function migrateAdminRoles() {
  console.log('--- Migrating Admin Users to ADMIN ---');
  
  try {
    // Fix admin users in database as requested
    const result = await prisma.user.updateMany({
      where: {
        OR: [
          { userType: 'SCHOOL_ADMIN' },
          { role: 'SCHOOL_ADMIN' },
          { email: 'admin@markai.demo' }
        ]
      },
      data: {
        role: 'ADMIN',
        userType: 'ADMIN'
      }
    });
    console.log(`✅ Admin users migrated successfully. Count: ${result.count}`);
  } catch (e) {
    console.error('Failed to migrate admin users:', e);
  }

  console.log('--- Admin Migration Completed ---');
}

migrateAdminRoles()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
