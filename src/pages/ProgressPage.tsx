import React, { useMemo } from 'react';
import { DashboardLayout } from '@/src/components/DashboardLayout';
import { 
  TrendingUp, Target, Award, Calendar, ChevronRight, 
  CheckCircle2, Loader2, Zap, ArrowUpRight, BarChart2, AlertCircle
} from 'lucide-react';
import { motion } from 'framer-motion';
import { useQuery } from '@tanstack/react-query';
import { 
  AreaChart, Area, XAxis, YAxis, CartesianGrid, 
  Tooltip, ResponsiveContainer, BarChart, Bar, Cell 
} from 'recharts';
import { cn } from '@/src/lib/utils';

const ProgressPage = () => {
  // Queries
  const { data: results, isLoading, isError } = useQuery({
    queryKey: ['allResults'],
    queryFn: () => fetch('/api/student/results', {
      headers: { 'Authorization': `Bearer ${localStorage.getItem('markai_token')}` }
    }).then(res => {
      if (!res.ok) throw new Error('Failed to load progress data');
      return res.json();
    })
  });


  const analytics = useMemo(() => {
    if (!results || results.length === 0) return null;

    // Monthly Averages
    const monthlyData: Record<string, { total: number; count: number }> = {};
    results.forEach((r: any) => {
      const month = new Date(r.createdAt).toLocaleString('default', { month: 'short' });
      if (!monthlyData[month]) monthlyData[month] = { total: 0, count: 0 };
      monthlyData[month].total += r.percentage;
      monthlyData[month].count++;
    });

    const timeline = Object.entries(monthlyData).map(([name, data]) => ({
      name,
      score: Math.round(data.total / data.count)
    }));

    // Subject Breakdown
    const subjectData: Record<string, { total: number; count: number }> = {};
    results.forEach((r: any) => {
      const sub = r?.session?.subject || 'Unknown';
      if (!subjectData[sub]) subjectData[sub] = { total: 0, count: 0 };
      subjectData[sub].total += r.percentage;
      subjectData[sub].count++;
    });

    const subjects = Object.entries(subjectData).map(([name, data]) => ({
       name,
       score: Math.round(data.total / data.count)
    }));

    const avgScore = results.reduce((acc: number, r: any) => acc + r.percentage, 0) / results.length;
    const topSubject = subjects.sort((a,b) => b.score - a.score)[0]?.name || 'N/A';
    
    return { timeline, subjects, avgScore, topSubject };
  }, [results]);

  if (isLoading) return (
    <DashboardLayout>
      <div className="h-full flex items-center justify-center py-20">
        <Loader2 className="animate-spin text-accent" size={48} />
      </div>
    </DashboardLayout>
  );

  if (isError) return (
    <DashboardLayout>
      <div className="card p-12 text-center max-w-lg mx-auto mt-10">
        <AlertCircle size={48} className="text-red-500 mx-auto mb-4" />
        <h2 className="text-2xl font-serif font-bold text-navy mb-2">Sync Error</h2>
        <p className="text-text-muted mb-6">We couldn't connect to the server to fetch your academic history. Please check your connection.</p>
        <button onClick={() => window.location.reload()} className="btn-primary">Retry Connection</button>
      </div>
    </DashboardLayout>
  );

  return (
    <DashboardLayout>
      <div className="mb-10">
        <h1 className="text-3xl font-serif font-bold text-navy mb-2">Academic Progress</h1>
        <p className="text-text-muted">Track your performance trends and target achievement across all courses.</p>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-12">
        {[
          { label: 'Overall Average', value: `${Math.round(analytics?.avgScore || 0)}%`, icon: TrendingUp, color: 'accent' },
          { label: 'Papers Completed', value: results?.length || 0, icon: Target, color: 'navy' },
          { label: 'Top Subject', value: analytics?.topSubject || 'N/A', icon: Award, color: 'gold' },
        ].map((stat, i) => (
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
            <p className="text-[10px] font-bold text-text-muted uppercase tracking-widest mb-1">{stat.label}</p>
            <p className="text-3xl font-serif font-bold text-navy">{stat.value}</p>
          </motion.div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-12">
        {/* Progress Chart */}
        <div className="card p-8">
           <div className="flex justify-between items-center mb-8">
              <h3 className="text-sm font-bold text-navy uppercase tracking-[0.2em]">Learning Curve</h3>
              <div className="flex gap-2">
                 <span className="text-[10px] font-bold text-accent bg-accent-pale px-2 py-1 rounded flex items-center gap-1">
                   <ArrowUpRight size={12} /> Improving
                 </span>
              </div>
           </div>
           <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                 <AreaChart data={analytics?.timeline}>
                    <defs>
                       <linearGradient id="colorCurve" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#2ECC9A" stopOpacity={0.2}/>
                          <stop offset="95%" stopColor="#2ECC9A" stopOpacity={0}/>
                       </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#F1F5F9" />
                    <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: '#64748B', fontSize: 10, fontWeight: 700 }} />
                    <YAxis axisLine={false} tickLine={false} tick={{ fill: '#64748B', fontSize: 10, fontWeight: 700 }} domain={[0, 100]} />
                    <Tooltip contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgba(0,0,0,0.1)' }} />
                    <Area type="monotone" dataKey="score" stroke="#2ECC9A" strokeWidth={3} fill="url(#colorCurve)" />
                 </AreaChart>
              </ResponsiveContainer>
           </div>
        </div>

        {/* Subject Breakdown */}
        <div className="card p-8">
           <div className="flex justify-between items-center mb-8">
              <h3 className="text-sm font-bold text-navy uppercase tracking-[0.2em]">Subject Strengths</h3>
              <BarChart2 size={16} className="text-text-muted" />
           </div>
           <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                 <BarChart data={analytics?.subjects} layout="vertical">
                    <XAxis type="number" hide domain={[0, 100]} />
                    <YAxis dataKey="name" type="category" axisLine={false} tickLine={false} tick={{ fill: '#0F172A', fontSize: 10, fontWeight: 700 }} width={80} />
                    <Tooltip cursor={{ fill: 'transparent' }} />
                    <Bar dataKey="score" radius={[0, 4, 4, 0]} barSize={20}>
                       {analytics?.subjects.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={entry.score >= 70 ? '#2ECC9A' : entry.score >= 50 ? '#F2C94C' : '#FF4D4D'} />
                       ))}
                    </Bar>
                 </BarChart>
              </ResponsiveContainer>
           </div>
        </div>
      </div>

      {/* Target Progress / Awards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        <div className="card p-8 bg-navy text-white relative overflow-hidden">
           <div className="absolute top-0 right-0 w-32 h-32 bg-accent/20 rounded-full blur-3xl -mr-16 -mt-16" />
           <h3 className="text-sm font-bold uppercase tracking-[0.2em] mb-8 border-b border-white/10 pb-4">AI Target Assistant</h3>
           <div className="space-y-6">
              <div className="flex items-start gap-4">
                 <div className="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center shrink-0">
                    <Zap size={20} className="text-accent" />
                 </div>
                 <div className="space-y-1">
                    <p className="text-sm font-bold">Goal: Reach 80% in Biology</p>
                    <div className="w-full h-1.5 bg-white/10 rounded-full overflow-hidden">
                       <motion.div 
                          initial={{ width: 0 }}
                          animate={{ width: `${(analytics?.subjects.find(s => s.name === 'Biology')?.score || 0) / 0.8}%` }}
                          className="h-full bg-accent"
                       />
                    </div>
                    <p className="text-[10px] opacity-50 uppercase tracking-widest font-bold">Current progress: {analytics?.subjects.find(s => s.name === 'Biology')?.score || 0}% / 80%</p>
                 </div>
              </div>
              <p className="text-xs text-white/60 leading-relaxed italic">
                 "You're only 8% away from your goal score in Biology. Focus on 'Genetic Engineering' topics in your next revision session to bridge the gap."
              </p>
           </div>
        </div>

        <div className="card p-0 overflow-hidden">
           <div className="p-8 border-b border-border flex justify-between items-center">
              <h2 className="text-xl font-serif font-bold text-navy">Recent Achievements</h2>
              <Award size={20} className="text-gold" />
           </div>
           <div className="divide-y divide-border">
              {results?.slice(0, 3).map((r: any, i: number) => (
                 <div key={i} className="p-6 flex items-center justify-between hover:bg-bg/30 transition-colors cursor-pointer group">
                    <div className="flex items-center gap-4">
                       <div className="w-10 h-10 rounded-full bg-accent-pale flex items-center justify-center text-accent">
                          <CheckCircle2 size={18} />
                       </div>
                       <div>
                          <h4 className="text-sm font-bold text-navy">{r?.session?.subject} Excellence</h4>
                          <p className="text-xs text-text-muted">Reached {r.percentage}% in {r?.session?.name}</p>
                       </div>
                    </div>
                    <ChevronRight size={16} className="text-text-muted group-hover:text-accent transition-all" />
                 </div>
              ))}
              {results?.length === 0 && (
                 <div className="p-10 text-center text-text-muted italic text-sm">Complete your first session to earn achievements!</div>
              )}
           </div>
        </div>
      </div>
    </DashboardLayout>
  );
};

export default ProgressPage;
