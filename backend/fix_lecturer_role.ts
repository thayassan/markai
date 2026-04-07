import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function run() {
  try {
    console.log('--- USER ROLE SYNC START ---');
    const users = await prisma.user.findMany();
    console.log(`Found ${users.length} users to check.`);

    let updatedCount = 0;
    for (const user of users) {
      if (!user.role || user.role.trim() === '') {
        console.log(`Fixing user: ${user.email} (Type: ${user.userType}, Current Role: EMPTY)`);
        await prisma.user.update({
          where: { id: user.id },
          data: { role: user.userType.toUpperCase() }
        });
        updatedCount++;
      } else if (user.role.toUpperCase() !== user.userType.toUpperCase()) {
         console.log(`Syncing user: ${user.email} (Type: ${user.userType}, Current Role: ${user.role})`);
         await prisma.user.update({
           where: { id: user.id },
           data: { role: user.userType.toUpperCase() }
         });
         updatedCount++;
      }
    }

    console.log(`Successfully updated/synced ${updatedCount} users.`);
    console.log('--- USER ROLE SYNC COMPLETE ---');
  } catch (error) {
    console.error('DATABASE ERROR:', error);
  } finally {
    await prisma.$disconnect();
  }
}

run();
