import { prisma } from './src/prisma.js';

async function main() {
  const sessionId = 'cmnlzw1yy00013url9og4i6cz';
  const session = await (prisma as any).markingSession.findUnique({
    where: { id: sessionId },
    include: { answerSheets: true }
  });
  console.log('Session exists:', !!session);

  const submissions = await (prisma as any).studentAnswerSheet.findMany({
    where: { sessionId: sessionId }
  });
  console.log('Submissions length (direct query):', submissions.length);
  console.log('Submissions length (relation):', session?.answerSheets?.length);
  console.log('Has answer text:', submissions.map((s: any) => ({
    id: s.id,
    hasText: !!s.answerText,
    hasTextUrl: !!s.answerTextUrl,
    pdfUrl: s.pdfUrl,
    status: s.status
  })));
  process.exit(0);
}
main().catch(console.error);
