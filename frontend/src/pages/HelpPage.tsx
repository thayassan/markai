import React, { useState } from 'react';
import { Navbar, Footer } from '../components/Layout';
import { HelpCircle, Search, BookOpen, Sparkles, FileText, CheckCircle2, ChevronDown, ChevronUp } from 'lucide-react';
import { Link } from 'react-router-dom';

const FAQS = [
  {
    q: "How does MarkAI evaluate student handwriting?",
    a: "MarkAI uses OCR pre-processing optimized for handwritten examination scripts, paired with multimodal Google Gemini and Groq models. It identifies question boundaries, parses student working, and evaluates step-by-step logic against the official mark scheme."
  },
  {
    q: "Can lecturers review and override marks before students see them?",
    a: "Yes, completely. MarkAI is strictly AI-assisted, not AI-autonomous. Every question mark and feedback note can be reviewed, edited, or overridden by the lecturer. Additionally, the External Moderation workflow allows a second marker to inspect and ratify marks before publication."
  },
  {
    q: "What file formats are supported for answer sheets?",
    a: "MarkAI supports standard multi-page PDF files. Scans from flatbed scanners, automatic document feeders (ADF), or high-resolution camera scans are all accepted."
  },
  {
    q: "How does the Second Marking / Moderation workflow work?",
    a: "Once a marking session is approved by the primary lecturer, you can click 'Send for Moderation' and enter the email of a colleague or external examiner. They receive a secure 7-day link giving them direct access to review all papers, enter overrides, and formally ratify the results."
  },
  {
    q: "Is student data protected and FERPA/GDPR compliant?",
    a: "Yes. Student papers and grades are stored with AES-256 encryption at rest, access is strictly scoped to authenticated faculty and authorized moderators, and student data is never used to train public foundational models."
  }
];

export default function HelpPage() {
  const [searchTerm, setSearchTerm] = useState('');
  const [openIndex, setOpenIndex] = useState<number | null>(0);

  const filteredFaqs = FAQS.filter(
    f => f.q.toLowerCase().includes(searchTerm.toLowerCase()) || f.a.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="min-h-screen bg-bg flex flex-col justify-between">
      <Navbar />

      <main className="max-w-5xl mx-auto px-6 pt-32 pb-20 w-full">
        <div className="text-center max-w-2xl mx-auto mb-12">
          <span className="text-gold font-bold text-xs uppercase tracking-widest bg-gold-pale px-3 py-1 rounded">
            Knowledge Base
          </span>
          <h1 className="text-4xl md:text-5xl font-serif font-bold text-navy mt-4 mb-4">
            Help Center & Support
          </h1>
          <p className="text-text-muted text-base leading-relaxed">
            Find answers, quick guides, and troubleshooting for MarkAI's AI-assisted assessment platform.
          </p>

          <div className="mt-8 relative max-w-xl mx-auto">
            <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-text-muted" />
            <input 
              type="text"
              placeholder="Search help articles, moderation, mark schemes..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="input-field pl-12 pr-4 py-3.5 text-xs w-full shadow-sm"
            />
          </div>
        </div>

        {/* Quick Guides Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-16">
          <div className="card p-6 border border-border">
            <div className="w-10 h-10 rounded-lg bg-navy/10 text-navy flex items-center justify-center mb-4">
              <FileText size={20} />
            </div>
            <h3 className="font-serif font-bold text-navy text-base mb-1.5">Creating a Session</h3>
            <p className="text-xs text-text-muted leading-relaxed mb-4">
              Learn how to upload question papers, attach official mark schemes, and configure strictness.
            </p>
            <Link to="/docs" className="text-xs font-bold text-navy hover:underline inline-flex items-center gap-1">
              Read Guide →
            </Link>
          </div>

          <div className="card p-6 border border-border">
            <div className="w-10 h-10 rounded-lg bg-gold/10 text-gold flex items-center justify-center mb-4">
              <Sparkles size={20} />
            </div>
            <h3 className="font-serif font-bold text-navy text-base mb-1.5">AI Insights & Analytics</h3>
            <p className="text-xs text-text-muted leading-relaxed mb-4">
              Understand grade distributions, topic radar plots, and automated student diagnostic summaries.
            </p>
            <Link to="/features" className="text-xs font-bold text-navy hover:underline inline-flex items-center gap-1">
              Explore Analytics →
            </Link>
          </div>

          <div className="card p-6 border border-border">
            <div className="w-10 h-10 rounded-lg bg-emerald-100 text-emerald-700 flex items-center justify-center mb-4">
              <CheckCircle2 size={20} />
            </div>
            <h3 className="font-serif font-bold text-navy text-base mb-1.5">Second Marking & QA</h3>
            <p className="text-xs text-text-muted leading-relaxed mb-4">
              Step-by-step external moderation workflow to share sessions with examiners for audit approval.
            </p>
            <Link to="/contact" className="text-xs font-bold text-navy hover:underline inline-flex items-center gap-1">
              Ask Support →
            </Link>
          </div>
        </div>

        {/* FAQ Accordion */}
        <div className="card p-8 border border-border bg-surface">
          <h2 className="text-2xl font-serif font-bold text-navy mb-6">Frequently Asked Questions</h2>
          <div className="divide-y divide-border">
            {filteredFaqs.map((faq, i) => {
              const isOpen = openIndex === i;
              return (
                <div key={i} className="py-4">
                  <button
                    onClick={() => setOpenIndex(isOpen ? null : i)}
                    className="w-full text-left flex justify-between items-center gap-4 font-bold text-navy text-sm hover:text-navy-light transition-colors"
                  >
                    <span>{faq.q}</span>
                    <span className="text-text-muted shrink-0">
                      {isOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                    </span>
                  </button>
                  {isOpen && (
                    <p className="mt-2 text-xs text-text-muted leading-relaxed pr-6">
                      {faq.a}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
}
