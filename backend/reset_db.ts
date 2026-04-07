import { prisma } from './src/prisma.js';

async function main() {
  const sessionId = 'cmnlzw1yy00013url9og4i6cz';
  await (prisma as any).markingSession.update({
    where: { id: sessionId },
    data: { status: 'PENDING' }
  });
  console.log('✅ Session reset to PENDING');
  process.exit(0);
}
main().catch(console.error);
