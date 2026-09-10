import React from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Navbar, Footer } from '@/src/components/Layout';
import { ArrowLeft, Check, Sparkles, HelpCircle } from 'lucide-react';

export default function PricingPage() {
  const navigate = useNavigate();

  const plans = [
    {
      name: 'Starter Educator',
      price: '$0',
      period: 'Forever free',
      description: 'Ideal for individual teachers and tutors grading small batches.',
      features: [
        'Up to 50 student papers / month',
        'Gemini Vision handwriting extraction',
        'Standard rubric breakdown',
        'Basic grade distribution analytics',
        'PDF export for student results',
        'Community support'
      ],
      cta: 'Get Started Free',
      highlighted: false
    },
    {
      name: 'Department Pro',
      price: '$49',
      period: 'per month per faculty',
      description: 'Built for university departments, high schools, and multi-course lecturers.',
      features: [
        'Up to 2,000 papers / month',
        'Priority multi-key rotation engine',
        'Sub-question custom moderation',
        'Cohort radar analytics & learning curves',
        'Batch ZIP script import & CSV export',
        'Class student enrollment sync',
        'Email & live chat priority support'
      ],
      cta: 'Start 14-Day Trial',
      highlighted: true
    },
    {
      name: 'Institution Enterprise',
      price: 'Custom',
      period: 'annual licensing',
      description: 'For university-wide deployment with custom compliance and LMS sync.',
      features: [
        'Unlimited exam papers & students',
        'Canvas, Moodle, Blackboard LMS integration',
        'Dedicated API key infrastructure',
        'Custom fine-tuned scoring rubrics',
        'FERPA, GDPR, and custom institutional SLA',
        'Single Sign-On (SSO / SAML)',
        'Dedicated pedagogical account manager'
      ],
      cta: 'Contact Admissions',
      highlighted: false
    }
  ];

  const faqs = [
    {
      q: 'Can I start using MarkAI without a credit card?',
      a: 'Yes! The Starter Educator plan is 100% free with no credit card required. You can immediately create an account, upload a question paper and mark scheme, and grade up to 50 scripts.'
    },
    {
      q: 'How does MarkAI handle illegible handwriting or complex diagrams?',
      a: 'Our vision pipeline directly analyzes image layout without stripping spatial relations. If a student response is ambiguous or illegible, MarkAI marks it for lecturer review so no student is penalized unfairly.'
    },
    {
      q: 'Can we use our own Gemini or OpenAI API keys?',
      a: 'Yes, Enterprise and Department Pro customers can connect their institutional Google Cloud or OpenAI API keys to seamlessly take advantage of their own volume quotas.'
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
            <Sparkles size={14} /> Transparent Pricing
          </div>
          <h1 className="text-4xl md:text-5xl font-serif font-bold text-navy leading-tight">
            Plans Calibrated for Every Educator
          </h1>
          <p className="text-slate-600 text-lg leading-relaxed">
            Choose a plan that fits your classroom size, department volume, or institutional assessment needs.
          </p>
        </div>

        {/* Pricing Cards */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 mb-20">
          {plans.map((plan, i) => (
            <div 
              key={i} 
              className={`card p-8 bg-white border flex flex-col justify-between relative ${
                plan.highlighted ? 'border-accent shadow-xl ring-2 ring-accent/20' : 'border-border'
              }`}
            >
              {plan.highlighted && (
                <div className="absolute -top-3.5 left-1/2 -translate-x-1/2 bg-accent text-white text-[10px] font-bold uppercase tracking-widest px-3 py-1 rounded-full">
                  Most Popular
                </div>
              )}
              <div>
                <h3 className="text-xl font-serif font-bold text-navy mb-2">{plan.name}</h3>
                <p className="text-xs text-slate-500 mb-6">{plan.description}</p>
                <div className="flex items-baseline gap-2 mb-6">
                  <span className="text-4xl font-serif font-bold text-navy">{plan.price}</span>
                  <span className="text-xs text-slate-500">{plan.period}</span>
                </div>
                <div className="space-y-3 border-t border-border pt-6 mb-8">
                  {plan.features.map((feat, idx) => (
                    <div key={idx} className="flex items-center gap-2.5 text-xs text-slate-700">
                      <Check size={14} className="text-accent shrink-0" />
                      <span>{feat}</span>
                    </div>
                  ))}
                </div>
              </div>
              <Link 
                to="/register" 
                className={`w-full py-3 rounded-xl font-medium text-center text-sm transition-colors ${
                  plan.highlighted 
                    ? 'bg-accent text-white hover:bg-accent/90 shadow-md' 
                    : 'bg-bg text-navy hover:bg-navy hover:text-white border border-border'
                }`}
              >
                {plan.cta}
              </Link>
            </div>
          ))}
        </div>

        {/* FAQ Section */}
        <div className="card p-10 md:p-14 bg-white border border-border space-y-8 mb-16">
          <div className="text-center space-y-2">
            <h2 className="text-2xl md:text-3xl font-serif font-bold text-navy">Frequently Asked Questions</h2>
            <p className="text-sm text-slate-500">Everything you need to know about our billing and policies</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 pt-4">
            {faqs.map((faq, i) => (
              <div key={i} className="space-y-2 p-5 rounded-xl bg-bg border border-border">
                <h4 className="font-serif font-bold text-navy text-sm">{faq.q}</h4>
                <p className="text-xs text-slate-600 leading-relaxed">{faq.a}</p>
              </div>
            ))}
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
}
