import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Navbar, Footer } from '@/src/components/Layout';
import { ArrowLeft, Shield, Lock, Eye, Database, HelpCircle } from 'lucide-react';

export default function PrivacyPage() {
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
              <Shield size={14} /> Legal & Compliance
            </div>
            <h1 className="text-3xl md:text-4xl font-serif font-bold text-navy mb-2">Privacy Policy</h1>
            <p className="text-sm text-slate-400">Last updated: September 2026</p>
          </div>

          <div className="space-y-8 text-slate-600 leading-relaxed text-sm md:text-base border-t border-border pt-8">
            <section className="space-y-3">
              <h2 className="text-xl font-serif font-bold text-navy flex items-center gap-2">
                <Database size={20} className="text-accent" /> 1. Data We Collect
              </h2>
              <p>
                MarkAI processes information strictly required to deliver accurate exam assessment and educational analytics. This includes:
              </p>
              <ul className="list-disc pl-6 space-y-2 text-sm">
                <li>Exam question papers, rubrics, and answer keys provided by course instructors.</li>
                <li>Digital and scanned student answer sheets (including handwritten scripts and diagrams).</li>
                <li>Instructor account credentials, email addresses, and university department identifiers.</li>
                <li>Aggregated performance metrics and moderation adjustment history.</li>
              </ul>
            </section>

            <section className="space-y-3">
              <h2 className="text-xl font-serif font-bold text-navy flex items-center gap-2">
                <Lock size={20} className="text-accent" /> 2. AI Processing & Google Gemini API
              </h2>
              <p>
                To provide examiner-level grading, uploaded scripts and mark schemes are processed using enterprise instances of Google's Gemini Multimodal API.
              </p>
              <p className="text-sm bg-bg p-4 rounded-xl border border-border">
                <strong>Zero Training Guarantee:</strong> In accordance with Google Cloud enterprise privacy standards, student submissions and educator materials are processed in isolated transient memory and are <strong>never</strong> used to train public foundation models or shared with unauthorized third parties.
              </p>
            </section>

            <section className="space-y-3">
              <h2 className="text-xl font-serif font-bold text-navy flex items-center gap-2">
                <Eye size={20} className="text-accent" /> 3. Data Storage & Retention
              </h2>
              <p>
                All data in transit is encrypted using TLS 1.3, and data at rest is protected with AES-256 encryption hosted in secure Supabase Postgres clusters.
              </p>
              <p>
                Exam session materials are retained for 12 months following session completion to support academic appeals. Department administrators can request immediate data purging at any time via the Admin Dashboard or by contacting support.
              </p>
            </section>

            <section className="space-y-3">
              <h2 className="text-xl font-serif font-bold text-navy flex items-center gap-2">
                <HelpCircle size={20} className="text-accent" /> 4. Contact Information
              </h2>
              <p>
                If you have questions regarding our data governance, GDPR compliance, or institutional data processing agreements, please reach out directly:
              </p>
              <p className="font-medium text-navy">
                Data Protection Officer: <a href="mailto:privacy@markai.demo" className="text-accent hover:underline">privacy@markai.demo</a>
              </p>
            </section>
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
}
