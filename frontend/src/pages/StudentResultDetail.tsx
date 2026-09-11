import React, { useState } from 'react';
import { DashboardLayout } from '@/src/components/DashboardLayout';
import { 
  ArrowLeft, Download, CheckCircle2, TrendingUp, 
  Award, Sparkles, BookOpen, AlertCircle, Loader2, 
  ChevronRight, MessageSquare, Users, ShieldCheck,
  UserCheck, Cpu, History, ChevronDown
} from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { motion } from 'motion/react';
import { useQuery } from '@tanstack/react-query';
import { cn } from '@/src/lib/utils';
import { safeGetItem } from '../lib/storage';
import { apiFetch } from '../lib/api';

const StudentResultDetail = () => {
  const { id } = useParams();
  const resultId = id;
  const [showAuditTrail, setShowAuditTrail] = useState(false);
  const [auditTrail, setAuditTrail] = useState<any[]>([]);
  const [loadingAudit, setLoadingAudit] = useState(false);

  const loadAuditTrail = async () => {
    if (!resultId) return;
    setLoadingAudit(true);
    try {
      const res = await apiFetch(`/api/results/${resultId}/audit`);
      const data = await res.json();
      setAuditTrail(Array.isArray(data) ? data : []);
      setShowAuditTrail(true);
    } catch (err) {
      console.error('Failed to load audit trail:', err);
    } finally {
      setLoadingAudit(false);
    }
  };

  const getChangeBadge = (q: any) => {
    if (!q.lastChangedByRole) return null;

    const config = {
      MODERATOR: {
        bg: 'bg-purple-50 border-purple-200',
        text: 'text-purple-700',
        icon: ShieldCheck,
        label: 'Moderator'
      },
      LECTURER: {
        bg: 'bg-blue-50 border-blue-200',
        text: 'text-blue-700',
        icon: UserCheck,
        label: 'Lecturer'
      },
      AI: {
        bg: 'bg-slate-50 border-slate-200',
        text: 'text-slate-600',
        icon: Cpu,
        label: 'AI'
      }
    };

    const c = config[q.lastChangedByRole as keyof typeof config];
    if (!c) return null;
    const Icon = c.icon;

    return (
      <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs font-medium ${c.bg} ${c.text}`}>
        <Icon size={11} />
        Updated by {q.lastChangedByName || c.label}
        <span className="opacity-60">·</span>
        <span className="opacity-60">
          {q.lastChangedAt ? new Date(q.lastChangedAt).toLocaleDateString('en-GB', {
            day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'
          }) : ''}
        </span>
      </div>
    );
  };

  // Queries
  const { data: result, isLoading, isError } = useQuery({
    queryKey: ['studentResultDetail', id],
    queryFn: () => apiFetch(`/api/results/${id}`).then(res => {
      if (!res.ok) throw new Error('Failed to load result details');
      return res.json();
    })
  });

  if (isLoading) return (
    <DashboardLayout>
      <div className="h-full flex items-center justify-center py-20">
        <Loader2 className="animate-spin text-accent" size={48} />
      </div>
    </DashboardLayout>
  );

  if (isError || (!isLoading && !result)) return (
    <DashboardLayout>
      <div className="card p-12 text-center max-w-lg mx-auto mt-10">
        <AlertCircle size={48} className="text-red-500 mx-auto mb-4" />
        <h2 className="text-2xl font-serif font-bold text-navy mb-2">Result Not Found</h2>
        <p className="text-text-muted mb-6">The assessment result you are looking for is unavailable or still processing.</p>
        <Link to="/progress" className="btn-primary">Back to Progress</Link>
      </div>
    </DashboardLayout>
  );

  return (
    <DashboardLayout>
      <div className="mb-10">
        <Link to="/dashboard" className="btn-ghost text-xs flex items-center gap-2 mb-6">
          <ArrowLeft size={16} /> Back to Dashboard
        </Link>
        
        <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-6">
          <div className="space-y-4">
             <h1 className="text-3xl font-serif font-bold text-navy">{result?.session?.subject}</h1>
             <div className="flex gap-4 text-[10px] font-bold text-text-muted uppercase tracking-widest">
                <span>{result?.session?.courseId}</span>
                <span>•</span>
                <span>{result?.session?.examBoard}</span>
                <span>•</span>
                <span>{result?.session?.sessionType}</span>
             </div>
          </div>
          <button className="btn-primary flex items-center gap-2 text-xs">
            <Download size={14} /> Download PDF Report
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-8 mb-12">
         {/* Score Hero */}
         <div className="lg:col-span-1 card bg-navy text-white p-8 relative overflow-hidden flex flex-col justify-center items-center text-center">
            <div className="absolute top-0 right-0 w-32 h-32 bg-accent/20 rounded-full blur-3xl -mr-16 -mt-16" />
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] opacity-60 mb-4">Your Grade</p>
            <div className="w-24 h-24 rounded-full border-4 border-accent flex items-center justify-center mb-4">
               <span className="text-4xl font-serif font-bold text-accent">{result?.grade}</span>
            </div>
            <p className="text-3xl font-serif font-bold">{Math.round(result?.percentage)}%</p>
            <p className="text-sm opacity-60 mt-1">{result?.totalMarks} / {result?.maxMarks} Marks</p>
         </div>

         {/* AI Feedback Summary */}
         <div className="lg:col-span-3 card p-8 border-2 border-accent/10 relative overflow-hidden">
            <div className="flex items-center gap-3 mb-6">
               <div className="w-10 h-10 rounded-xl bg-accent-pale text-accent flex items-center justify-center">
                  <Sparkles size={20} />
               </div>
               <h2 className="text-xl font-serif font-bold text-navy">AI Feedback & Best Performance</h2>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
               <div className="space-y-4">
                  <p className="text-sm text-navy leading-relaxed italic">
                     "You showed exceptionally strong understanding of <strong>{result?.questions?.find((q:any) => q.status === 'CORRECT')?.topic || 'core concepts'}</strong>. Your explanations were clear and aligned well with the mark scheme."
                  </p>
                  <div className="flex items-center gap-2 text-accent">
                     <TrendingUp size={16} />
                     <span className="text-xs font-bold uppercase tracking-widest">Strength Identified</span>
                  </div>
               </div>
               <div className="space-y-4">
                  <div className="p-4 bg-bg rounded-xl border border-border">
                     <div className="flex items-center gap-2 mb-2">
                        <Award size={14} className="text-gold" />
                        <span className="text-[10px] font-bold text-navy uppercase tracking-widest">Top Topic</span>
                     </div>
                     <p className="text-sm font-bold text-navy">{result?.questions?.[0]?.topic}</p>
                     <p className="text-xs text-text-muted mt-1">100% Accuracy</p>
                  </div>
               </div>
            </div>
         </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
         {/* Detailed Breakdown */}
         <div className="lg:col-span-2 space-y-6">
            <h2 className="text-xl font-serif font-bold text-navy">Question Breakdown</h2>
            <div className="space-y-4">
               {result?.questions?.map((q: any) => (
                  <motion.div 
                     key={q.id}
                     initial={{ opacity: 0, y: 10 }}
                     animate={{ opacity: 1, y: 0 }}
                     className="card p-6 hover:shadow-lg transition-all border-l-4"
                     style={{ borderLeftColor: q.status === 'CORRECT' ? '#2ECC9A' : q.status === 'PARTIAL' ? '#F2C94C' : '#FF4D4D' }}
                  >
                     <div className="flex justify-between items-start mb-4">
                        <div>
                           <p className="text-[10px] font-bold text-text-muted uppercase tracking-widest">Question {q.questionNumber}</p>
                           <h3 className="text-lg font-bold text-navy mt-1">{q.topic}</h3>
                        </div>
                        <div className="text-right space-y-1">
                           <div className="flex items-center justify-end gap-2">
                              <p className="text-sm font-bold text-navy">
                                 {q.lecturerOverride ?? q.marksAwarded} / {q.marksAvailable}
                              </p>
                              <span className={cn(
                                 "text-[10px] font-bold uppercase",
                                 q.status === 'CORRECT' ? "text-green-600" : q.status === 'PARTIAL' ? "text-gold" : "text-red-500"
                              )}>
                                 {q.status}
                              </span>
                           </div>

                           {/* Show change badge if mark was modified */}
                           {q.lastChangedByRole && q.lastChangedByRole !== 'AI' && (
                              <div className="flex items-center justify-end gap-2 mt-1">
                                 {getChangeBadge(q)}
                                 {/* Show original AI mark for comparison */}
                                 {q.originalAiMark !== null && q.originalAiMark !== undefined && q.originalAiMark !== (q.lecturerOverride ?? q.marksAwarded) && (
                                    <span className="text-xs text-slate-400 line-through">
                                       AI: {q.originalAiMark}
                                    </span>
                                 )}
                              </div>
                           )}
                        </div>
                     </div>

                     <div className="space-y-4">
                        <div className="bg-bg/50 p-4 rounded-xl border border-border">
                           <div className="flex items-center gap-2 mb-2 opacity-40">
                              <MessageSquare size={12} />
                              <span className="text-[10px] font-bold uppercase tracking-widest">AI Feedback</span>
                           </div>
                           <p className="text-sm text-navy leading-relaxed">{q.aiFeedback}</p>
                        </div>

                        {(q.lostMarksReason || q.improvementSuggestion) && (
                           <div className="p-4 bg-red-50/30 rounded-xl border border-red-100">
                              <div className="flex items-center gap-2 mb-2 text-red-500">
                                 <AlertCircle size={12} />
                                 <span className="text-[10px] font-bold uppercase tracking-widest">How to Improve</span>
                              </div>
                              <p className="text-xs text-navy font-medium mb-2">{q.lostMarksReason}</p>
                              <p className="text-xs text-text-muted italic">Suggestion: {q.improvementSuggestion}</p>
                           </div>
                        )}

                        {q.lecturerNote && (
                           <div className="p-4 bg-navy/5 rounded-xl border border-navy/10">
                              <div className="flex items-center gap-2 mb-2 text-navy">
                                 <Users size={12} />
                                 <span className="text-[10px] font-bold uppercase tracking-widest">Lecturer Note</span>
                              </div>
                              <p className="text-xs text-navy italic">"{q.lecturerNote}"</p>
                           </div>
                        )}
                     </div>
                  </motion.div>
               ))}
            </div>

            {/* Full Audit History Panel */}
            <div className="border border-slate-200 bg-white rounded-2xl mt-6 shadow-sm overflow-hidden">
              <button
                onClick={showAuditTrail ? () => setShowAuditTrail(false) : loadAuditTrail}
                className="w-full px-6 py-4 flex items-center justify-between text-sm font-medium text-slate-600 hover:bg-slate-50 transition-colors"
              >
                <div className="flex items-center gap-2 font-semibold text-navy">
                  <History size={15} />
                  Mark Change History
                </div>
                <div className="flex items-center gap-2">
                  {loadingAudit && <Loader2 size={14} className="animate-spin text-navy" />}
                  <ChevronDown
                    size={15}
                    className={`transition-transform duration-200 ${showAuditTrail ? 'rotate-180' : ''}`}
                  />
                </div>
              </button>

              {showAuditTrail && (
                <div className="px-6 pb-6 space-y-3 pt-2 border-t border-slate-100">
                  {auditTrail.length === 0 ? (
                    <p className="text-xs text-slate-400 text-center py-4">
                      No mark changes recorded — all marks are original AI marks.
                    </p>
                  ) : (
                    auditTrail.map((entry, idx) => (
                      <div key={entry.id} className="flex items-start gap-3">
                        {/* Timeline dot */}
                        <div className="flex flex-col items-center">
                          <div className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 ${
                            entry.changedByRole === 'MODERATOR'
                              ? 'bg-purple-100'
                              : 'bg-blue-100'
                          }`}>
                            {entry.changedByRole === 'MODERATOR'
                              ? <ShieldCheck size={13} className="text-purple-600" />
                              : <UserCheck size={13} className="text-blue-600" />
                            }
                          </div>
                          {idx < auditTrail.length - 1 && (
                            <div className="w-0.5 h-6 bg-slate-100 mt-1" />
                          )}
                        </div>

                        {/* Entry detail */}
                        <div className="flex-1 min-w-0 pb-2">
                          <div className="flex items-center justify-between">
                            <p className="text-sm font-semibold text-navy">
                              {entry.changedByName}
                              <span className={`ml-2 text-xs font-normal px-2 py-0.5 rounded-full ${
                                entry.changedByRole === 'MODERATOR'
                                  ? 'bg-purple-100 text-purple-600'
                                  : 'bg-blue-100 text-blue-600'
                              }`}>
                                {entry.changedByRole === 'MODERATOR' ? 'Moderator' : 'Lecturer'}
                              </span>
                            </p>
                            <p className="text-xs text-slate-400">
                              {new Date(entry.createdAt).toLocaleString('en-GB', {
                                day: 'numeric', month: 'short',
                                hour: '2-digit', minute: '2-digit'
                              })}
                            </p>
                          </div>

                          <p className="text-xs text-slate-500 mt-1">
                            Changed <span className="font-semibold text-slate-700">
                              Question {entry.questionNumber}
                            </span> from{' '}
                            <span className="font-semibold text-red-500 line-through">
                              {entry.previousMark}
                            </span>
                            {' '}to{' '}
                            <span className="font-semibold text-green-600">
                              {entry.newMark}
                            </span>
                            /{entry.marksAvailable}
                          </p>

                          {entry.reason && (
                            <p className="text-xs text-slate-400 mt-1 italic">
                              "{entry.reason}"
                            </p>
                          )}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
         </div>

         {/* Learning Paths */}
         <div className="space-y-6">
            <div className="flex items-center gap-2">
               <div className="w-10 h-10 rounded-xl bg-gold/10 text-gold flex items-center justify-center">
                  <BookOpen size={20} />
               </div>
               <h2 className="text-xl font-serif font-bold text-navy">Revision Path</h2>
            </div>

            <div className="card p-8 space-y-8">
               <div className="space-y-4">
                  <p className="text-xs font-bold text-text-muted uppercase tracking-widest">Focus Areas</p>
                  {result?.questions?.filter((q:any) => q.status !== 'CORRECT').map((q:any, i:number) => (
                     <div key={i} className="flex gap-4 group cursor-pointer">
                        <div className="shrink-0 w-8 h-8 rounded-lg bg-bg flex items-center justify-center group-hover:bg-accent group-hover:text-white transition-all">
                           <ChevronRight size={14} />
                        </div>
                        <div>
                           <p className="text-sm font-bold text-navy group-hover:text-accent transition-colors">{q.topic}</p>
                           <p className="text-[10px] text-text-muted mt-0.5">Review marking criteria for Q{q.questionNumber}</p>
                        </div>
                     </div>
                  ))}
               </div>

               <div className="pt-8 border-t border-border">
                  <button className="btn-accent w-full flex items-center justify-center gap-2">
                     <Sparkles size={16} fill="currentColor" /> Generate Practice Questions
                  </button>
               </div>
            </div>

            <div className="card p-6 bg-accent text-white text-xs space-y-2">
               <p className="font-bold uppercase tracking-[0.2em] opacity-60">Personal AI Coach</p>
               <p className="leading-relaxed">
                  I've noticed you often lose marks on "Explain" style questions. Try using the PEE (Point, Evidence, Explanation) structure next time!
               </p>
            </div>
         </div>
      </div>
    </DashboardLayout>
  );
};

export default StudentResultDetail;
