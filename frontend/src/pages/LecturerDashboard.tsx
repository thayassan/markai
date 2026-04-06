import React, { useState } from 'react';
import { DashboardLayout } from '@/src/components/DashboardLayout';
import { 
  Plus, Users, FileCheck, Clock, TrendingUp, 
  Database, Sparkles, Send, Loader2, Search, 
  ChevronRight, AlertCircle
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation } from '@tanstack/react-query';
import { cn } from '@/src/lib/utils';
import { useAuth } from '../context/AuthContext';
import { safeGetItem } from '../lib/storage';
import { apiFetch } from '../lib/api';

const LecturerDashboard = () => {
  const { user } = useAuth();
  const [searchTerm, setSearchTerm] = useState('');
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiResponse, setAiResponse] = useState('');

  // Queries
  const { data: stats } = useQuery({
    queryKey: ['dashboardStats'],
    queryFn: () => apiFetch('/api/dashboard/stats').then(res => {
      if (!res.ok) throw new Error('Failed to load dashboard stats');
      return res.json();
    })
  });

  const { data: sessionsData, isLoading: sessionsLoading, isError: sessionsError } = useQuery({
    queryKey: ['recentSessions'],
    queryFn: () => apiFetch('/api/sessions?page=1&limit=10').then(res => {
      if (!res.ok) throw new Error('Failed to load recent sessions');
      return res.json();
    }),
    refetchInterval: (query) => {
      // Poll if any session is in MARKING state
      const hasMarking = query.state.data?.data?.some((s: any) => s.status === 'MARKING');
      return hasMarking ? 5000 : false;
    }
  });

  const { data: dbStatus } = useQuery({
    queryKey: ['dbStatus'],
    queryFn: () => apiFetch('/api/db-status').then(res => {
      if (!res.ok) throw new Error('Database status unavailable');
      return res.json();
    })
  });

  // AI Mutation
  const aiMutation = useMutation({
    mutationFn: async ({ prompt, context }: { prompt: string, context?: object }) => {
      const res = await apiFetch('/api/ai/generate', {
        method: 'POST',
        body: JSON.stringify({ prompt, context })
      });
      return res.json();
    },
    onSuccess: (data) => {
      setAiResponse(data.text);
    }
  });

  const handleAiAsk = (e: React.FormEvent) => {
    e.preventDefault();
    if (!aiPrompt.trim()) return;
    
    aiMutation.mutate({ 
      prompt: aiPrompt,
      context: {
        totalSessions: stats?.totalSessions,
        avgClassScore: stats?.avgClassScore,
        pendingReviews: stats?.pendingReview
      }
    });
    setAiPrompt('');
  };

  const dashboardStats = [
    { label: 'Total Sessions', value: stats?.totalSessions || 0, icon: FileCheck, color: 'navy' },
    { label: 'Papers Marked', value: stats?.papersMarked || 0, icon: Users, color: 'accent' },
    { label: 'Pending Review', value: stats?.pendingReview || 0, icon: Clock, color: 'gold' },
    { label: 'Avg. Class Score', value: `${Math.round(stats?.avgClassScore || 0)}%`, icon: TrendingUp, color: 'navy' },
  ];

  if (sessionsLoading && !sessionsData) return (
    <DashboardLayout>
      <div className="h-full flex items-center justify-center py-20">
        <Loader2 className="animate-spin text-accent" size={48} />
      </div>
    </DashboardLayout>
  );

  if (sessionsError) return (
    <DashboardLayout>
      <div className="card p-12 text-center max-w-lg mx-auto mt-10">
        <AlertCircle size={48} className="text-red-500 mx-auto mb-4" />
        <h2 className="text-2xl font-serif font-bold text-navy mb-2">Sync Error</h2>
        <p className="text-text-muted mb-6">We couldn't connect to the server to fetch your data. Please check your connection.</p>
        <button onClick={() => window.location.reload()} className="btn-primary">Retry Connection</button>
      </div>
    </DashboardLayout>
  );

  const filteredSessions = sessionsData?.data?.filter((s: any) => 
    s?.name?.toLowerCase().includes(searchTerm.toLowerCase()) || 
    s?.subject?.toLowerCase().includes(searchTerm.toLowerCase())
  ) || [];

  return (
    <DashboardLayout>
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-10">
        <div>
          <h1 className="text-3xl font-serif font-bold text-navy mb-2">Welcome, {user?.fullName || 'Lecturer'}</h1>
          <div className="flex flex-wrap items-center gap-4">
            <p className="text-text-muted">Analyze class performance and manage your marking sessions.</p>
            <div className={cn(
              "flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider",
              dbStatus?.status === 'connected' ? "bg-green-50 text-green-600" : "bg-red-50 text-red-600"
            )}>
              <Database size={12} />
              {dbStatus?.status === 'connected' ? `Supabase Connected` : "Syncing..."}
            </div>
          </div>
        </div>
        <Link to="/lecturer/sessions/new" className="btn-primary flex items-center gap-2 whitespace-nowrap shadow-lg shadow-navy/10">
          <Plus size={18} /> New Marking Session
        </Link>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 mb-12">
        {dashboardStats.map((stat, i) => (
          <motion.div 
            key={stat.label}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.1 }}
            className="card p-6"
          >
            <div className={cn(
              "w-12 h-12 rounded-xl flex items-center justify-center mb-4 transition-transform hover:scale-110",
              stat.color === 'navy' ? "bg-navy/10 text-navy" : 
              stat.color === 'accent' ? "bg-accent/10 text-accent" : "bg-gold/10 text-gold"
            )}>
              <stat.icon size={24} />
            </div>
            <p className="text-[10px] font-bold text-text-muted uppercase tracking-[0.2em] mb-1">{stat.label}</p>
            <p className="text-3xl font-serif font-bold text-navy">{stat.value}</p>
          </motion.div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Sessions Table */}
        <div className="lg:col-span-2 space-y-6">
          <div className="flex justify-between items-center">
            <h2 className="text-xl font-serif font-bold text-navy">Recent Sessions</h2>
            <div className="relative w-64">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" size={16} />
              <input 
                type="text" 
                placeholder="Search..." 
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
                  <th className="px-8 py-5">Session & Details</th>
                  <th className="px-8 py-5">Students</th>
                  <th className="px-8 py-5">Status</th>
                  <th className="px-8 py-5 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filteredSessions.map((session: any) => (
                  <tr key={session.id} className="hover:bg-bg/10 transition-colors group">
                    <td className="px-8 py-5">
                      <Link to={`/lecturer/sessions/${session.id}`} className="font-bold text-navy hover:underline block">
                        {session.name}
                      </Link>
                      <span className="text-xs text-text-muted">
                        {session.subject} • {session.courseId} • {session.sessionType}
                      </span>
                    </td>
                    <td className="px-8 py-5">
                      <div className="flex flex-col gap-1">
                        <span className="text-sm font-bold text-navy">{session?._count?.results ?? 0} Marked</span>
                        {session.status === 'MARKING' && (
                          <div className="w-24 h-1 bg-border rounded-full overflow-hidden">
                            <motion.div 
                              className="h-full bg-accent"
                              animate={{ x: [-100, 100] }}
                              transition={{ repeat: Infinity, duration: 1.5 }}
                            />
                          </div>
                        )}
                      </div>
                    </td>
                    <td className="px-8 py-5">
                      <span className={cn(
                        "badge",
                        session.status === 'COMPLETE' ? "bg-green-100 text-green-700" :
                        session.status === 'REVIEW_REQUIRED' ? "bg-gold-pale text-gold" :
                        session.status === 'MARKING' ? "bg-blue-100 text-blue-700" : "bg-gray-100 text-gray-600"
                      )}>
                        {session.status}
                      </span>
                    </td>
                    <td className="px-8 py-5 text-right">
                      <Link to={`/lecturer/sessions/${session.id}`} className="p-2 inline-block rounded-lg hover:bg-white transition-all text-text-muted hover:text-navy">
                        <ChevronRight size={20} />
                      </Link>
                    </td>
                  </tr>
                ))}
                {filteredSessions.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-8 py-20 text-center text-text-muted italic">
                      No matching sessions found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* AI Assistant */}
        <div className="space-y-6">
          <div className="flex items-center gap-2">
            <div className="w-10 h-10 rounded-xl bg-accent/10 text-accent flex items-center justify-center">
              <Sparkles size={20} />
            </div>
            <h2 className="text-xl font-serif font-bold text-navy">Assistant</h2>
          </div>

          <div className="card h-[500px] flex flex-col p-6">
            <div className="flex-1 overflow-y-auto mb-4 space-y-4">
              {!aiResponse && !aiMutation.isPending && (
                <div className="h-full flex flex-col items-center justify-center text-center opacity-40">
                  <Sparkles size={48} className="mb-4 text-accent" />
                  <p className="text-sm font-medium">Ask AI for insights about your classes, marking criteria, or student trends.</p>
                </div>
              )}
              
              {aiResponse && (
                <motion.div 
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="text-sm text-navy leading-relaxed bg-bg rounded-xl p-4 border border-border"
                >
                  {aiResponse}
                </motion.div>
              )}

              {aiMutation.isPending && (
                <div className="flex items-center gap-2 text-accent text-xs animate-pulse">
                  <Loader2 size={14} className="animate-spin" />
                  AI is thinking...
                </div>
              )}
            </div>

            <div className="space-y-3">
              <div className="flex flex-wrap gap-2">
                {[
                  "Summarise class performance",
                  "Areas of improvement",
                  "Marking tips"
                ].map(chip => (
                  <button 
                    key={chip}
                    onClick={() => aiMutation.mutate({ prompt: chip, context: stats })}
                    className="text-[10px] font-bold uppercase tracking-widest px-3 py-1.5 bg-bg hover:bg-accent-pale hover:text-accent rounded-full transition-all"
                  >
                    {chip}
                  </button>
                ))}
              </div>
              <form onSubmit={handleAiAsk} className="relative">
                <input 
                  type="text" 
                  className="input pr-12 focus:border-accent"
                  placeholder="Ask AI..."
                  value={aiPrompt}
                  onChange={e => setAiPrompt(e.target.value)}
                  disabled={aiMutation.isPending}
                />
                <button 
                  type="submit"
                  disabled={aiMutation.isPending || !aiPrompt.trim()}
                  className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-lg bg-navy text-white flex items-center justify-center disabled:opacity-50"
                >
                  <Send size={14} />
                </button>
              </form>
            </div>
          </div>

          <div className="card p-6 bg-navy text-white text-xs space-y-4">
            <div className="flex items-center gap-2 opacity-60">
              <AlertCircle size={14} />
              <span className="uppercase tracking-widest font-bold">Pro Tip</span>
            </div>
            <p className="leading-relaxed opacity-80">
              Use "Marking Style" presets in your next session to adjust how strictly the AI evaluates open-ended answers.
            </p>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
};

export default LecturerDashboard;
