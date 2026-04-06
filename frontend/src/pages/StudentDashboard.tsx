import React, { useState, useMemo } from 'react';
import { DashboardLayout } from '@/src/components/DashboardLayout';
import { 
  FileText, Award, Zap, TrendingUp, Download, 
  Eye, CheckCircle2, Sparkles, Send, Loader2, 
  ChevronRight, Calendar, BookOpen, AlertCircle
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation } from '@tanstack/react-query';
import { 
  LineChart, Line, XAxis, YAxis, CartesianGrid, 
  Tooltip, ResponsiveContainer, AreaChart, Area 
} from 'recharts';
import { useAuth } from '@/src/context/AuthContext';
import { cn } from '@/src/lib/utils';
import { safeGetItem } from '../lib/storage';
import { apiFetch } from '../lib/api';

const StudentDashboard = () => {
  const { user } = useAuth();
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiResponse, setAiResponse] = useState('');

  // Queries
  const { data: stats } = useQuery({
    queryKey: ['studentStats'],
    queryFn: () => apiFetch('/api/dashboard/stats').then(res => {
      if (!res.ok) throw new Error('Failed to load student stats');
      return res.json();
    })
  });

  const { data: results, isLoading: resultsLoading, isError: resultsError } = useQuery({
    queryKey: ['studentResults'],
    queryFn: () => apiFetch('/api/student/results').then(res => {
      if (!res.ok) throw new Error('Failed to load recent results');
      return res.json();
    })
  });

  // AI Study Planner Mutation
  const aiMutation = useMutation({
    mutationFn: async (prompt: string) => {
      const res = await apiFetch('/api/ai/generate', {
        method: 'POST',
        body: JSON.stringify({
          prompt,
          context: { results, stats, studentName: user?.fullName || user?.email }
        })
      });
      if (!res.ok) throw new Error('AI Assistant is currently unavailable');
      return res.json();
    },
    onSuccess: (data) => {
      setAiResponse(data.text);
    }
  });

  const chartData = useMemo(() => {
    if (!results || !Array.isArray(results)) return [];
    return [...results].reverse().map((r: any) => ({
      date: new Date(r.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
      score: r.percentage
    }));
  }, [results]);

  const dashboardStats = [
    { label: 'Papers Submitted', value: stats?.papersSubmitted || 0, icon: FileText, color: 'navy' },
    { label: 'Average Score', value: `${Math.round(stats?.averageScore || 0)}%`, icon: TrendingUp, color: 'accent' },
    { label: 'Best Grade', value: stats?.bestGrade || 'N/A', icon: Award, color: 'gold' },
    { label: 'Active Streak', value: `${stats?.streak || 0} Days`, icon: Zap, color: 'red' },
  ];

  const handleAiAsk = (e: React.FormEvent) => {
    e.preventDefault();
    if (aiPrompt.trim()) aiMutation.mutate(aiPrompt);
  };

  if (resultsLoading && !results) return (
    <DashboardLayout>
      <div className="h-full flex items-center justify-center py-20">
        <Loader2 className="animate-spin text-accent" size={48} />
      </div>
    </DashboardLayout>
  );

  if (resultsError) return (
    <DashboardLayout>
      <div className="card p-12 text-center max-w-lg mx-auto mt-10">
        <AlertCircle size={48} className="text-red-500 mx-auto mb-4" />
        <h2 className="text-2xl font-serif font-bold text-navy mb-2">Sync Error</h2>
        <p className="text-text-muted mb-6">We couldn't connect to the server to fetch your data. Please check your connection.</p>
        <button onClick={() => window.location.reload()} className="btn-primary">Retry Connection</button>
      </div>
    </DashboardLayout>
  );

  return (
    <DashboardLayout>
      <div className="mb-10 text-center md:text-left">
        <h1 className="text-3xl font-serif font-bold text-navy mb-2">Welcome back, {user?.fullName?.split(' ')[0] || 'Student'}</h1>
        <p className="text-text-muted">You've completed {stats?.papersSubmitted || 0} assessments this term. Keep it up!</p>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-6 mb-10">
        {dashboardStats.map((stat, i) => (
          <motion.div 
            key={stat.label}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.1 }}
            className="card p-6"
          >
            <div className={cn(
              "w-10 h-10 rounded-xl flex items-center justify-center mb-4",
              stat.color === 'navy' ? "bg-navy/10 text-navy" : 
              stat.color === 'accent' ? "bg-accent/10 text-accent" : 
              stat.color === 'gold' ? "bg-gold/10 text-gold" : "bg-red-50 text-red-500"
            )}>
              <stat.icon size={20} />
            </div>
            <p className="text-[10px] font-bold text-text-muted uppercase tracking-widest mb-1">{stat.label}</p>
            <p className="text-2xl font-serif font-bold text-navy">{stat.value}</p>
          </motion.div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Progress Chart & Results */}
        <div className="lg:col-span-2 space-y-8">
          <div className="card p-8">
             <div className="flex justify-between items-center mb-8">
                <h2 className="text-xl font-serif font-bold text-navy">Performance Over Time</h2>
                <div className="flex gap-2">
                   <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase text-text-muted">
                      <Calendar size={12} /> Last 30 Days
                   </span>
                </div>
             </div>
             <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                   <AreaChart data={chartData}>
                      <defs>
                         <linearGradient id="colorScore" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#2ECC9A" stopOpacity={0.3}/>
                            <stop offset="95%" stopColor="#2ECC9A" stopOpacity={0}/>
                         </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#F1F5F9" />
                      <XAxis 
                        dataKey="date" 
                        axisLine={false} 
                        tickLine={false} 
                        tick={{ fill: '#64748B', fontSize: 10, fontWeight: 700 }}
                        dy={10}
                      />
                      <YAxis 
                        axisLine={false} 
                        tickLine={false} 
                        tick={{ fill: '#64748B', fontSize: 10, fontWeight: 700 }}
                        domain={[0, 100]}
                      />
                      <Tooltip 
                        contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgba(0,0,0,0.1)' }}
                      />
                      <Area 
                        type="monotone" 
                        dataKey="score" 
                        stroke="#2ECC9A" 
                        strokeWidth={4}
                        fillOpacity={1} 
                        fill="url(#colorScore)" 
                      />
                   </AreaChart>
                </ResponsiveContainer>
             </div>
          </div>

          <div className="card p-0 overflow-hidden">
             <div className="p-8 border-b border-border flex justify-between items-center">
                <h2 className="text-xl font-serif font-bold text-navy">Recent Results</h2>
             </div>
             <div className="overflow-x-auto">
                <table className="w-full text-left">
                   <thead>
                      <tr className="bg-bg text-[10px] font-bold uppercase tracking-[0.2em] text-text-muted">
                         <th className="px-8 py-5">Subject & Level</th>
                         <th className="px-8 py-5">Score</th>
                         <th className="px-8 py-5">Grade</th>
                         <th className="px-8 py-5 text-right">Action</th>
                      </tr>
                   </thead>
                   <tbody className="divide-y divide-border">
                      {resultsLoading ? (
                         <tr><td colSpan={4} className="px-8 py-10 text-center"><Loader2 className="animate-spin inline-block" /></td></tr>
                      ) : results?.slice(0, 5).map((r: any) => (
                         <tr key={r.id} className="hover:bg-bg/50 transition-colors group">
                            <td className="px-8 py-5">
                               <p className="font-bold text-navy">{r?.session?.subject}</p>
                               <p className="text-[10px] text-text-muted font-bold uppercase tracking-widest mt-0.5">
                                  {r?.session?.courseId} • {r?.session?.examBoard}
                               </p>
                            </td>
                            <td className="px-8 py-5">
                               <div className="flex flex-col">
                                  <span className="text-sm font-bold text-navy">{r.percentage}%</span>
                                  <span className="text-[10px] text-text-muted">{r.totalMarks}/{r.maxMarks}</span>
                               </div>
                            </td>
                            <td className="px-8 py-5">
                               <span className="badge bg-accent-pale text-accent">{r.grade}</span>
                            </td>
                            <td className="px-8 py-5 text-right">
                               <Link to={`/student/results/${r.id}`} className="p-2 inline-block rounded-lg hover:bg-bg transition-all">
                                  <Eye size={18} className="text-text-muted group-hover:text-navy" />
                               </Link>
                            </td>
                         </tr>
                      ))}
                      {results?.length === 0 && (
                         <tr><td colSpan={4} className="px-8 py-20 text-center text-text-muted italic">No results yet. Submitted papers will appear here.</td></tr>
                      )}
                   </tbody>
                </table>
             </div>
          </div>
        </div>

        {/* AI Sidebar */}
        <div className="space-y-6">
           <div className="flex items-center gap-2">
              <div className="w-10 h-10 rounded-xl bg-accent/10 text-accent flex items-center justify-center">
                 <Sparkles size={20} />
              </div>
              <h2 className="text-xl font-serif font-bold text-navy">Study Planner</h2>
           </div>

           <div className="card h-[600px] flex flex-col p-6 overflow-hidden bg-navy text-white relative">
              <div className="absolute top-0 right-0 w-48 h-48 bg-accent/20 rounded-full blur-3xl -mr-24 -mt-24" />
              
              <div className="flex-1 overflow-y-auto mb-6 space-y-6 scrollbar-hide">
                 {!aiResponse && !aiMutation.isPending && (
                    <div className="h-full flex flex-col items-center justify-center text-center space-y-4 px-4 opacity-60">
                       <BookOpen size={48} className="text-accent" />
                       <p className="text-sm font-medium">Get a personalized study plan based on your recent exam performance.</p>
                       <div className="flex flex-wrap justify-center gap-2 pt-4">
                          {[
                             "What should I focus on?",
                             "How to improve my grade?",
                             "Explain my common mistakes"
                          ].map(opt => (
                             <button 
                                key={opt}
                                onClick={() => aiMutation.mutate(opt)}
                                className="text-[10px] font-bold uppercase tracking-widest px-3 py-2 bg-white/10 hover:bg-white/20 rounded-full transition-all"
                             >
                                {opt}
                             </button>
                          ))}
                       </div>
                    </div>
                 )}

                 {aiResponse && (
                    <motion.div 
                       initial={{ opacity: 0, y: 10 }}
                       animate={{ opacity: 1, y: 0 }}
                       className="text-sm text-white/80 leading-relaxed space-y-4"
                    >
                       <div className="bg-white/10 p-4 rounded-xl border border-white/5 whitespace-pre-wrap">
                          {aiResponse}
                       </div>
                    </motion.div>
                 )}

                 {aiMutation.isPending && (
                    <div className="flex items-center gap-2 text-accent text-xs animate-pulse justify-center py-10">
                       <Loader2 size={16} className="animate-spin" />
                       Generating Plan...
                    </div>
                 )}
              </div>

              <form onSubmit={handleAiAsk} className="relative mt-auto">
                 <input 
                    type="text" 
                    className="w-full pl-4 pr-12 py-3 bg-white/5 border border-white/10 rounded-xl text-sm focus:outline-none focus:border-accent transition-colors placeholder:text-white/20"
                    placeholder="Ask AI for help..."
                    value={aiPrompt}
                    onChange={e => setAiPrompt(e.target.value)}
                    disabled={aiMutation.isPending}
                 />
                 <button 
                    type="submit"
                    disabled={aiMutation.isPending || !aiPrompt.trim()}
                    className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-lg bg-accent text-white flex items-center justify-center disabled:opacity-50"
                 >
                    <Send size={14} fill="currentColor" />
                 </button>
              </form>
           </div>

           <div className="card p-6 border-l-4 border-accent">
              <p className="text-[10px] font-bold text-text-muted uppercase tracking-[0.2em] mb-2">Next Scheduled Exam</p>
              <div className="flex justify-between items-center">
                 <p className="text-sm font-bold text-navy">Biology Unit 4</p>
                 <span className="text-[10px] font-bold bg-accent-pale text-accent px-2 py-1 rounded">2 Days Left</span>
              </div>
           </div>
        </div>
      </div>
    </DashboardLayout>
  );
};

export default StudentDashboard;
