import React from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Navbar, Footer } from '@/src/components/Layout';
import { ArrowLeft, CheckCircle2, Award, Users, Sparkles, ShieldCheck, Clock } from 'lucide-react';

export default function AboutPage() {
  const navigate = useNavigate();

  const values = [
    {
      icon: Clock,
      title: 'Time Returned to Teaching',
      description: 'Lecturers spend up to 40% of their time grading repetitive exams. MarkAI recovers those hours so educators can mentor and inspire.'
    },
    {
      icon: Award,
      title: 'Examiner-Level Precision',
      description: 'Our proprietary multi-pass AI compares student responses against mark schemes with granular, per-criterion evidence and scoring justification.'
    },
    {
      icon: ShieldCheck,
      title: 'Human-in-the-Loop Integrity',
      description: 'AI assists, never replaces. Lecturers retain 100% moderation authority to adjust marks, add personal notes, and approve all final scores.'
    },
    {
      icon: Users,
      title: 'Empowering Every Student',
      description: 'No more waiting weeks for generic grades. Students receive instant, actionable feedback pinpointing exactly where and how to improve.'
    }
  ];

  return (
    <div className="min-h-screen bg-bg flex flex-col justify-between">
      <Navbar />

      <main className="pt-28 pb-20 px-6 max-w-5xl mx-auto w-full">
        {/* Breadcrumb */}
        <button
          onClick={() => navigate('/')}
          className="inline-flex items-center gap-2 text-sm text-text-muted hover:text-navy transition-colors mb-8"
        >
          <ArrowLeft size={16} /> Back to Home
        </button>

        {/* Hero Section */}
        <div className="space-y-4 mb-16">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-accent/10 border border-accent/20 text-accent text-xs font-bold uppercase tracking-wider">
            <Sparkles size={14} /> About MarkAI
          </div>
          <h1 className="text-4xl md:text-5xl font-serif font-bold text-navy leading-tight">
            Built for Educators, <br />Powered by Advanced AI Precision
          </h1>
          <p className="text-slate-600 text-lg md:text-xl leading-relaxed max-w-3xl">
            MarkAI is an intelligent assessment and grading platform developed specifically for university faculties and secondary educators. We transform physical and digital exam papers into objective, examiner-calibrated results in minutes.
          </p>
        </div>

        {/* Core Values Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-20">
          {values.map((val, idx) => {
            const Icon = val.icon;
            return (
              <div key={idx} className="card p-8 bg-white border border-border hover:shadow-md transition-shadow">
                <div className="w-12 h-12 rounded-xl bg-accent/10 text-accent flex items-center justify-center mb-6">
                  <Icon size={24} />
                </div>
                <h3 className="text-xl font-serif font-bold text-navy mb-3">{val.title}</h3>
                <p className="text-slate-600 leading-relaxed text-sm">{val.description}</p>
              </div>
            );
          })}
        </div>

        {/* Story & Background */}
        <div className="card p-10 bg-white border border-border space-y-6 mb-20">
          <h2 className="text-2xl font-serif font-bold text-navy">Our Mission & Background</h2>
          <p className="text-slate-600 leading-relaxed">
            Founded in 2026, MarkAI emerged from a simple observation across universities in Sri Lanka and abroad: as class sizes expand, grading quality degrades under impossible lecturer workloads. Educators were forced to sacrifice weekends and evenings grading stacks of papers, leading to delayed feedback and educator burnout.
          </p>
          <p className="text-slate-600 leading-relaxed">
            By pairing multimodal vision language models with rigorous academic rubric parsing, MarkAI delivers deep question-by-question analysis, automatically identifies common cohort misconceptions, and enables rapid verification.
          </p>
          <div className="pt-4 border-t border-border flex flex-wrap gap-8 text-sm text-text-muted">
            <div className="flex items-center gap-2">
              <CheckCircle2 size={16} className="text-accent" />
              <span>500+ Institutions Piloting</span>
            </div>
            <div className="flex items-center gap-2">
              <CheckCircle2 size={16} className="text-accent" />
              <span>Full FERPA & GDPR compliance</span>
            </div>
            <div className="flex items-center gap-2">
              <CheckCircle2 size={16} className="text-accent" />
              <span>Multi-model failover architecture</span>
            </div>
          </div>
        </div>

        {/* CTA Banner */}
        <div className="bg-navy rounded-2xl p-10 text-center text-white space-y-6">
          <h2 className="text-3xl font-serif font-bold">Ready to streamline your marking?</h2>
          <p className="text-white/70 max-w-xl mx-auto text-sm">
            Join hundreds of forward-thinking professors and teachers who trust MarkAI every semester.
          </p>
          <div className="flex justify-center gap-4">
            <Link to="/register" className="btn-accent">
              Get Started Free
            </Link>
            <Link to="/features" className="px-6 py-2.5 rounded-lg border border-white/20 text-white font-medium hover:bg-white/10 transition-colors text-sm">
              Explore Features
            </Link>
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
}
