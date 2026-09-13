import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';

dotenv.config();

const prisma = new PrismaClient();

async function main() {
  console.log('--- Starting Student ID Trim Cleanup ---');

  // 1. Inspect existing StudentResult rows with whitespace
  const rawResults: any[] = await prisma.$queryRaw`
    SELECT id, "sessionId", "studentId", "studentCode", "studentName"
    FROM "StudentResult"
    WHERE "studentId" != TRIM("studentId") 
       OR ("studentCode" IS NOT NULL AND "studentCode" != TRIM("studentCode"))
  `;

  console.log(`Found ${rawResults.length} StudentResult records with untrimmed whitespace:`);
  for (const r of rawResults) {
    console.log(`  - ID: ${r.id} | studentId: "${r.studentId}" -> "${r.studentId.trim()}" | session: ${r.sessionId}`);
  }

  // 2. Inspect existing StudentAnswerSheet rows with whitespace
  const rawSheets: any[] = await prisma.$queryRaw`
    SELECT id, "sessionId", "studentId", "studentName"
    FROM "StudentAnswerSheet"
    WHERE "studentId" != TRIM("studentId")
  `;

  console.log(`Found ${rawSheets.length} StudentAnswerSheet records with untrimmed whitespace:`);
  for (const s of rawSheets) {
    console.log(`  - ID: ${s.id} | studentId: "${s.studentId}" -> "${s.studentId.trim()}" | session: ${s.sessionId}`);
  }

  // 3. Inspect existing User rows with whitespace in studentCode
  const rawUsers: any[] = await prisma.$queryRaw`
    SELECT id, email, "studentCode"
    FROM "User"
    WHERE "studentCode" IS NOT NULL AND "studentCode" != TRIM("studentCode")
  `;

  console.log(`Found ${rawUsers.length} User records with untrimmed studentCode:`);
  for (const u of rawUsers) {
    console.log(`  - ID: ${u.id} | email: ${u.email} | studentCode: "${u.studentCode}" -> "${u.studentCode.trim()}"`);
  }

  // Execute database updates
  const updatedResultsCount = await prisma.$executeRaw`
    UPDATE "StudentResult" 
    SET "studentId" = TRIM("studentId"),
        "studentCode" = CASE 
          WHEN "studentCode" IS NOT NULL THEN TRIM("studentCode")
          ELSE TRIM("studentId")
        END
    WHERE "studentId" != TRIM("studentId")
       OR ("studentCode" IS NOT NULL AND "studentCode" != TRIM("studentCode"))
       OR "studentCode" IS NULL
  `;
  console.log(`Updated ${updatedResultsCount} StudentResult records.`);

  const updatedSheetsCount = await prisma.$executeRaw`
    UPDATE "StudentAnswerSheet"
    SET "studentId" = TRIM("studentId")
    WHERE "studentId" != TRIM("studentId")
  `;
  console.log(`Updated ${updatedSheetsCount} StudentAnswerSheet records.`);

  const updatedUsersCount = await prisma.$executeRaw`
    UPDATE "User"
    SET "studentCode" = TRIM("studentCode")
    WHERE "studentCode" IS NOT NULL AND "studentCode" != TRIM("studentCode")
  `;
  console.log(`Updated ${updatedUsersCount} User records.`);

  console.log('--- Cleanup Completed Successfully ---');
}

main()
  .catch((err) => {
    console.error('Error during cleanup:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
