import React from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Navbar, Footer } from '@/src/components/Layout';
import { ArrowLeft, BookOpen, Terminal, Code, Key, ExternalLink } from 'lucide-react';

export default function DocsPage() {
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

        <div className="space-y-4 mb-12">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-accent/10 border border-accent/20 text-accent text-xs font-bold uppercase tracking-wider">
            <BookOpen size={14} /> Developer & API Reference
          </div>
          <h1 className="text-4xl font-serif font-bold text-navy leading-tight">
            MarkAI Developer Documentation
          </h1>
          <p className="text-slate-600 text-base md:text-lg leading-relaxed">
            Integrate MarkAI's assessment engine into your existing Learning Management System (Canvas, Moodle, Blackboard) or custom school portal.
          </p>
        </div>

        <div className="space-y-8 mb-16">
          <div className="card p-8 bg-white border border-border space-y-4">
            <h2 className="text-xl font-serif font-bold text-navy flex items-center gap-2">
              <Key size={18} className="text-accent" /> Authentication
            </h2>
            <p className="text-sm text-slate-600">
              All API requests require a Bearer token generated through your institutional admin console.
            </p>
            <div className="p-4 rounded-xl bg-navy text-accent font-mono text-xs overflow-x-auto">
              Authorization: Bearer mk_live_a8f93bc091d...
            </div>
          </div>

          <div className="card p-8 bg-white border border-border space-y-4">
            <h2 className="text-xl font-serif font-bold text-navy flex items-center gap-2">
              <Terminal size={18} className="text-accent" /> Quickstart: Submit an Answer Sheet
            </h2>
            <p className="text-sm text-slate-600">
              Trigger background evaluation using the asynchronous job API:
            </p>
            <pre className="p-4 rounded-xl bg-navy text-white/90 font-mono text-xs overflow-x-auto">
{`curl -X POST https://markai-production-47ce.up.railway.app/api/ai/generate \\
  -H "Authorization: Bearer <TOKEN>" \\
  -H "Content-Type: application/json" \\
  -d '{"sessionId": "sess_12345"}'`}
            </pre>
            <p className="text-xs text-text-muted">
              Responds immediately with <code>{`{"jobId": "...", "status": "PROCESSING"}`}</code> for non-blocking execution.
            </p>
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
}
