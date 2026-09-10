import React from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Navbar, Footer } from '@/src/components/Layout';
import { ArrowLeft, Sparkles, Briefcase, MapPin, Clock } from 'lucide-react';

export default function CareersPage() {
  const navigate = useNavigate();

  const openings = [
    {
      role: 'Senior Full Stack Engineer (Node.js / React / TypeScript)',
      team: 'Engineering',
      location: 'Colombo, Sri Lanka / Remote',
      type: 'Full-time'
    },
    {
      role: 'AI / Machine Learning Engineer (Vision & LLM Fine-Tuning)',
      team: 'AI Research',
      location: 'Remote (Global)',
      type: 'Full-time'
    },
    {
      role: 'Educational Assessment Specialist',
      team: 'Academic Partnerships',
      location: 'Colombo / Hybrid',
      type: 'Full-time'
    }
  ];

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
            <Sparkles size={14} /> Join the Team
          </div>
          <h1 className="text-4xl font-serif font-bold text-navy leading-tight">
            Help Us Reshape the Future of Education
          </h1>
          <p className="text-slate-600 text-base md:text-lg leading-relaxed">
            At MarkAI, we believe educator time is sacred. Join our diverse team of engineers, researchers, and former teachers solving one of the largest bottlenecks in modern academia.
          </p>
        </div>

        <div className="space-y-4 mb-16">
          <h2 className="text-xl font-serif font-bold text-navy mb-4">Open Positions</h2>
          {openings.map((job, i) => (
            <div key={i} className="card p-6 bg-white border border-border flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 hover:border-accent/40 transition-colors">
              <div>
                <h3 className="font-serif font-bold text-navy text-lg">{job.role}</h3>
                <div className="flex flex-wrap gap-4 text-xs text-text-muted mt-2">
                  <span className="flex items-center gap-1"><Briefcase size={14} /> {job.team}</span>
                  <span className="flex items-center gap-1"><MapPin size={14} /> {job.location}</span>
                  <span className="flex items-center gap-1"><Clock size={14} /> {job.type}</span>
                </div>
              </div>
              <a 
                href="mailto:careers@markai.demo?subject=Application for " 
                className="px-5 py-2 rounded-lg bg-navy text-white text-xs font-bold hover:bg-navy/90 transition-colors whitespace-nowrap"
              >
                Apply Now
              </a>
            </div>
          ))}
        </div>
      </main>

      <Footer />
    </div>
  );
}
