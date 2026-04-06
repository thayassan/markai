import React, { useState, useMemo } from 'react';
import { DashboardLayout } from '@/src/components/DashboardLayout';
import { 
  ArrowLeft, Save, CheckCircle2, Download, AlertCircle, 
  HelpCircle, MoreVertical, Loader2, RefreshCcw, Sparkles 
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
      const res = await apiFetch(`/api/sessions/${sessionId}/students/${studentId}/re-evaluate`, {
        method: 'POST'
      });
      if (!res.ok) throw new Error('Failed to re-evaluate');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['studentResult', sessionId, studentId] });
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
        
        <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-6">
          <div className="space-y-4">
            <div className="flex items-center gap-4">
               <div className="w-16 h-16 rounded-2xl bg-navy text-white flex items-center justify-center font-serif text-2xl font-bold">
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

          <div className="flex gap-3">
             <button 
               onClick={handleDownloadPdf}
               className="btn-ghost flex items-center gap-2 text-xs border border-border"
             >
               <Download size={14} /> Download Report (PDF)
             </button>
             <button className={cn(
               "btn-primary flex items-center gap-2 text-xs px-8",
               Object.keys(overrides).length === 0 && "opacity-50"
             )}>
               <CheckCircle2 size={14} /> Finalize Paper
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

         <div className="card p-6 bg-bg flex items-center justify-center border-dashed border-2 border-border">
            <button 
               onClick={() => reEvaluateMutation.mutate()}
               disabled={reEvaluateMutation.isPending}
               className="flex items-center gap-2 text-text-muted hover:text-navy transition-all text-xs font-bold uppercase tracking-widest"
            >
               {reEvaluateMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <RefreshCcw size={14} />}
               {reEvaluateMutation.isPending ? 'Re-evaluating...' : 'Re-evaluate with AI'}
            </button>
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
                  {result?.questions.map((q: any) => (
                     <tr key={q.id} className="group hover:bg-bg/10 transition-colors">
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
                           <div className="space-y-2">
                              <p className="text-sm font-bold text-navy">{q.topic}</p>
                              <div className="bg-white/50 border border-border p-3 rounded-lg text-xs text-text-muted leading-relaxed">
                                 <Sparkles size={12} className="inline mr-1 text-accent" />
                                 {q.aiFeedback}
                              </div>
                              {q.lostMarksReason && (
                                 <p className="text-[10px] text-red-500 italic"><AlertCircle size={10} className="inline mr-1" /> {q.lostMarksReason}</p>
                              )}
                           </div>
                        </td>
                        <td className="px-8 py-5">
                           <p className="text-sm font-bold text-navy">{q.marksAwarded} / {q.marksAvailable}</p>
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
      </div>
    </DashboardLayout>
  );
};

export default LecturerResultDetail;
