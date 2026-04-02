import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
  const sessions = await prisma.markingSession.findMany({
    include: { results: true },
    orderBy: { createdAt: 'desc' },
    take: 5
  });
  console.log('Recent Marking Sessions:');
  sessions.forEach(s => {
    console.log(`- ${s.name} (${s.id}) - Status: ${s.status} - Results: ${s.results.length}`);
  });
}
main().catch(console.error).finally(() => prisma.$disconnect());
