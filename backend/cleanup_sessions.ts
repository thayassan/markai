import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function purgeSession(name: string) {
  console.log(`Searching for session: ${name}...`);
  const session = await (prisma as any).markingSession.findFirst({
    where: { name: name }
  });

  if (!session) {
    console.log(`❌ Session "${name}" not found. Skipping.`);
    return;
  }

  const id = session.id;
  console.log(`🗑️ Purging session "${name}" (ID: ${id})...`);

  try {
    const results = await (prisma as any).studentResult.findMany({
      where: { sessionId: id },
      select: { id: true }
    });

    for (const result of results) {
      const deletedQ = await (prisma as any).questionResult.deleteMany({
        where: { studentResultId: result.id }
      });
      console.log(`- Deleted ${deletedQ.count} QuestionResults for student ${result.id}`);
    }

    const deletedR = await (prisma as any).studentResult.deleteMany({
      where: { sessionId: id }
    });
    console.log(`- Deleted ${deletedR.count} StudentResults`);

    const deletedS = await (prisma as any).studentAnswerSheet.deleteMany({
      where: { sessionId: id }
    });
    console.log(`- Deleted ${deletedS.count} StudentAnswerSheets`);

    await (prisma as any).markingSession.delete({
      where: { id }
    });
    console.log(`✅ Session "${name}" successfully purged.`);
  } catch (err: any) {
    console.error(`❌ Error purging "${name}": ${err.message}`);
  }
}

async function main() {
  const clutter = [
    'IT CA — I9989 (UGC) 2026',
    'IT Mid Term — I6666 (UGC) 2026',
    'IT CA — I1999 (UGC) 2026'
  ];

  for (const name of clutter) {
    await purgeSession(name.trim());
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
