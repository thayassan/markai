import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Navbar, Footer } from '@/src/components/Layout';
import { ArrowLeft, FileText, CheckCircle2, AlertTriangle, Scale, Mail } from 'lucide-react';

export default function TermsPage() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-bg flex flex-col justify-between">
      <Navbar />

      <main className="pt-28 pb-20 px-6 max-w-4xl mx-auto w-full">
        <button
          onClick={() => navigate('/')}
          className="inline-flex items-center gap-2 text-sm text-text-muted hover:text-navy transition-colors mb-8"
        >
          <ArrowLeft size={16} /> Back to Home
        </button>

        <div className="card p-10 md:p-14 bg-white border border-border space-y-10">
          <div>
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-accent/10 border border-accent/20 text-accent text-xs font-bold uppercase tracking-wider mb-4">
              <FileText size={14} /> Legal Agreement
            </div>
            <h1 className="text-3xl md:text-4xl font-serif font-bold text-navy mb-2">Terms of Service</h1>
            <p className="text-sm text-slate-400">Last updated: September 2026</p>
          </div>

          <div className="space-y-8 text-slate-600 leading-relaxed text-sm md:text-base border-t border-border pt-8">
            <section className="space-y-3">
              <h2 className="text-xl font-serif font-bold text-navy flex items-center gap-2">
                <CheckCircle2 size={20} className="text-accent" /> 1. Use of Service
              </h2>
              <p>
                MarkAI is licensed to accredited educational institutions, educators, and students solely for legitimate academic assessment, formative feedback, and course grading. Any use of MarkAI to bypass academic integrity policies, generate deceptive marks, or conduct unauthorized reverse engineering is strictly prohibited.
              </p>
            </section>

            <section className="space-y-3">
              <h2 className="text-xl font-serif font-bold text-navy flex items-center gap-2">
                <AlertTriangle size={20} className="text-gold" /> 2. Lecturer Moderation & Final Authority
              </h2>
              <p>
                All AI-generated marks, point allocations, and feedback statements are provided as high-confidence recommendations. Course lecturers and chief examiners retain sole pedagogical authority and final responsibility for official grade submission. MarkAI Technologies provides tools for manual adjustment and review before grades are finalized.
              </p>
            </section>

            <section className="space-y-3">
              <h2 className="text-xl font-serif font-bold text-navy flex items-center gap-2">
                <Scale size={20} className="text-accent" /> 3. Institution Responsibility & Content Accuracy
              </h2>
              <p>
                Instructors are responsible for the legibility and accuracy of uploaded examination papers, answer scripts, and marking criteria. Submissions must adhere to institutional copyright and intellectual property guidelines.
              </p>
            </section>

            <section className="space-y-3">
              <h2 className="text-xl font-serif font-bold text-navy flex items-center gap-2">
                <Mail size={20} className="text-accent" /> 4. Contact & Legal Enquiries
              </h2>
              <p>
                For questions regarding licensing terms, institution enterprise agreements, or legal disputes:
              </p>
              <p className="font-medium text-navy">
                Legal Department: <a href="mailto:legal@markai.demo" className="text-accent hover:underline">legal@markai.demo</a>
              </p>
            </section>
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
}
