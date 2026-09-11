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
            <div className="space-y-3">
              {result?.questions && [...result.questions]
                .sort((a: any, b: any) => {
                  // Sort by question number naturally: Q1(a)(i) before Q1(a)(ii) before Q1(b)(i)
                  return (a.questionNumber || '').localeCompare(b.questionNumber || '', undefined, { numeric: true });
                })
                .map((q: any, idx: number) => {

                  const markPercent = q.marksAvailable > 0
                    ? (q.marksAwarded / q.marksAvailable) * 100
                    : 0;

                  const statusColor =
                    markPercent === 100 ? 'border-green-200 bg-green-50' :
                    markPercent >= 50   ? 'border-amber-200 bg-amber-50' :
                                          'border-red-200 bg-red-50';

                  const markColor =
                    markPercent === 100 ? 'text-green-600 bg-green-100' :
                    markPercent >= 50   ? 'text-amber-600 bg-amber-100' :
                                          'text-red-600 bg-red-100';

                  return (
                    <div
                      key={q.id}
                      className={`rounded-xl border p-5 mb-3 ${statusColor}`}
                    >
                      {/* Question header row */}
                      <div className="flex items-start justify-between gap-4 mb-4">
                        <div className="flex items-start gap-3 flex-1 min-w-0">
                          {/* Question number badge */}
                          <div className="flex-shrink-0 w-10 h-10 bg-white border border-slate-200 rounded-xl flex items-center justify-center">
                            <span className="text-xs font-bold text-navy leading-tight text-center">
                              {q.questionNumber}
                            </span>
                          </div>

                          <div className="flex-1 min-w-0">
                            {/* Topic tag */}
                            <span className="inline-block text-xs font-medium text-slate-400 bg-white/70 px-2.5 py-0.5 rounded-full border border-slate-200 mb-2">
                              {q.topic}
                            </span>

                            {/* ACTUAL QUESTION TEXT */}
                            <p className="text-sm font-semibold text-navy leading-relaxed">
                              {q.questionText || 'Question text not available'}
                            </p>
                          </div>
                        </div>

                        {/* Mark badge */}
                        <div className={`flex-shrink-0 px-3 py-1.5 rounded-xl text-sm font-bold ${markColor}`}>
                          {q.lecturerOverride ?? q.marksAwarded}/{q.marksAvailable}
                          {q.lecturerOverride !== null && q.lecturerOverride !== undefined && (
                            <span className="text-xs font-normal ml-1 opacity-70">*</span>
                          )}
                        </div>
                      </div>

                      {/* Student Answer */}
                      <div className="bg-white/80 rounded-xl p-4 mb-3 border border-white">
                        <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2 flex items-center gap-1.5">
                          <span className="w-4 h-4 bg-navy/10 rounded-full flex items-center justify-center text-navy text-[9px]">S</span>
                          Student's Answer
                        </p>
                        <p className="text-sm text-slate-700 leading-relaxed whitespace-pre-line">
                          {q.studentAnswer && q.studentAnswer.trim().length > 0
                            ? q.studentAnswer
                            : <span className="text-slate-400 italic">No answer provided</span>
                          }
                        </p>
                      </div>

                      {/* Expected Answer (collapsible) */}
                      {q.expectedAnswer && (
                        <details className="bg-white/60 rounded-xl border border-white mb-3">
                          <summary className="px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wide cursor-pointer list-none flex items-center gap-1.5 hover:text-navy">
                            <span className="w-4 h-4 bg-green-100 rounded-full flex items-center justify-center text-green-600 text-[9px]">✓</span>
                            Expected Answer / Mark Scheme
                            <span className="ml-auto text-slate-300">▼</span>
                          </summary>
                          <div className="px-4 pb-3">
                            <p className="text-sm text-slate-600 leading-relaxed whitespace-pre-line">
                              {q.expectedAnswer}
                            </p>
                          </div>
                        </details>
                      )}

                      {/* AI Feedback */}
                      <div className="bg-white/60 rounded-xl p-4 border border-white">
                        <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2 flex items-center gap-1.5">
                          <span className="w-4 h-4 bg-accent/20 rounded-full flex items-center justify-center text-accent text-[9px]">AI</span>
                          AI Feedback
                        </p>
                        <p className="text-sm text-slate-600 leading-relaxed">
                          {q.aiFeedback || 'No feedback available'}
                        </p>

                        {/* Lost marks reason */}
                        {q.lostMarksReason && (
                          <div className="mt-3 pt-3 border-t border-slate-100">
                            <p className="text-xs font-semibold text-red-500 mb-1">Why marks were lost:</p>
                            <p className="text-xs text-red-600 leading-relaxed">{q.lostMarksReason}</p>
                          </div>
                        )}

                        {/* Improvement suggestion */}
                        {q.improvementSuggestion && (
                          <div className="mt-3 pt-3 border-t border-slate-100">
                            <p className="text-xs font-semibold text-blue-500 mb-1">How to improve:</p>
                            <p className="text-xs text-blue-600 leading-relaxed">{q.improvementSuggestion}</p>
                          </div>
                        )}
                      </div>

                      {/* Lecturer override note */}
                      {q.lecturerNote && (
                        <div className="mt-3 bg-navy/5 rounded-xl px-4 py-3 border border-navy/10">
                          <p className="text-xs font-semibold text-navy mb-1 flex items-center gap-1.5">
                            <UserCheck size={11} />
                            Lecturer Note
                          </p>
                          <p className="text-xs text-navy/70">{q.lecturerNote}</p>
                        </div>
                      )}

                      {/* Mark change audit badge */}
                      {q.lastChangedByName && q.lastChangedByRole !== 'AI' && (
                        <div className="mt-2 flex items-center gap-1.5">
                          <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${
                            q.lastChangedByRole === 'MODERATOR'
                              ? 'bg-purple-100 text-purple-600'
                              : 'bg-blue-100 text-blue-600'
                          }`}>
                            ✎ Overridden by {q.lastChangedByName} ({q.lastChangedByRole})
                          </span>
                        </div>
                      )}
                    </div>
                  );
                })}
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
