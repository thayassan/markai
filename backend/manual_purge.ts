import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function deleteSessionByName(name: string) {
  try {
    console.log(`Searching for session: "${name}"...`);
    const session = await (prisma as any).markingSession.findFirst({
      where: { name }
    });

    if (!session) {
      console.log(`❌ Session "${name}" not found.`);
      return;
    }

    const sessionId = session.id;
    console.log(`Found session ID: ${sessionId}. Starting sequential deletion...`);

    // 1. Delete QuestionResults (via StudentResult)
    const results = await (prisma as any).studentResult.findMany({
      where: { sessionId },
      select: { id: true }
    });

    for (const result of results) {
      const qTotal = await (prisma as any).questionResult.deleteMany({
        where: { studentResultId: result.id }
      });
      console.log(`- Deleted ${qTotal.count} QuestionResults for result ${result.id}`);
    }

    // 2. Delete StudentResults
    const rTotal = await (prisma as any).studentResult.deleteMany({
      where: { sessionId }
    });
    console.log(`- Deleted ${rTotal.count} StudentResults`);

    // 3. Delete StudentAnswerSheets
    const sTotal = await (prisma as any).studentAnswerSheet.deleteMany({
      where: { sessionId }
    });
    console.log(`- Deleted ${sTotal.count} AnswerSheets`);

    // 4. Delete the Session
    await (prisma as any).markingSession.delete({
      where: { id: sessionId }
    });
    console.log(`✅ Session "${name}" and all related data purged.`);
  } catch (error: any) {
    console.error(`❌ Error deleting "${name}": ${error.message}`);
  }
}

async function main() {
  const clutter = [
    'IT CA — I9989 (UGC) 2026',
    'IT Mid Term — I6666 (UGC) 2026',
    'IT CA — I1999 (UGC) 2026'
  ];

  for (const name of clutter) {
    await deleteSessionByName(name);
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
