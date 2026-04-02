import React, { useEffect } from 'react';
import { motion } from 'motion/react';
import { Navbar, Footer } from '@/src/components/Layout';
import { CheckCircle2, Star, ArrowRight } from 'lucide-react';
import { cn } from '@/src/lib/utils';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const LandingPage = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const dashboardPath = user ? (user.role === 'STUDENT' ? '/dashboard' : user.role === 'LECTURER' ? '/lecturer/dashboard' : '/admin/dashboard') : '/register';


  const [testimonials, setTestimonials] = React.useState(() => {
    const savedFeedback = JSON.parse(localStorage.getItem('userFeedback') || '[]');
    const initial = [
      { name: 'Dr. Rachel Okonkwo', role: 'Head of Science', inst: 'Brookfield Sixth Form', quote: 'MarkAI has completely transformed our mock season. What used to take weeks now takes a single afternoon.' },
      { name: 'Mr. Sanjay Mehta', role: 'Mathematics Lead', inst: 'Colombo Int. School', quote: 'The accuracy of the method marks is what impressed me most. It understands the steps, not just the answer.' },
      { name: 'Fatima Al-Rashidi', role: 'IB Coordinator', inst: 'IB World School Dubai', quote: 'Our students love the instant feedback. They no longer have to wait 2 weeks to know where they went wrong.' },
      { name: 'Prof. Linda Wanjiru', role: 'Dean of Studies', inst: 'Summit College Group', quote: 'A vital tool for any large institution. The analytics provide insights we simply couldn\'t see before.' },
      { name: 'James Cartwright', role: 'CIE Examiner', inst: 'Independent', quote: 'I was skeptical of AI marking, but MarkAI follows the mark scheme more consistently than many human markers.' },
      { name: 'Kwame Tetteh', role: 'A-Level Maths', inst: 'Accra Academy', quote: 'The time saved is invaluable. I can finally focus on one-on-one support for my struggling students.' }
    ];
    return [...savedFeedback, ...initial];
  });

  return (
    <div className="min-h-screen">
      <Navbar />
      
      {/* Hero Section */}
      <section className="relative min-h-screen bg-navy flex items-center pt-20 overflow-hidden">
        <div className="absolute inset-0 opacity-20 pointer-events-none" 
          style={{ backgroundImage: 'radial-gradient(circle at 2px 2px, rgba(255,255,255,0.15) 1px, transparent 0)', backgroundSize: '40px 40px' }}>
        </div>
        <div className="absolute top-1/4 -left-20 w-96 h-96 bg-accent/20 rounded-full blur-[120px]"></div>
        <div className="absolute bottom-1/4 -right-20 w-96 h-96 bg-gold/10 rounded-full blur-[120px]"></div>

        <div className="max-w-7xl mx-auto px-6 grid grid-cols-1 lg:grid-cols-2 gap-16 items-center relative z-10">
          <motion.div 
            initial={{ opacity: 0, x: -50 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.8 }}
          >
            <h1 className="text-white text-4xl md:text-6xl lg:text-7xl font-serif leading-[1.1] mb-8">
              Mark papers in <span className="italic text-accent">minutes,</span> not hours
            </h1>
            <p className="text-white/80 text-lg md:text-xl font-light mb-10 max-w-xl leading-relaxed">
              The world's most advanced AI marking platform for educators. Achieve examiner-level precision with automated feedback and detailed analytics.
            </p>
            <div className="flex flex-wrap gap-4 mb-12">
              <Link to={dashboardPath} className="btn-accent flex items-center gap-2">
                {user ? 'Go to Dashboard' : 'Get started free'} <ArrowRight size={18} />
              </Link>
            </div>
            <div className="flex flex-wrap gap-8">
              {[
                { label: '98% Accuracy', color: 'accent' },
                { label: 'Few seconds per paper', color: 'gold' },
                { label: '40+ Courses', color: 'accent' }
              ].map((stat) => (
                <div key={stat.label} className="flex items-center gap-2">
                  <div className={cn(
                    "w-1.5 h-1.5 rounded-full",
                    stat.color === 'navy' && "bg-navy",
                    stat.color === 'accent' && "bg-accent",
                    stat.color === 'gold' && "bg-gold",
                    stat.color === 'red' && "bg-red"
                  )}></div>
                  <span className="text-white/60 text-sm font-medium uppercase tracking-wider">{stat.label}</span>
                </div>
              ))}
            </div>
          </motion.div>

          <motion.div 
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.8, delay: 0.2 }}
            className="relative"
          >
            <div className="card bg-white/10 backdrop-blur-xl border-white/20 p-8 animate-float">
              <div className="flex justify-between items-start mb-8">
                <div>
                  <h3 className="text-white font-serif text-xl mb-1">Student: Fatima A.</h3>
                  <p className="text-white/50 text-sm">IB Biology — Paper 2</p>
                </div>
                <div className="text-right">
                  <div className="text-accent text-4xl font-serif font-bold">74/80</div>
                  <div className="badge bg-accent/20 text-accent">Grade A*</div>
                </div>
              </div>
              <div className="space-y-4">
                {[
                  { q: 'Q1. Cell Respiration', m: '10/10', s: 'full' },
                  { q: 'Q2. Photosynthesis', m: '8/12', s: 'partial' },
                  { q: 'Q3. Genetics', m: '15/15', s: 'full' }
                ].map((item) => (
                  <div key={item.q} className="flex items-center justify-between p-4 bg-white/5 rounded-lg border border-white/10">
                    <span className="text-white/80 text-sm">{item.q}</span>
                    <span className={cn(
                      "text-xs font-bold px-2 py-1 rounded",
                      item.s === 'full' ? "text-accent" : "text-gold"
                    )}>{item.m}</span>
                  </div>
                ))}
              </div>
            </div>
            
            {/* Floating notification cards */}
            <div className="absolute -top-10 -right-2 md:-right-10 card bg-white p-4 shadow-2xl animate-float" style={{ animationDelay: '1s' }}>
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-accent/20 rounded-full flex items-center justify-center text-accent">
                  <CheckCircle2 size={20} />
                </div>
                <div>
                  <p className="text-xs font-bold text-navy">Marking Complete</p>
                  <p className="text-[10px] text-text-muted">28 papers in 2m 14s</p>
                </div>
              </div>
            </div>
          </motion.div>
        </div>
      </section>

      {/* Marquee Strip */}
      <div className="bg-navy-mid py-6 overflow-hidden border-y border-white/5">
        <div className="flex whitespace-nowrap animate-[marquee_28s_linear_infinite]">
          {Array(10).fill(0).map((_, i) => (
            <div key={i} className="flex items-center gap-8 mx-8">
              <span className="text-white/40 text-sm font-bold uppercase tracking-[0.2em]">Cambridge IGCSE</span>
              <div className="w-1.5 h-1.5 rounded-full bg-accent"></div>
              <span className="text-white/40 text-sm font-bold uppercase tracking-[0.2em]">IB Diploma</span>
              <div className="w-1.5 h-1.5 rounded-full bg-accent"></div>
              <span className="text-white/40 text-sm font-bold uppercase tracking-[0.2em]">AQA A-Level</span>
              <div className="w-1.5 h-1.5 rounded-full bg-accent"></div>
              <span className="text-white/40 text-sm font-bold uppercase tracking-[0.2em]">Edexcel GCSE</span>
              <div className="w-1.5 h-1.5 rounded-full bg-accent"></div>
            </div>
          ))}
        </div>
      </div>

      {/* How it works */}
      <section id="how-it-works" className="py-32 bg-white border-t border-border">
        <div className="max-w-7xl mx-auto px-6">
          <div className="text-center mb-20">
            <span className="badge bg-accent-pale text-accent mb-4">The Process</span>
            <h2 className="text-4xl md:text-5xl text-navy mb-6">Simple, fast, and <br/>examiner-accurate</h2>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {[
              { step: '01', title: 'Upload Papers', desc: 'Scan and upload your students\' handwritten or digital papers in bulk.' },
              { step: '02', title: 'Define Scheme', desc: 'Provide your mark scheme and let our AI learn your specific grading nuances.' },
              { step: '03', title: 'Review & Release', desc: 'Verify the AI marks, add personal feedback, and release results instantly.' }
            ].map((s, i) => (
              <div key={s.step} className="relative">
                <div className="card h-full flex flex-col items-start group hover:border-accent/30">
                  <div className="text-5xl font-serif font-bold text-navy/10 mb-6 transition-colors group-hover:text-accent/20">{s.step}</div>
                  <h3 className="text-xl font-serif font-bold text-navy mb-4">{s.title}</h3>
                  <p className="text-text-mid text-sm leading-relaxed">{s.desc}</p>
                </div>
                {i < 2 && (
                  <div className="hidden md:flex absolute -right-4 top-1/2 -translate-y-1/2 z-20 w-8 h-8 rounded-full bg-white border border-border items-center justify-center text-accent shadow-sm">
                    <ArrowRight size={16} />
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section id="features" className="py-32 bg-white">
        <div className="max-w-7xl mx-auto px-6">
          <div className="text-center mb-20">
            <span className="badge bg-accent-pale text-accent mb-4">What we do</span>
            <h2 className="text-4xl md:text-5xl text-navy mb-6">Everything you need to <br/>scale your marking</h2>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {[
              { title: 'AI-Powered Marking', desc: 'Claude 3.5 Sonnet applies your mark scheme with human-level nuance and strict adherence.' },
              { title: 'Class Analytics', desc: 'Identify knowledge gaps instantly with automated topic heatmaps and grade distribution charts.' },
              { title: 'Per-Student Reports', desc: 'Every student receives a personalized PDF report with strengths, weaknesses, and revision tips.' },
              { title: 'Handwriting Recognition', desc: 'Advanced OCR technology handles scanned handwritten papers with industry-leading accuracy.' },
              { title: 'Lecturer Review', desc: 'Full control to override AI marks, add personal notes, and approve results before release.' },
              { title: 'Privacy-First', desc: 'Enterprise-grade security ensuring student data is encrypted and never used for training.' }
            ].map((f) => (
              <div key={f.title} className="card border-b-4 border-b-accent">
                <h3 className="text-xl font-serif font-bold text-navy mb-4">{f.title}</h3>
                <p className="text-text-mid text-sm leading-relaxed">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Who it is for */}
      <section id="who-it-is-for" className="py-32 bg-bg">
        <div className="max-w-7xl mx-auto px-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {[
              { role: 'Students', color: 'accent', items: ['Instant feedback on practice papers', 'Personalized revision roadmaps', 'Identify weak topics automatically', 'Track progress over time'] },
              { role: 'Lecturers', color: 'gold', items: ['Save 15+ hours per exam cycle', 'Automated data entry & analytics', 'Focus on teaching, not grading', 'Consistent marking standards'] },
              { role: 'Schools', color: 'navy', items: ['Standardize marking across departments', 'School-wide performance monitoring', 'Reduce teacher burnout & turnover', 'Data-driven intervention planning'] }
            ].map((p) => (
              <div key={p.role} className="card p-0 overflow-hidden">
                <div className={cn(
                  "h-2",
                  p.color === 'navy' && "bg-navy",
                  p.color === 'accent' && "bg-accent",
                  p.color === 'gold' && "bg-gold",
                  p.color === 'red' && "bg-red"
                )}></div>
                <div className="p-8">
                  <h3 className="text-2xl font-serif font-bold text-navy mb-8">{p.role}</h3>
                  <ul className="space-y-4">
                    {p.items.map(item => (
                      <li key={item} className="flex items-center gap-3 text-sm text-text-mid">
                        <div className="w-5 h-5 rounded-full bg-accent-pale flex items-center justify-center text-accent">
                          <CheckCircle2 size={14} />
                        </div>
                        {item}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Testimonials */}
      <section id="testimonials" className="py-32 bg-white">
        <div className="max-w-7xl mx-auto px-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {testimonials.map((t, i) => (
              <div key={i} className="card flex flex-col justify-between">
                <div>
                  <div className="flex gap-1 text-gold mb-6">
                    {Array(5).fill(0).map((_, j) => <Star key={j} size={16} fill="currentColor" />)}
                  </div>
                  <p className="text-navy font-serif italic text-lg mb-8 leading-relaxed">"{t.quote}"</p>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-full bg-navy flex items-center justify-center text-white font-bold">
                      {t.name.split(' ').map(n => n[0]).join('')}
                    </div>
                    <div>
                      <h4 className="text-sm font-bold text-navy">{t.name}</h4>
                      <p className="text-xs text-text-muted">{t.role}, {t.inst}</p>
                    </div>
                  </div>
                  {user && t.userEmail === user.email && (
                    <Link to="/settings?tab=feedback" className="text-xs text-accent font-bold hover:underline">Edit</Link>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-32 bg-bg">
        <div className="max-w-7xl mx-auto px-6">
          <div className="bg-navy rounded-[32px] p-12 md:p-20 text-center relative overflow-hidden">
            <div className="absolute inset-0 opacity-10 pointer-events-none" 
              style={{ backgroundImage: 'radial-gradient(circle at 2px 2px, white 1px, transparent 0)', backgroundSize: '30px 30px' }}>
            </div>
            <h2 className="text-white text-4xl md:text-5xl mb-8 relative z-10">Ready to mark papers?</h2>
            <div className="flex flex-wrap justify-center gap-4 relative z-10">
              <Link to={dashboardPath} className="btn-accent">
                {user ? 'Go to Dashboard' : 'Get started for free'}
              </Link>
            </div>
            <p className="text-white/40 text-xs mt-8 uppercase tracking-widest relative z-10">Trusted by 500+ institutions worldwide</p>
          </div>
        </div>
      </section>

      <Footer />
    </div>
  );
};

export default LandingPage;
