import React, { useState } from 'react';
import { DashboardLayout } from '@/src/components/DashboardLayout';
import { ArrowLeft, Download, CheckCircle2, AlertCircle, HelpCircle } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '@/src/lib/utils';
import { useAuth } from '@/src/context/AuthContext';
import { StudentBadge } from '@/src/components/StudentBadge';

const StudentPaperView = () => {
  const { id } = useParams();
  const [activeTab, setActiveTab] = useState<'breakdown' | 'feedback'>('breakdown');
  const [toast, setToast] = useState<string | null>(null);
  const { user } = useAuth();

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  const paperData = {
    subject: 'Biology',
    board: 'IB Diploma',
    score: 74,
    max: 80,
    grade: 'A*',
    date: 'Mar 28, 2026',
    overallFeedback: "Fatima, this is an exceptional performance. Your understanding of complex biological systems, particularly in cell respiration and genetics, is at a very high level. You've applied the mark scheme criteria precisely in most sections. The few marks lost were due to slightly incomplete explanations in the photosynthesis multi-part question. Focus on ensuring every command term in the question is addressed in your response.",
    strengths: ['Cell Respiration', 'Genetics', 'Data Analysis', 'Precision in Terminology'],
    weaknesses: ['Photosynthesis Depth', 'Time Management (Q4)'],
    suggestions: [
      'Review the light-independent reactions of photosynthesis.',
      'Practice 10-mark essay questions to improve structural flow.',
      'Ensure all diagrams are fully labeled with appropriate units.'
    ],
    questions: [
      { no: '1a', topic: 'Cell Respiration', awarded: 4, available: 4, status: 'full', feedback: 'Perfect identification of ATP yield.' },
      { no: '1b', topic: 'Cell Respiration', awarded: 6, available: 6, status: 'full', feedback: 'Detailed explanation of the Krebs cycle.' },
      { no: '2a', topic: 'Photosynthesis', awarded: 3, available: 5, status: 'partial', feedback: 'Missing the role of NADP in the final stage.' },
      { no: '2b', topic: 'Photosynthesis', awarded: 5, available: 7, status: 'partial', feedback: 'Graph interpretation was correct but lacked specific data points.' },
      { no: '3', topic: 'Genetics', awarded: 15, available: 15, status: 'full', feedback: 'Flawless Punnett square and probability calculation.' }
    ]
  };

  const handleDownload = () => {
    showToast('Downloading your personalized performance report...');
  };

  return (
    <DashboardLayout>
      <div className="mb-8">
        <Link to="/dashboard" className="inline-flex items-center gap-2 text-text-muted hover:text-navy transition-colors mb-6 text-sm font-medium">
          <ArrowLeft size={16} /> Back to Dashboard
        </Link>
        
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <h1 className="text-3xl text-navy">{paperData.subject}</h1>
              <span className="badge bg-accent-pale text-accent">{paperData.grade}</span>
            </div>
            <div className="flex items-center gap-3 text-text-muted text-sm">
              <StudentBadge name={user?.name || 'Student'} studentCode={user?.studentCode} />
              <span>•</span>
              <span>{paperData.board}</span>
              <span>•</span>
              <span>Marked on {paperData.date}</span>
            </div>
          </div>
          
          <div className="flex items-center gap-6">
            <div className="text-right">
              <p className="text-text-muted text-[10px] font-bold uppercase tracking-widest mb-1">Total Score</p>
              <p className="text-4xl font-serif font-bold text-navy">{paperData.score}<span className="text-text-muted text-xl">/{paperData.max}</span></p>
            </div>
            <button onClick={handleDownload} className="btn-primary flex items-center gap-2">
              <Download size={18} /> Report
            </button>
          </div>
        </div>
      </div>

      <div className="flex border-b border-border mb-8">
        <button 
          onClick={() => setActiveTab('breakdown')}
          className={cn(
            "px-6 py-4 text-sm font-bold transition-all border-b-2",
            activeTab === 'breakdown' ? "border-navy text-navy" : "border-transparent text-text-muted hover:text-text-mid"
          )}
        >
          Question Breakdown
        </button>
        <button 
          onClick={() => setActiveTab('feedback')}
          className={cn(
            "px-6 py-4 text-sm font-bold transition-all border-b-2",
            activeTab === 'feedback' ? "border-navy text-navy" : "border-transparent text-text-muted hover:text-text-mid"
          )}
        >
          AI Feedback
        </button>
      </div>

      {activeTab === 'breakdown' ? (
        <motion.div 
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="card p-0 overflow-hidden"
        >
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="bg-bg/50 text-text-muted text-[10px] font-bold uppercase tracking-[0.2em]">
                  <th className="px-8 py-4">No.</th>
                  <th className="px-8 py-4">Topic</th>
                  <th className="px-8 py-4">Marks</th>
                  <th className="px-8 py-4">Status</th>
                  <th className="px-8 py-4">AI Feedback</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {paperData.questions.map((q) => (
                  <tr key={q.no} className="hover:bg-bg/30 transition-colors">
                    <td className="px-8 py-5 font-bold text-navy">{q.no}</td>
                    <td className="px-8 py-5 text-text-mid text-sm">{q.topic}</td>
                    <td className="px-8 py-5 text-navy font-medium">{q.awarded}/{q.available}</td>
                    <td className="px-8 py-5">
                      {q.status === 'full' ? (
                        <div className="flex items-center gap-2 text-accent text-xs font-bold">
                          <CheckCircle2 size={14} /> Full
                        </div>
                      ) : q.status === 'partial' ? (
                        <div className="flex items-center gap-2 text-gold text-xs font-bold">
                          <HelpCircle size={14} /> Partial
                        </div>
                      ) : (
                        <div className="flex items-center gap-2 text-red text-xs font-bold">
                          <AlertCircle size={14} /> Zero
                        </div>
                      )}
                    </td>
                    <td className="px-8 py-5 text-text-mid text-sm italic">"{q.feedback}"</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </motion.div>
      ) : (
        <motion.div 
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="grid grid-cols-1 md:grid-cols-3 gap-8"
        >
          <div className="md:col-span-2 space-y-8">
            <div className="card">
              <h3 className="text-xl font-serif font-bold text-navy mb-4">Overall Performance</h3>
              <p className="text-text-mid leading-relaxed">{paperData.overallFeedback}</p>
            </div>
            
            <div className="card">
              <h3 className="text-xl font-serif font-bold text-navy mb-6">Revision Suggestions</h3>
              <div className="space-y-4">
                {paperData.suggestions.map((s, i) => (
                  <div key={i} className="flex gap-4">
                    <div className="w-6 h-6 rounded-full bg-navy text-white flex-shrink-0 flex items-center justify-center text-xs font-bold">
                      {i + 1}
                    </div>
                    <p className="text-text-mid text-sm leading-relaxed">{s}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
          
          <div className="space-y-8">
            <div className="card">
              <h3 className="text-sm font-bold text-navy uppercase tracking-widest mb-6">Key Strengths</h3>
              <div className="flex flex-wrap gap-2">
                {paperData.strengths.map(s => (
                  <span key={s} className="badge bg-accent-pale text-accent">{s}</span>
                ))}
              </div>
            </div>
            
            <div className="card">
              <h3 className="text-sm font-bold text-navy uppercase tracking-widest mb-6">Areas for Growth</h3>
              <div className="flex flex-wrap gap-2">
                {paperData.weaknesses.map(w => (
                  <span key={w} className="badge bg-red-pale text-red">{w}</span>
                ))}
              </div>
            </div>
          </div>
        </motion.div>
      )}

      <AnimatePresence>
        {toast && (
          <motion.div 
            initial={{ opacity: 0, y: 50 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 50 }}
            className="fixed bottom-8 right-8 z-[100] bg-navy text-white px-6 py-3 rounded-button shadow-2xl flex items-center gap-3 border border-white/10"
          >
            <CheckCircle2 size={18} className="text-accent" />
            <span className="text-sm font-medium">{toast}</span>
          </motion.div>
        )}
      </AnimatePresence>
    </DashboardLayout>
  );
};

export default StudentPaperView;
