import React, { useState, useMemo } from 'react';
import { DashboardLayout } from '@/src/components/DashboardLayout';
import { 
  ArrowLeft, Save, CheckCircle2, Download, AlertCircle, 
  HelpCircle, MoreVertical, Loader2, RefreshCcw, Sparkles,
  RefreshCw, AlertTriangle, CheckCircle, ShieldCheck,
  UserCheck, Cpu, History, ChevronDown
} from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { cn } from '@/src/lib/utils';
import { safeGetItem } from '../lib/storage';
import { apiFetch } from '../lib/api';

const LecturerResultDetail = () => {
  const { id: sessionId, studentId } = useParams();
  const queryClient = useQueryClient();
  const [overrides, setOverrides] = useState<Record<string, { mark: number; note: string }>>({});
  const [comparisonResult, setComparisonResult] = useState<any>(null);
  const [showAuditTrail, setShowAuditTrail] = useState(false);
  const [auditTrail, setAuditTrail] = useState<any[]>([]);
  const [loadingAudit, setLoadingAudit] = useState(false);

  // Queries
  const { data: result, isLoading, isError } = useQuery({
    queryKey: ['studentResult', sessionId, studentId],
    queryFn: () => apiFetch(`/api/results?sessionId=${sessionId}&studentId=${studentId}`).then(res => {
      if (!res.ok) throw new Error('Result not found or server error');
      return res.json();
    })
  });

  // Mutations
  const overrideMutation = useMutation({
    mutationFn: async ({ resultId, questionId, mark, note }: any) => {
      const res = await apiFetch(`/api/results/${resultId}/override`, {
        method: 'PATCH',
        body: JSON.stringify({ questionId, lecturerMark: mark, lecturerNote: note })
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['studentResult', sessionId, studentId] });
    }
  });

  const reEvaluateMutation = useMutation({
    mutationFn: async () => {
      setComparisonResult(null);
      const startRes = await apiFetch(`/api/results/${result?.id}/reevaluate`, { method: 'POST' });
      const startData = await startRes.json();

      if (!startRes.ok) {
        throw new Error(startData.error || 'Failed to start re-evaluation');
      }

      const { jobId } = startData;

      // Poll every 2 seconds, up to 90 seconds (45 attempts)
      for (let attempt = 0; attempt < 45; attempt++) {
        await new Promise(resolve => setTimeout(resolve, 2000));

        const statusRes = await apiFetch(`/api/upload/status/${jobId}`);
        const statusData = await statusRes.json();

        if (statusData.status === 'COMPLETE') {
          const comparison = JSON.parse(statusData.text || '{}');
          return { comparison };
        }

        if (statusData.status === 'ERROR') {
          throw new Error(statusData.error || 'Re-evaluation failed');
        }
      }

      throw new Error('Re-evaluation is taking longer than expected. Check back in a moment.');
    },
    onSuccess: (data) => {
      setComparisonResult(data.comparison);
      queryClient.invalidateQueries({ queryKey: ['studentResult', sessionId, studentId] });
    },
    onError: (error: any) => {
      alert(error.message || 'Re-evaluation failed. Please try again.');
    }
  });

  // Live Recalculation (Local view)
  const computedScore = useMemo(() => {
    if (!result) return null;
    const total = result.questions.reduce((acc: number, q: any) => {
      const over = overrides[q.id];
      return acc + (over ? over.mark : (q.lecturerOverride ?? q.marksAwarded));
    }, 0);
    const percentage = (total / result.maxMarks) * 100;
    let grade = 'F';
    if (percentage >= 90) grade = 'A*';
    else if (percentage >= 80) grade = 'A';
    else if (percentage >= 70) grade = 'B';
    else if (percentage >= 60) grade = 'C';
    else if (percentage >= 50) grade = 'D';
    else if (percentage >= 40) grade = 'E';
    return { total, percentage: Math.round(percentage), grade };
  }, [result, overrides]);

  const loadAuditTrail = async () => {
    if (!result?.id) return;
    setLoadingAudit(true);
    try {
      const res = await apiFetch(`/api/results/${result.id}/audit`);
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

  const handleDownloadPdf = () => {
    const token = safeGetItem('markai_token');
    window.location.href = `/api/results/${result.id}/pdf?token=${token}`;
  };

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
        <h2 className="text-2xl font-serif font-bold text-navy mb-2">Result Unavailable</h2>
        <p className="text-text-muted mb-6">We couldn't retrieve this specific student result. It may have been deleted or doesn't exist.</p>
        <Link to={`/lecturer/sessions/${sessionId}`} className="btn-primary">Back to Session</Link>
      </div>
    </DashboardLayout>
  );

  return (
    <DashboardLayout>
      <div className="mb-10">
        <Link to={`/lecturer/sessions/${sessionId}`} className="btn-ghost text-xs flex items-center gap-2 mb-6">
          <ArrowLeft size={16} /> Back to Session Results
        </Link>
        
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
          <div className="space-y-4">
            <div className="flex items-center gap-4">
               <div className="w-16 h-16 rounded-2xl bg-navy text-white flex items-center justify-center font-serif text-2xl font-bold shadow-sm shrink-0">
                 {result?.studentName?.charAt(0) || result?.studentId?.charAt(0)}
               </div>
               <div>
                  <h1 className="text-3xl font-serif font-bold text-navy">{result?.studentName || 'Student Result'}</h1>
                  <p className="text-sm font-bold text-text-muted uppercase tracking-widest">ID: {result?.studentId}</p>
               </div>
            </div>
            <div className="flex gap-4 text-[10px] font-bold text-text-muted uppercase tracking-widest">
               <span>Course: {result?.session?.courseId}</span>
               <span>•</span>
               <span>Exam: {result?.session?.examBoard}</span>
               <span>•</span>
               <span>Type: {result?.session?.sessionType}</span>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
             <button 
               onClick={handleDownloadPdf}
               className="group inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-semibold text-slate-700 bg-white border border-slate-200/90 hover:border-slate-300 hover:text-navy hover:bg-slate-50/80 shadow-xs hover:shadow transition-all duration-150 active:scale-[0.98] whitespace-nowrap cursor-pointer"
             >
               <Download size={14} className="text-slate-400 group-hover:text-navy transition-colors shrink-0" />
               <span>Download Report (PDF)</span>
             </button>
             <button 
               className={cn(
                 "group inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-semibold whitespace-nowrap transition-all duration-150 shadow-xs",
                 Object.keys(overrides).length > 0
                   ? "bg-navy hover:bg-navy-mid text-white shadow-xs hover:shadow-md hover:shadow-navy/20 hover:-translate-y-0.5 active:scale-[0.98] cursor-pointer"
                   : "bg-slate-100 text-slate-400 border border-slate-200/80 cursor-not-allowed opacity-70"
               )}
               disabled={Object.keys(overrides).length === 0}
             >
               <CheckCircle2 size={14} className={cn("shrink-0", Object.keys(overrides).length > 0 ? "text-accent" : "text-slate-400")} />
               <span>Finalize Paper</span>
             </button>
          </div>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-12">
         <div className="card p-6 bg-navy text-white relative overflow-hidden">
            <div className="absolute top-0 right-0 w-24 h-24 bg-white/5 rounded-full blur-2xl -mr-12 -mt-12" />
            <p className="text-[10px] font-bold uppercase tracking-widest opacity-60">AI Awarded</p>
            <p className="text-2xl font-serif font-bold mt-1">{result?.totalMarks} / {result?.maxMarks}</p>
            <p className="text-xs mt-1 text-white/40">{result?.percentage}% • Grade {result?.grade}</p>
         </div>
         
         <div className="card p-6 border-2 border-accent relative">
            <div className="absolute -top-3 left-4 px-2 bg-white text-[10px] font-bold text-accent uppercase tracking-widest">Live Result</div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-text-muted">Final Score</p>
            <p className="text-2xl font-serif font-bold mt-1 text-navy">{computedScore?.total} / {result?.maxMarks}</p>
            <p className="text-xs mt-1 text-accent font-bold">{computedScore?.percentage}% • Grade {computedScore?.grade}</p>
         </div>

         <div className="card p-6">
            <p className="text-[10px] font-bold uppercase tracking-widest text-text-muted">Status</p>
            <div className="flex items-center gap-2 mt-2">
               <div className={cn("w-2 h-2 rounded-full", result?.reviewed ? "bg-green-500" : "bg-gold animate-pulse")} />
               <p className="text-sm font-bold text-navy">{result?.reviewed ? 'Reviewed' : 'Review Required'}</p>
            </div>
         </div>

         <div className="flex flex-col justify-between h-full">
            <button
              onClick={() => reEvaluateMutation.mutate()}
              disabled={reEvaluateMutation.isPending}
              className="w-full h-full min-h-[140px] flex flex-col items-center justify-center gap-2.5 rounded-card bg-gradient-to-b from-navy to-navy-mid text-white border border-navy/20 hover:shadow-lg hover:-translate-y-0.5 transition-all duration-200 active:scale-[0.99] disabled:opacity-60 disabled:cursor-not-allowed group cursor-pointer p-5"
            >
              <div className="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center text-accent group-hover:scale-110 transition-transform">
                <RefreshCw size={18} className={reEvaluateMutation.isPending ? 'animate-spin' : ''} />
              </div>
              <span className="text-sm font-bold tracking-wide">
                {reEvaluateMutation.isPending ? 'Re-evaluating...' : 'Re-evaluate with AI'}
              </span>
              <span className="text-xs text-white/70 font-normal text-center">
                Re-checks this score for accuracy
              </span>
            </button>
            {comparisonResult && (
              <div className={`mt-3 px-3 py-2.5 rounded-lg text-xs font-medium flex items-center gap-2 ${
                comparisonResult.changed
                  ? 'bg-amber-100 text-amber-800 border border-amber-300'
                  : 'bg-green-100 text-green-800 border border-green-300'
              }`}>
                {comparisonResult.changed ? <AlertTriangle size={14} /> : <CheckCircle size={14} />}
                {comparisonResult.changed
                  ? `Score changed: ${comparisonResult.previousTotal} → ${comparisonResult.newTotal}`
                  : `Consistent: scored ${comparisonResult.newTotal} both times`}
              </div>
            )}
         </div>
      </div>

      {/* Question Breakdown */}
      <div className="space-y-6">
         <div className="flex justify-between items-center px-2">
            <h2 className="text-xl font-serif font-bold text-navy">Question Breakdown</h2>
            <div className="flex items-center gap-4 text-xs">
               <span className="flex items-center gap-1.5 text-green-600"><div className="w-2 h-2 rounded-full bg-green-500" /> Correct</span>
               <span className="flex items-center gap-1.5 text-gold"><div className="w-2 h-2 rounded-full bg-gold" /> Partial</span>
               <span className="flex items-center gap-1.5 text-red-500"><div className="w-2 h-2 rounded-full bg-red-500" /> Incorrect</span>
            </div>
         </div>

         <div className="card overflow-hidden">
            <table className="w-full text-left">
               <thead>
                  <tr className="bg-bg text-[10px] font-bold uppercase tracking-[0.2em] text-text-muted">
                     <th className="px-8 py-5 w-20">No.</th>
                     <th className="px-8 py-5">Topic & Feedback</th>
                     <th className="px-8 py-5 w-32">AI Marks</th>
                     <th className="px-8 py-5 w-64">Lecturer Override</th>
                     <th className="px-8 py-5 text-right w-20"></th>
                  </tr>
               </thead>
               <tbody className="divide-y divide-border">
                  {[...(result?.questions || [])]
                     .sort((a: any, b: any) =>
                        (a.questionNumber || '').localeCompare(b.questionNumber || '', undefined, { numeric: true })
                     )
                     .map((q: any) => (
                      <tr key={q.id} className="group hover:bg-bg/10 transition-colors align-top">
                         <td className="px-8 py-5">
                            <div className={cn(
                               "w-8 h-8 rounded-lg flex items-center justify-center font-bold text-xs",
                               q.status === 'CORRECT' ? "bg-green-100 text-green-700" :
                               q.status === 'PARTIAL' ? "bg-gold-pale text-gold" : "bg-red-100 text-red-700"
                            )}>
                               {q.questionNumber}
                            </div>
                         </td>
                         <td className="px-8 py-5">
                            <div className="space-y-3">
                               <div>
                                  <span className="inline-block text-[11px] font-medium text-slate-500 bg-slate-100 px-2.5 py-0.5 rounded-full border border-slate-200 mb-1.5">
                                     {q.topic}
                                  </span>
                                  {/* 1. Extracted Question Text */}
                                  <p className="text-sm font-semibold text-navy leading-relaxed">
                                     {q.questionText || 'Question text not available'}
                                  </p>
                               </div>

                               {/* 2. Student's Answer */}
                               <div className="bg-white/80 rounded-xl p-3 border border-slate-200/60 shadow-sm">
                                  <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide mb-1.5 flex items-center gap-1.5">
                                     <span className="w-4 h-4 bg-navy/10 rounded-full flex items-center justify-center text-navy text-[9px] font-bold">S</span>
                                     Student's Answer
                                  </p>
                                  <p className="text-xs text-slate-700 leading-relaxed whitespace-pre-line">
                                     {q.studentAnswer && q.studentAnswer.trim().length > 0
                                        ? q.studentAnswer
                                        : <span className="text-slate-400 italic">No answer provided</span>
                                     }
                                  </p>
                               </div>

                               {/* 3. Expected Answer / Mark Scheme (collapsible) */}
                               {q.expectedAnswer && (
                                  <details className="bg-slate-50/70 rounded-xl border border-slate-200/60 shadow-sm text-xs group/details">
                                     <summary className="px-3 py-2 text-[11px] font-semibold text-slate-500 uppercase tracking-wide cursor-pointer list-none flex items-center gap-1.5 hover:text-navy transition-colors">
                                        <span className="w-4 h-4 bg-green-100 rounded-full flex items-center justify-center text-green-600 text-[9px] font-bold">✓</span>
                                        Expected Answer / Mark Scheme
                                        <span className="ml-auto text-slate-400 text-[10px]">▼</span>
                                     </summary>
                                     <div className="px-3 pb-2.5 pt-1 border-t border-slate-100">
                                        <p className="text-xs text-slate-600 leading-relaxed whitespace-pre-line">
                                           {q.expectedAnswer}
                                        </p>
                                     </div>
                                  </details>
                               )}

                               {/* AI Feedback Block */}
                               <div className="bg-white/50 border border-border p-3 rounded-lg text-xs text-text-muted leading-relaxed">
                                  <div className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-400 uppercase tracking-wide mb-1">
                                     <Sparkles size={11} className="text-accent" />
                                     <span>AI Feedback</span>
                                  </div>
                                  <p className="text-xs text-slate-600 leading-relaxed">
                                     {q.aiFeedback || 'No feedback available'}
                                  </p>
                                  {q.lostMarksReason && (
                                     <div className="mt-2 pt-2 border-t border-slate-100">
                                        <p className="text-[10px] font-semibold text-red-500 mb-0.5">Why marks were lost:</p>
                                        <p className="text-[10px] text-red-500 italic"><AlertCircle size={10} className="inline mr-1" /> {q.lostMarksReason}</p>
                                     </div>
                                  )}
                                  {q.improvementSuggestion && (
                                     <div className="mt-2 pt-2 border-t border-slate-100">
                                        <p className="text-[10px] font-semibold text-blue-500 mb-0.5">How to improve:</p>
                                        <p className="text-xs text-blue-600 leading-relaxed">{q.improvementSuggestion}</p>
                                     </div>
                                  )}
                               </div>

                               {q.aiConfidence === 'Low' && (
                                 <div className="mt-1 flex items-center gap-1.5 text-[10px] text-amber-600 font-bold bg-amber-50/50 border border-amber-200/50 p-1.5 rounded-md">
                                   <AlertCircle size={12} className="shrink-0" />
                                   <span>Low confidence — {q.consensusNote}</span>
                                 </div>
                               )}
                            </div>
                         </td>
                        <td className="px-8 py-5">
                           <div className="space-y-1">
                              <p className="text-sm font-bold text-navy">{q.lecturerOverride ?? q.marksAwarded} / {q.marksAvailable}</p>
                              {/* Show change badge if mark was modified */}
                              {q.lastChangedByRole && q.lastChangedByRole !== 'AI' && (
                                 <div className="flex flex-col items-start gap-1 mt-1">
                                    {getChangeBadge(q)}
                                    {q.originalAiMark !== null && q.originalAiMark !== undefined && q.originalAiMark !== (q.lecturerOverride ?? q.marksAwarded) && (
                                       <span className="text-[10px] text-slate-400 line-through">
                                          Original AI: {q.originalAiMark}
                                       </span>
                                    )}
                                 </div>
                              )}
                           </div>
                        </td>
                        <td className="px-8 py-5">
                           <div className="flex gap-2">
                              <div className="relative w-20">
                                 <input 
                                    type="number" 
                                    className="input py-1.5 pr-2 pl-3 text-sm font-bold"
                                    max={q.marksAvailable}
                                    min={0}
                                    placeholder={q.marksAwarded}
                                    value={overrides[q.id]?.mark ?? q.lecturerOverride ?? ''}
                                    onChange={e => setOverrides({
                                       ...overrides,
                                       [q.id]: { mark: parseInt(e.target.value), note: overrides[q.id]?.note || q.lecturerNote || '' }
                                    })}
                                 />
                                 <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-text-muted">/{q.marksAvailable}</span>
                              </div>
                              <input 
                                 type="text" 
                                 className="input py-1.5 flex-1 text-[10px]"
                                 placeholder="Add lecturer note..."
                                 value={overrides[q.id]?.note ?? q.lecturerNote ?? ''}
                                 onChange={e => setOverrides({
                                    ...overrides,
                                    [q.id]: { mark: overrides[q.id]?.mark ?? q.lecturerOverride ?? q.marksAwarded, note: e.target.value }
                                 })}
                              />
                           </div>
                        </td>
                        <td className="px-8 py-5 text-right">
                           {overrides[q.id] && (
                              <button 
                                 onClick={() => overrideMutation.mutate({
                                    resultId: result.id,
                                    questionId: q.id,
                                    mark: overrides[q.id].mark,
                                    note: overrides[q.id].note
                                 })}
                                 className="p-2 bg-accent text-white rounded-lg hover:bg-accent/90 transition-all shadow-md shadow-accent/20"
                              >
                                 {overrideMutation.isPending ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                              </button>
                           )}
                        </td>
                     </tr>
                  ))}
               </tbody>
            </table>
         </div>

         {/* Full Audit History Panel */}
         <div className="border border-slate-200 bg-white rounded-2xl shadow-sm overflow-hidden mt-6">
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
    </DashboardLayout>
  );
};

export default LecturerResultDetail;
