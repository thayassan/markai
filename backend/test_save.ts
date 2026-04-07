import { prisma } from './src/prisma.js';

async function test() {
  try {
    const q = { questionNumber: '1', confidence: 80 };
    await (prisma as any).studentResult.create({
      data: {
        sessionId: "cmnlzw1yy00013url9og4i6cz",
        studentId: "STU3",
        studentName: "STU3",
        studentCode: "STU3",
        answerPdfUrl: "answers/dummy.pdf",
        totalMarks: 45,
        maxMarks: 50,
        percentage: 90.0,
        grade: "A*",
        reviewed: false,
        aiData: {},
        questions: {
          create: [{
            questionNumber: String(q.questionNumber),
            questionText: '',
            topic: 'General',
            marksAwarded: 0,
            marksAvailable: 0,
            status: 'INCORRECT',
            studentAnswer: '',
            expectedAnswer: '',
            aiFeedback: '',
            lostMarksReason: null,
            improvementSuggestion: '',
            confidence: Number(q.confidence) || null,
            confidenceReason: null,
            requiresReview: Number(q.confidence) < 70
          }]
        }
      }
    });
    console.log('✅ Success');
  } catch(e: any) {
    console.log('❌ Error:');
    console.log(e.message);
  }
}
test().catch(console.error);
