import React from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Navbar, Footer } from '@/src/components/Layout';
import { 
  ArrowLeft, Sparkles, CheckCircle2, Eye, Cpu, 
  BarChart2, Edit3, Download, Zap, RefreshCw, ShieldCheck 
} from 'lucide-react';

export default function FeaturesPage() {
  const navigate = useNavigate();

  const features = [
    {
      icon: Eye,
      title: 'Multimodal Vision Parsing',
      description: 'Upload photographed or scanned exam scripts. Our vision pipeline transcribes complex handwritten equations, biological diagrams, and tabular calculations directly from image layout.'
    },
    {
      icon: Cpu,
      title: 'Dynamic Gemini 3.1 Key Rotation',
      description: 'Zero rate-limit bottlenecks. Our multi-key pooling automatically distributes grading tasks across active keys with 480+ RPD each, processing hundreds of scripts in minutes.'
    },
    {
      icon: CheckCircle2,
      title: 'Rubric-Aligned Question Breakdown',
      description: 'Extracts exact sub-question structures (e.g. Q1(a)(i) to Q4(d)(ii)) with point allocations, evaluating student evidence against each rubric criterion.'
    },
    {
      icon: Edit3,
      title: 'Moderation & Live Mark Overrides',
      description: 'Complete lecturer control. Review AI evidence, tweak scores per sub-question, insert personalized lecturer feedback, and watch totals recalculate in real time.'
    },
    {
      icon: BarChart2,
      title: 'Deep Cohort Analytics & Radar Charts',
      description: 'Instantly visualize class grade distributions, identify weak curriculum topics, and export grade curves to make data-informed teaching interventions.'
    },
    {
      icon: Download,
      title: 'Instant Student Reports & Gradebook Export',
      description: 'Generate polished per-student feedback PDFs and download complete class spreadsheets compatible with Canvas, Moodle, and Blackboard LMS.'
    }
  ];

  return (
    <div className="min-h-screen bg-bg flex flex-col justify-between">
      <Navbar />

      <main className="pt-28 pb-20 px-6 max-w-6xl mx-auto w-full">
        <button
          onClick={() => navigate('/')}
          className="inline-flex items-center gap-2 text-sm text-text-muted hover:text-navy transition-colors mb-8"
        >
          <ArrowLeft size={16} /> Back to Home
        </button>

        <div className="text-center max-w-3xl mx-auto space-y-4 mb-16">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-accent/10 border border-accent/20 text-accent text-xs font-bold uppercase tracking-wider">
            <Sparkles size={14} /> Comprehensive Platform
          </div>
          <h1 className="text-4xl md:text-5xl font-serif font-bold text-navy leading-tight">
            Designed for Modern Academic Assessment
          </h1>
          <p className="text-slate-600 text-lg leading-relaxed">
            From batch PDF extraction to real-time AI evaluation and gradebook integration — explore the end-to-end toolkit trusted by educators worldwide.
          </p>
        </div>

        {/* Feature Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8 mb-20">
          {features.map((f, i) => {
            const Icon = f.icon;
            return (
              <div key={i} className="card p-8 bg-white border border-border flex flex-col justify-between hover:border-accent/40 transition-colors">
                <div>
                  <div className="w-12 h-12 rounded-xl bg-accent/10 text-accent flex items-center justify-center mb-6">
                    <Icon size={24} />
                  </div>
                  <h3 className="text-lg font-serif font-bold text-navy mb-3">{f.title}</h3>
                  <p className="text-slate-600 text-sm leading-relaxed">{f.description}</p>
                </div>
              </div>
            );
          })}
        </div>

        {/* Workflow Showcase */}
        <div className="card p-10 md:p-14 bg-white border border-border space-y-8 mb-20">
          <h2 className="text-2xl md:text-3xl font-serif font-bold text-navy text-center">How MarkAI Operates</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <div className="space-y-3 p-6 rounded-2xl bg-bg border border-border text-center">
              <div className="w-10 h-10 rounded-full bg-navy text-white font-bold flex items-center justify-center mx-auto">1</div>
              <h4 className="font-serif font-bold text-navy">Upload Paper & Scheme</h4>
              <p className="text-xs text-slate-600">Upload your exam question paper and marking guide in PDF or Word format.</p>
            </div>
            <div className="space-y-3 p-6 rounded-2xl bg-bg border border-border text-center">
              <div className="w-10 h-10 rounded-full bg-accent text-white font-bold flex items-center justify-center mx-auto">2</div>
              <h4 className="font-serif font-bold text-navy">Batch Process Scripts</h4>
              <p className="text-xs text-slate-600">Drop in student answer sheets. Vision models extract and assess answers simultaneously.</p>
            </div>
            <div className="space-y-3 p-6 rounded-2xl bg-bg border border-border text-center">
              <div className="w-10 h-10 rounded-full bg-navy text-white font-bold flex items-center justify-center mx-auto">3</div>
              <h4 className="font-serif font-bold text-navy">Review & Publish</h4>
              <p className="text-xs text-slate-600">Moderate scores, adjust criteria if needed, and distribute feedback to students with 1 click.</p>
            </div>
          </div>
        </div>

        {/* CTA Banner */}
        <div className="bg-navy rounded-2xl p-10 text-center text-white space-y-6">
          <h2 className="text-3xl font-serif font-bold">Experience automated marking today</h2>
          <p className="text-white/70 max-w-xl mx-auto text-sm">
            Create an exam session and see how fast your next paper gets graded.
          </p>
          <div className="flex justify-center gap-4">
            <Link to="/register" className="btn-accent">
              Start Free Trial
            </Link>
            <Link to="/pricing" className="px-6 py-2.5 rounded-lg border border-white/20 text-white font-medium hover:bg-white/10 transition-colors text-sm">
              View Pricing
            </Link>
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
}
