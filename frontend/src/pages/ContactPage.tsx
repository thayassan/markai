import React, { useState } from 'react';
import { Navbar, Footer } from '../components/Layout';
import { Mail, MessageSquare, MapPin, Send, CheckCircle2 } from 'lucide-react';
import { motion } from 'framer-motion';

export default function ContactPage() {
  const [submitted, setSubmitted] = useState(false);
  const [formData, setFormData] = useState({ name: '', email: '', institution: '', message: '' });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
  };

  return (
    <div className="min-h-screen bg-bg flex flex-col justify-between">
      <Navbar />

      <main className="max-w-6xl mx-auto px-6 pt-32 pb-20 w-full">
        <div className="text-center max-w-2xl mx-auto mb-16">
          <span className="text-gold font-bold text-xs uppercase tracking-widest bg-gold-pale px-3 py-1 rounded">
            Get In Touch
          </span>
          <h1 className="text-4xl md:text-5xl font-serif font-bold text-navy mt-4 mb-4">
            Contact the MarkAI Team
          </h1>
          <p className="text-text-muted text-base leading-relaxed">
            Have questions about university rollouts, pilot programs, or technical integrations? We're here to help.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mb-16">
          <div className="card p-6 border border-border text-center">
            <div className="w-12 h-12 rounded-full bg-navy/5 text-navy flex items-center justify-center mx-auto mb-4">
              <Mail size={22} />
            </div>
            <h3 className="font-serif font-bold text-navy text-lg mb-1">Email Support</h3>
            <p className="text-xs text-text-muted mb-3">Reach out directly for general support</p>
            <a href="mailto:support@markai.demo" className="text-xs font-bold text-navy hover:underline">
              support@markai.demo
            </a>
          </div>

          <div className="card p-6 border border-border text-center">
            <div className="w-12 h-12 rounded-full bg-navy/5 text-navy flex items-center justify-center mx-auto mb-4">
              <MessageSquare size={22} />
            </div>
            <h3 className="font-serif font-bold text-navy text-lg mb-1">Institutional Partnerships</h3>
            <p className="text-xs text-text-muted mb-3">Enterprise and campus-wide licensing</p>
            <a href="mailto:partnerships@markai.demo" className="text-xs font-bold text-navy hover:underline">
              partnerships@markai.demo
            </a>
          </div>

          <div className="card p-6 border border-border text-center">
            <div className="w-12 h-12 rounded-full bg-navy/5 text-navy flex items-center justify-center mx-auto mb-4">
              <MapPin size={22} />
            </div>
            <h3 className="font-serif font-bold text-navy text-lg mb-1">Headquarters</h3>
            <p className="text-xs text-text-muted mb-3">MarkAI Global Academic Systems</p>
            <span className="text-xs font-bold text-navy">London & Singapore</span>
          </div>
        </div>

        {/* Form Card */}
        <div className="card max-w-2xl mx-auto p-8 border border-border bg-surface">
          {submitted ? (
            <div className="text-center py-10">
              <div className="w-12 h-12 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center mx-auto mb-4">
                <CheckCircle2 size={24} />
              </div>
              <h3 className="text-2xl font-serif font-bold text-navy mb-2">Message Received</h3>
              <p className="text-sm text-text-muted mb-6">
                Thank you for contacting MarkAI. An academic solutions specialist will follow up with you within one business day.
              </p>
              <button 
                onClick={() => { setSubmitted(false); setFormData({ name: '', email: '', institution: '', message: '' }); }}
                className="btn-primary text-xs"
              >
                Send Another Message
              </button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <h2 className="text-xl font-serif font-bold text-navy mb-2">Send us a message</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-navy mb-1 uppercase tracking-wider">Your Name</label>
                  <input 
                    type="text" 
                    required
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    className="input-field text-xs w-full"
                    placeholder="Prof. Alex Morgan"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-navy mb-1 uppercase tracking-wider">Email Address</label>
                  <input 
                    type="email" 
                    required
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    className="input-field text-xs w-full"
                    placeholder="alex.morgan@university.edu"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-navy mb-1 uppercase tracking-wider">Institution / University</label>
                <input 
                  type="text" 
                  value={formData.institution}
                  onChange={(e) => setFormData({ ...formData, institution: e.target.value })}
                  className="input-field text-xs w-full"
                  placeholder="e.g. Oxford University / Department of CS"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-navy mb-1 uppercase tracking-wider">Message</label>
                <textarea 
                  rows={4}
                  required
                  value={formData.message}
                  onChange={(e) => setFormData({ ...formData, message: e.target.value })}
                  className="input-field text-xs w-full p-3"
                  placeholder="Tell us about your assessment requirements, student cohort size, or specific questions..."
                />
              </div>

              <button type="submit" className="btn-primary text-xs w-full py-3 flex items-center justify-center gap-2">
                <Send size={14} /> Send Inquiry
              </button>
            </form>
          )}
        </div>
      </main>

      <Footer />
    </div>
  );
}
