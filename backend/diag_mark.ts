import { PrismaClient } from '@prisma/client';
import { GoogleGenAI } from '@google/genai';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const SESSION_ID = 'cmnk9trx800053uz0bn1l21qc';

const prisma = new PrismaClient();
const genAI = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function downloadText(url: string): Promise<string> {
  const { data, error } = await supabase.storage.from('markai-pdfs').download(url);
  if (error) throw new Error(`Storage download failed: ${error.message}`);
  return await data.text();
}

async function callGemini(contents: string): Promise<string> {
  const res = await genAI.models.generateContent({ model: 'gemini-2.0-flash', contents });
  return res.text || '';
}

async function run() {
  console.log('=== DIAGNOSTIC: Direct Marking Test ===\n');

  // 1. Load session
  const session = await prisma.markingSession.findUnique({ where: { id: SESSION_ID }, include: { answerSheets: true } });
  if (!session) { console.error('Session not found'); return; }
  console.log(`Session: ${session.name} | Status: ${session.status}`);
  console.log(`Answer sheets: ${session.answerSheets.length}`);
  session.answerSheets.forEach(s => console.log(`  - ${s.studentId}: ${s.status}, textLen=${s.extractedText?.length || 0}`));

  // 2. Load question paper text
  console.log('\n--- Loading question paper text ---');
  let questionText = '';
  if (session.questionTextUrl) {
    try {
      questionText = await downloadText(session.questionTextUrl);
      console.log(`✅ Loaded from storage: ${questionText.length} chars`);
      console.log('Preview:', questionText.substring(0, 200));
    } catch (e: any) {
      console.error('❌ Failed to load from storage:', e.message);
    }
  } else {
    console.log('No questionTextUrl on session');
  }

  // 3. Load mark scheme text
  console.log('\n--- Loading mark scheme text ---');
  let markSchemeText = '';
  if (session.markSchemeTextUrl) {
    try {
      markSchemeText = await downloadText(session.markSchemeTextUrl);
      console.log(`✅ Loaded from storage: ${markSchemeText.length} chars`);
      console.log('Preview:', markSchemeText.substring(0, 200));
    } catch (e: any) {
      console.error('❌ Failed to load from storage:', e.message);
    }
  } else {
    console.log('No markSchemeTextUrl on session');
  }

  // 4. Call Gemini for question parsing
  if (questionText.length > 10) {
    console.log('\n--- Calling Gemini: parseQuestionPaper ---');
    try {
      const resp = await callGemini(`Extract questions from this paper as JSON array. Return ONLY JSON.\n\n${questionText}`);
      console.log('✅ Gemini response length:', resp.length);
      console.log('Preview:', resp.substring(0, 300));
    } catch (e: any) {
      console.error('❌ Gemini parseQuestionPaper FAILED:', e.message);
      console.error('Full error:', JSON.stringify(e, null, 2));
    }
  } else {
    console.log('⚠️ Skipping Gemini call — question text too short:', questionText.length);
  }

  // 5. Call Gemini for marking one student
  const pendingSheet = session.answerSheets.find(s => s.status === 'PENDING' || s.status === 'ERROR');
  if (pendingSheet && questionText.length > 10 && markSchemeText.length > 10) {
    console.log(`\n--- Calling Gemini: markStudent ${pendingSheet.studentId} ---`);
    const studentText = pendingSheet.extractedText || '';
    console.log('Student answer text length:', studentText.length);
    try {
      const prompt = `Mark this student answer. Return JSON with studentId, totalMarks, maxMarks, percentage, grade, questions array.\n\nQUESTION PAPER:\n${questionText.substring(0, 2000)}\n\nMARK SCHEME:\n${markSchemeText.substring(0, 2000)}\n\nSTUDENT ANSWER:\n${studentText.substring(0, 2000)}`;
      const resp = await callGemini(prompt);
      console.log('✅ Gemini marking response length:', resp.length);
      console.log('Preview:', resp.substring(0, 500));
    } catch (e: any) {
      console.error('❌ Gemini markStudent FAILED:', e.message);
      console.error('Full error:', JSON.stringify(e, null, 2));
    }
  }

  await prisma.$disconnect();
  console.log('\n=== Diagnostic complete ===');
}

run().catch(e => { console.error('Fatal:', e); process.exit(1); });
