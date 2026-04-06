import React, { useState, useMemo } from 'react';
import { DashboardLayout } from '@/src/components/DashboardLayout';
import { 
  ArrowLeft, Download, CheckCircle2, Mail, Users, 
  TrendingUp, Award, Search, Sparkles, Filter, 
  ChevronRight, AlertCircle, Loader2, Play, RotateCw,
  FileText, Clock
} from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, 
  Tooltip as RechartsTooltip, ResponsiveContainer, 
  Cell, RadarChart, PolarGrid, PolarAngleAxis, 
  PolarRadiusAxis, Radar 
} from 'recharts';
import { cn } from '@/src/lib/utils';
import { safeGetItem } from '../lib/storage';
import { apiFetch } from '../lib/api';

const SessionResultsPage = () => {
  const { id } = useParams();
  const [searchTerm, setSearchTerm] = useState('');
  const [isMarking, setIsMarking] = useState(false);
  const [markingError, setMarkingError] = useState('');
  const queryClient = useQueryClient();

  // Queries
  const { data: session, isLoading: sessionLoading } = useQuery({
    queryKey: ['session', id],
    queryFn: () => apiFetch(`/api/sessions/${id}`).then(res => {
      if (!res.ok) throw new Error('Failed to load session details');
      return res.json();
    }),
    refetchInterval: isMarking ? 5000 : false
  });

  const { data: results, isLoading: resultsLoading, isError: resultsError } = useQuery({
    queryKey: ['sessionResults', id],
    queryFn: () => apiFetch(`/api/sessions/${id}/results`).then(res => {
      if (!res.ok) throw new Error('Failed to load results');
      return res.json();
    }),
    refetchInterval: isMarking ? 5000 : false
  });

  // Fetch answer sheets (for when results don't exist yet)
  const { data: answerSheets } = useQuery({
    queryKey: ['sessionAnswerSheets', id],
    queryFn: () => apiFetch(`/api/sessions/${id}/answer-sheets`).then(res => {
      if (!res.ok) throw new Error('Failed to load answer sheets');
      return res.json();
    })
  });

  // Marking progress
  const { data: markingProgress } = useQuery({
    queryKey: ['markingProgress', id],
    queryFn: () => apiFetch(`/api/sessions/${id}/progress`).then(res => res.json()),
    enabled: isMarking || session?.status === 'MARKING',
    refetchInterval: 3000
  });

  // AI Insights Query
  const { data: aiInsights, isLoading: aiLoading } = useQuery({
    queryKey: ['sessionAiInsights', id],
    queryFn: async () => {
      const res = await apiFetch('/api/ai/generate', {
        method: 'POST',
        body: JSON.stringify({
          prompt: "Analyze this class performance data and provide a summary (Performance Summary, Areas for Improvement, Teaching Focus). Return clear sections.",
          context: { session, results }
        })
      });
      const data = await res.json();
      return data.text;
    },
    enabled: !!results && results.length > 0
  });

  // Start marking handler
  const handleStartMarking = async () => {
    setIsMarking(true);
    setMarkingError('');
    try {
      const res = await apiFetch(`/api/sessions/${id}/mark`, {
        method: 'POST',
        body: JSON.stringify({})
      });
      
      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || 'Failed to start marking');
      }
      
      // Start polling — queries will auto-refetch
    } catch (error: any) {
      setMarkingError(error.message);
      setIsMarking(false);
    }
  };

  const handleRetryMarking = async () => {
    setIsMarking(true);
    setMarkingError('');
    try {
      const resetRes = await apiFetch(`/api/sessions/${id}/retry-failed`, {
        method: 'POST'
      });
      if (!resetRes.ok) {
        const errData = await resetRes.json();
        throw new Error(errData.error || 'Failed to reset failed sheets before retrying');
      }
      
      // Then proceed to normal marking
      await handleStartMarking();
    } catch (error: any) {
      setMarkingError(error.message);
      setIsMarking(false);
    }
  };

  // Action Mutations
  const approveAllMutation = useMutation({
    mutationFn: async () => {
      const res = await apiFetch(`/api/sessions/${id}/approve-all`, {
        method: 'PATCH'
      });
      if (!res.ok) throw new Error('Failed to approve all results');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['session', id] });
      queryClient.invalidateQueries({ queryKey: ['sessionResults', id] });
    }
  });

  const emailStudentsMutation = useMutation({
    mutationFn: async () => {
      const res = await apiFetch(`/api/sessions/${id}/email-reports`, {
        method: 'POST'
      });
      if (!res.ok) throw new Error('Failed to send emails');
      return res.json();
    },
    onSuccess: (data) => {
      alert(`Successfully sent ${data.count} emails!`);
    },
    onError: (error: any) => {
      alert(`Error sending emails: ${error.message}`);
    }
  });

  const handleDownloadReports = () => {
    const token = safeGetItem('markai_token');
    // Using simple window.open or a link for download
    window.location.href = `/api/sessions/${id}/download-reports?token=${token}`;
  };

  // Detect when marking completes
  React.useEffect(() => {
    if (session?.status === 'REVIEW_REQUIRED' || session?.status === 'COMPLETE') {
      setIsMarking(false);
      queryClient.invalidateQueries({ queryKey: ['sessionResults', id] });
      queryClient.invalidateQueries({ queryKey: ['sessionAnswerSheets', id] });
    }
    if (session?.status === 'ERROR') {
      setIsMarking(false);
    }
  }, [session?.status]);

  // Analytics Computation
  const analytics = useMemo(() => {
    if (!results || results.length === 0) return null;
    
    const grades = ['A*', 'A', 'B', 'C', 'D', 'E', 'F'];
    const gradeData = grades.map(g => ({
      name: g,
      count: results.filter((r: any) => r.grade === g).length
    }));

    const avgScore = results.reduce((acc: number, r: any) => acc + r.percentage, 0) / results.length;
    const highest = Math.max(...results.map((r: any) => r.percentage));
    const passRate = (results.filter((r: any) => r.percentage >= 40).length / results.length) * 100;

    // Topic Performance (Aggregated from QuestionResults)
    const topicMap: Record<string, { total: number; marks: number; count: number }> = {};
    results.forEach((res: any) => {
      res.questions?.forEach((q: any) => {
        if (!topicMap[q.topic]) topicMap[q.topic] = { total: 0, marks: 0, count: 0 };
        topicMap[q.topic].total += q.marksAvailable;
        topicMap[q.topic].marks += (q.lecturerOverride ?? q.marksAwarded);
        topicMap[q.topic].count++;
      });
    });

    const topicData = Object.entries(topicMap).map(([name, data]) => ({
      subject: name,
      A: Math.round((data.marks / data.total) * 100),
      fullMark: 100
    }));

    return { gradeData, avgScore, highest, passRate, topicData };
  }, [results]);

  const filteredResults = results?.filter((r: any) => 
    r.studentId.toLowerCase().includes(searchTerm.toLowerCase()) || 
    r.studentName?.toLowerCase().includes(searchTerm.toLowerCase())
  ) || [];

  const hasResults = results && results.length > 0;
  const hasAnswerSheets = answerSheets && answerSheets.length > 0;
  const isPending = session?.status === 'PENDING';
  const isCurrentlyMarking = session?.status === 'MARKING' || isMarking;
  const isMarkingDone = session?.status === 'REVIEW_REQUIRED' || session?.status === 'COMPLETE';

  if (sessionLoading || resultsLoading) return (
    <DashboardLayout>
      <div className="h-full flex items-center justify-center py-20">
        <Loader2 className="animate-spin text-accent" size={48} />
      </div>
    </DashboardLayout>
  );

  if (resultsError || (!sessionLoading && !session)) return (
    <DashboardLayout>
      <div className="card p-12 text-center max-w-lg mx-auto mt-10">
        <AlertCircle size={48} className="text-red-500 mx-auto mb-4" />
        <h2 className="text-2xl font-serif font-bold text-navy mb-2">Session Not Found</h2>
        <p className="text-text-muted mb-6">The marking session you are looking for is unavailable or has been deleted.</p>
        <Link to="/lecturer/sessions" className="btn-primary">Back to Sessions</Link>
      </div>
    </DashboardLayout>
  );

  return (
    <DashboardLayout>
      {/* Header */}
      <div className="mb-10">
        <Link to="/lecturer/sessions" className="btn-ghost text-xs flex items-center gap-2 mb-6">
          <ArrowLeft size={16} /> Back to Sessions
        </Link>
        
        <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-6">
          <div className="space-y-2">
            <div className="flex items-center gap-3">
              <h1 className="text-3xl font-serif font-bold text-navy">{session?.name}</h1>
              <span className={cn(
                "badge",
                session?.status === 'COMPLETE' || session?.status === 'REVIEW_REQUIRED' ? "bg-green-100 text-green-700" : 
                session?.status === 'MARKING' ? "bg-blue-100 text-blue-700" :
                session?.status === 'ERROR' ? "bg-red-100 text-red-700" :
                "bg-gold-pale text-gold"
              )}>
                {session?.status}
              </span>
            </div>
            <div className="flex gap-4 text-xs font-bold text-text-muted uppercase tracking-widest">
              <span>{session?.subject}</span>
              <span>•</span>
              <span>{session?.courseId}</span>
              <span>•</span>
              <span>{session?.sessionType}</span>
              <span>•</span>
              <span>{session?.examBoard}</span>
            </div>
          </div>
          
          <div className="flex gap-3">
             {hasResults && (
               <>
                 <button 
                   onClick={handleDownloadReports}
                   className="btn-ghost flex items-center gap-2 text-xs border border-border"
                 >
                   <Download size={14} /> Download Reports (ZIP)
                 </button>
                 <button 
                   onClick={() => emailStudentsMutation.mutate()}
                   disabled={emailStudentsMutation.isPending}
                   className="btn-ghost flex items-center gap-2 text-xs border border-border"
                 >
                   {emailStudentsMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <Mail size={14} />}
                   {emailStudentsMutation.isPending ? 'Sending...' : 'Email Students'}
                 </button>
                 <button 
                   onClick={() => approveAllMutation.mutate()}
                   disabled={approveAllMutation.isPending || session?.status === 'COMPLETE'}
                   className="btn-primary flex items-center gap-2 text-xs"
                 >
                   {approveAllMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
                   {session?.status === 'COMPLETE' ? 'All Approved' : 'Approve All Results'}
                 </button>
               </>
             )}
             {isPending && hasAnswerSheets && (
               <button 
                 onClick={handleStartMarking} 
                 disabled={isMarking}
                 className="btn-primary flex items-center gap-2 text-xs"
               >
                 {isMarking ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
                 {isMarking ? 'Starting...' : 'Start AI Marking'}
               </button>
             )}
             {session?.status === 'ERROR' && (
               <button 
                 onClick={handleRetryMarking} 
                 disabled={isMarking}
                 className="btn-primary flex items-center gap-2 text-xs bg-red-600 hover:bg-red-700"
               >
                 <RotateCw size={14} /> Retry Marking
               </button>
             )}
          </div>
        </div>
      </div>

      {/* Marking Progress Banner */}
      {isCurrentlyMarking && (
        <motion.div 
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="card p-6 mb-8 border-2 border-blue-200 bg-blue-50/50"
        >
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-blue-100 flex items-center justify-center">
              <Loader2 size={24} className="text-blue-600 animate-spin" />
            </div>
            <div className="flex-1">
              <h3 className="text-sm font-bold text-navy">AI Marking in Progress</h3>
              <p className="text-xs text-text-muted mt-1">
                {markingProgress?.currentStudentId 
                  ? `Currently marking: ${markingProgress.currentStudentName || markingProgress.currentStudentId}`
                  : 'Initializing marking pipeline...'
                }
              </p>
              {markingProgress && (
                <div className="mt-3">
                  <div className="flex justify-between text-[10px] text-text-muted mb-1">
                    <span>{markingProgress.completed || 0} / {markingProgress.total || '?'} students</span>
                    <span>{markingProgress.estimatedSecondsRemaining ? `~${Math.ceil(markingProgress.estimatedSecondsRemaining / 60)} min remaining` : ''}</span>
                  </div>
                  <div className="h-2 bg-blue-100 rounded-full overflow-hidden">
                    <motion.div 
                      initial={{ width: 0 }}
                      animate={{ width: `${((markingProgress.completed || 0) / (markingProgress.total || 1)) * 100}%` }}
                      className="h-full bg-blue-500 rounded-full"
                    />
                  </div>
                </div>
              )}
            </div>
          </div>
        </motion.div>
      )}

      {/* Error Banner */}
      {markingError && (
        <motion.div 
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="card p-6 mb-8 border-2 border-red-200 bg-red-50/50"
        >
          <div className="flex items-center gap-4">
            <AlertCircle size={24} className="text-red-500 shrink-0" />
            <div>
              <h3 className="text-sm font-bold text-red-700">Marking Failed</h3>
              <p className="text-xs text-red-600 mt-1">{markingError}</p>
            </div>
          </div>
        </motion.div>
      )}

      {/* Stats row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-6 mb-10">
        {[
          { label: 'Total Students', value: hasResults ? results.length : (answerSheets?.length || 0), icon: Users, color: 'navy' },
          { label: 'Avg. Score', value: `${Math.round(analytics?.avgScore || 0)}%`, icon: TrendingUp, color: 'accent' },
          { label: 'Pass Rate', value: `${Math.round(analytics?.passRate || 0)}%`, icon: CheckCircle2, color: 'accent' },
          { label: 'Highest Score', value: `${Math.round(analytics?.highest || 0)}%`, icon: Award, color: 'gold' },
        ].map((stat, i) => (
          <div key={i} className="card p-6">
            <div className={cn("w-8 h-8 rounded-lg flex items-center justify-center mb-3", 
              stat.color === 'navy' ? "bg-navy/10 text-navy" : 
              stat.color === 'accent' ? "bg-accent/10 text-accent" : "bg-gold/10 text-gold"
            )}>
              <stat.icon size={16} />
            </div>
            <p className="text-[10px] font-bold text-text-muted uppercase tracking-widest">{stat.label}</p>
            <p className="text-2xl font-serif font-bold text-navy">{stat.value}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 mb-12">
        {/* Grade Distribution */}
        <div className="lg:col-span-2 card p-8">
          <h3 className="text-sm font-bold text-navy uppercase tracking-[0.2em] mb-8">Grade Distribution</h3>
          <div className="h-64">
            {hasResults ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={analytics?.gradeData}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E2E8F0" />
                  <XAxis 
                    dataKey="name" 
                    axisLine={false} 
                    tickLine={false} 
                    tick={{ fill: '#64748B', fontSize: 12, fontWeight: 700 }}
                  />
                  <YAxis hide />
                  <RechartsTooltip cursor={{ fill: 'transparent' }} />
                  <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                    {analytics?.gradeData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.count > 0 ? '#2ECC9A' : '#F1F5F9'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex flex-col items-center justify-center text-text-muted">
                <FileText size={40} className="mb-3 opacity-30" />
                <p className="text-xs font-bold uppercase tracking-widest">No results yet</p>
                <p className="text-[10px] mt-1">Start marking to see grade distribution</p>
              </div>
            )}
          </div>
        </div>

        {/* Topic Radar */}
        <div className="card p-8 bg-navy text-white overflow-hidden relative">
           <div className="absolute top-0 right-0 w-32 h-32 bg-accent/20 rounded-full blur-3xl -mr-16 -mt-16" />
           <h3 className="text-sm font-bold uppercase tracking-[0.2em] border-b border-white/10 pb-4 mb-4">Topic Performance</h3>
           <div className="h-64">
             {analytics?.topicData && analytics.topicData.length >= 3 ? (
               <ResponsiveContainer width="100%" height="100%">
                 <RadarChart cx="50%" cy="50%" outerRadius="80%" data={analytics.topicData}>
                   <PolarGrid stroke="rgba(255,255,255,0.1)" />
                   <PolarAngleAxis dataKey="subject" tick={{ fill: 'rgba(255,255,255,0.5)', fontSize: 10 }} />
                   <Radar
                     name="Avg Score"
                     dataKey="A"
                     stroke="#2ECC9A"
                     fill="#2ECC9A"
                     fillOpacity={0.6}
                   />
                 </RadarChart>
               </ResponsiveContainer>
             ) : (
               <div className="h-full flex items-center justify-center opacity-40 text-xs italic">
                 Insufficient topic data for Radar overview.
               </div>
             )}
           </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Results Table */}
        <div className="lg:col-span-2 space-y-6">
           <div className="flex justify-between items-center">
             <h2 className="text-xl font-serif font-bold text-navy">Detailed Results</h2>
             <div className="relative w-64">
               <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" size={16} />
               <input 
                 type="text" 
                 placeholder="Search student ID or name..." 
                 className="input pl-10" 
                 value={searchTerm}
                 onChange={e => setSearchTerm(e.target.value)}
               />
             </div>
           </div>

           <div className="card overflow-hidden">
             <table className="w-full text-left">
               <thead>
                 <tr className="bg-bg text-[10px] font-bold uppercase tracking-[0.2em] text-text-muted">
                   <th className="px-8 py-5">Student ID</th>
                   <th className="px-8 py-5">Student Name</th>
                   <th className="px-8 py-5">Score</th>
                   <th className="px-8 py-5">Status</th>
                   <th className="px-8 py-5 text-right">Action</th>
                 </tr>
               </thead>
               <tbody className="divide-y divide-border">
                 {resultsLoading ? (
                    <tr><td colSpan={5} className="px-8 py-10 text-center"><Loader2 className="animate-spin inline-block" /></td></tr>
                 ) : hasResults ? (
                   /* Show actual results */
                   filteredResults.map((res: any) => (
                    <tr key={res.id} className="hover:bg-bg/10 transition-colors group">
                      <td className="px-8 py-5 font-bold text-navy">{res.studentId}</td>
                      <td className="px-8 py-5 text-sm text-text-muted">{res.studentName || '---'}</td>
                      <td className="px-8 py-5">
                         <div className="flex flex-col">
                            <span className="text-sm font-bold text-navy">{res.percentage}%</span>
                            <span className="text-[10px] text-text-muted">{res.totalMarks}/{res.maxMarks} • {res.grade}</span>
                         </div>
                      </td>
                      <td className="px-8 py-5">
                         <div className="flex items-center gap-2">
                           {res.reviewed ? (
                             <span className="flex items-center gap-1 text-[10px] font-bold text-green-600 uppercase">
                               <CheckCircle2 size={12} /> Reviewed
                             </span>
                           ) : (
                             <span className="flex items-center gap-1 text-[10px] font-bold text-gold uppercase">
                               <AlertCircle size={12} /> Pending Review
                             </span>
                           )}
                         </div>
                      </td>
                      <td className="px-8 py-5 text-right">
                         <Link to={`/lecturer/sessions/${id}/students/${res.studentId}`} className="btn-ghost py-1.5 px-3 text-[10px] border border-border hover:bg-white">
                           View Detail
                         </Link>
                      </td>
                    </tr>
                   ))
                 ) : hasAnswerSheets ? (
                   /* Show answer sheets when no results yet */
                   answerSheets.filter((s: any) => 
                     s.studentId.toLowerCase().includes(searchTerm.toLowerCase()) ||
                     (s.studentName || '').toLowerCase().includes(searchTerm.toLowerCase())
                   ).map((sheet: any) => (
                    <tr key={sheet.id} className="hover:bg-bg/10 transition-colors">
                      <td className="px-8 py-5 font-bold text-navy">{sheet.studentId}</td>
                      <td className="px-8 py-5 text-sm text-text-muted">{sheet.studentName || '---'}</td>
                      <td className="px-8 py-5">
                        <span className="text-sm text-text-muted italic">—</span>
                      </td>
                      <td className="px-8 py-5">
                        <span className={cn(
                          "flex items-center gap-1 text-[10px] font-bold uppercase",
                          sheet.status === 'COMPLETE' ? "text-green-600" :
                          sheet.status === 'ERROR' ? "text-red-500" :
                          sheet.status === 'MARKING' ? "text-blue-600" :
                          "text-gold"
                        )}>
                          {sheet.status === 'COMPLETE' ? <CheckCircle2 size={12} /> : 
                           sheet.status === 'MARKING' ? <Loader2 size={12} className="animate-spin" /> :
                           sheet.status === 'ERROR' ? <AlertCircle size={12} /> :
                           <Clock size={12} />
                          }
                          {sheet.status === 'PENDING' ? 'Awaiting Marking' : sheet.status}
                        </span>
                      </td>
                      <td className="px-8 py-5 text-right">
                        <span className="text-[10px] text-text-muted italic">
                          {sheet.extractedText ? `${sheet.extractedText.length} chars` : 'No text'}
                        </span>
                      </td>
                    </tr>
                   ))
                 ) : (
                   <tr>
                     <td colSpan={5} className="px-8 py-16 text-center">
                       <div className="space-y-3">
                         <FileText size={32} className="mx-auto text-text-muted opacity-30" />
                         <p className="text-sm font-bold text-navy">No Students Found</p>
                         <p className="text-xs text-text-muted">No answer sheets have been uploaded for this session.</p>
                         <Link to="/lecturer/sessions/new" className="btn-primary inline-flex items-center gap-2 text-xs mt-2">
                           Create New Session
                         </Link>
                       </div>
                     </td>
                   </tr>
                 )}
               </tbody>
             </table>
           </div>
        </div>

        {/* AI Insights Sidebar */}
        <div className="space-y-6">
           <div className="flex items-center gap-2">
             <div className="w-10 h-10 rounded-xl bg-accent/10 text-accent flex items-center justify-center">
               <Sparkles size={20} />
             </div>
             <h2 className="text-xl font-serif font-bold text-navy">Class Insights</h2>
           </div>

           <div className="card p-8 bg-bg/50 border-2 border-accent/10 relative overflow-hidden">
              {hasResults ? (
                aiLoading ? (
                  <div className="py-20 text-center space-y-4">
                    <Loader2 className="animate-spin mx-auto text-accent" size={32} />
                    <p className="text-xs font-bold text-navy uppercase tracking-widest">Generating AI Insights...</p>
                  </div>
                ) : (
                  <div className="space-y-6">
                     <div className="whitespace-pre-wrap text-sm text-navy leading-relaxed">
                       {aiInsights || "No insights available for this session yet."}
                     </div>
                     <button className="btn-ghost w-full py-2 text-[10px] uppercase font-bold tracking-widest border border-border">
                       Regenerate Analysis
                     </button>
                  </div>
                )
              ) : (
                <div className="py-12 text-center space-y-3">
                  <Sparkles size={32} className="mx-auto text-text-muted opacity-30" />
                  <p className="text-xs font-bold text-navy">Insights will appear after marking</p>
                  <p className="text-[10px] text-text-muted">AI will analyze student performance once results are available.</p>
                </div>
              )}
           </div>

           <div className="card p-6 border-l-4 border-gold bg-gold-pale/20">
              <div className="flex gap-4">
                 <AlertCircle className="text-gold shrink-0" size={20} />
                 <div className="space-y-2">
                    <p className="text-xs font-bold text-navy">Attention Required</p>
                    <p className="text-[10px] text-text-muted leading-relaxed">
                      {hasResults 
                        ? `${results?.filter((r: any) => r.percentage < 40).length || 0} students scored below the pass threshold. Consider a review session for the topics: ${[...(analytics?.topicData || [])].sort((a: any,b: any) => a.A - b.A)[0]?.subject || 'N/A'}.`
                        : isPending 
                          ? `${answerSheets?.length || 0} answer sheet(s) uploaded. Click "Start AI Marking" to begin the evaluation process.`
                          : isCurrentlyMarking 
                            ? 'Marking is in progress. Results will appear automatically.'
                            : 'No data available yet.'
                      }
                    </p>
                 </div>
              </div>
           </div>
        </div>
      </div>
    </DashboardLayout>
  );
};

export default SessionResultsPage;
