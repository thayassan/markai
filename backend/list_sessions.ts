import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
  const sessions = await (prisma as any).markingSession.findMany({
    select: { id: true, name: true, status: true, _count: { select: { results: true } } }
  });
  console.log(JSON.stringify(sessions, null, 2));
}
main().finally(() => prisma.$disconnect());
