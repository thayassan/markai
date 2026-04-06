import React, { useMemo } from 'react';
import { DashboardLayout } from '@/src/components/DashboardLayout';
import { 
  TrendingUp, Target, Award, Calendar, ChevronRight, 
  CheckCircle2, Loader2, Zap, ArrowUpRight, BarChart2, AlertCircle,
  Users, Activity, ShieldCheck, Clock, Layers
} from 'lucide-react';
import { motion } from 'motion/react';
import { useQuery } from '@tanstack/react-query';
import { 
  AreaChart, Area, XAxis, YAxis, CartesianGrid, 
  Tooltip, ResponsiveContainer, BarChart, Bar, Cell 
} from 'recharts';
import { cn } from '@/src/lib/utils';
import { apiFetch } from '../lib/api';
import { useAuth } from '../context/AuthContext';

const ProgressPage = () => {
  const { user } = useAuth();
  const isAdmin = user?.userType === 'ADMIN';

  // Admin Analytics Query
  const { data: adminData, isLoading: adminLoading, isError: adminError } = useQuery({
    queryKey: ['adminProgress'],
    queryFn: () => apiFetch('/api/admin/progress').then(res => {
      if (!res.ok) throw new Error('Failed to load admin analytics');
      return res.json();
    }),
    enabled: isAdmin
  });

  // Student Results Query
  const { data: results, isLoading: studentLoading, isError: studentError } = useQuery({
    queryKey: ['allResults'],
    queryFn: () => apiFetch('/api/student/results').then(res => {
      if (!res.ok) throw new Error('Failed to load progress data');
      return res.json();
    }),
    enabled: !isAdmin
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

  const isLoading = isAdmin ? adminLoading : studentLoading;
  const isError = isAdmin ? adminError : studentError;

  if (isLoading) return (
    <DashboardLayout>
      <div className="h-full flex flex-col items-center justify-center py-24 gap-4">
        <Loader2 className="animate-spin text-accent" size={48} />
        <p className="text-text-muted font-medium italic">Compiling {isAdmin ? 'university analytics' : 'academic progress'}...</p>
      </div>
    </DashboardLayout>
  );

  if (isError) return (
    <DashboardLayout>
      <div className="card p-12 text-center max-w-lg mx-auto mt-10">
        <AlertCircle size={48} className="text-red-500 mx-auto mb-4" />
        <h2 className="text-2xl font-serif font-bold text-navy mb-2">Sync Error</h2>
        <p className="text-text-muted mb-6">We couldn't connect to the server to fetch the latest analytics. Please check your connection.</p>
        <button onClick={() => window.location.reload()} className="btn-primary">Retry Connection</button>
      </div>
    </DashboardLayout>
  );

  // --- ADMIN VIEW ---
  if (isAdmin) {
    const adminStats = adminData?.stats || { totalExams: 0, passRate: 0, avgScore: 0, activeDept: 'N/A' };
    const departments = adminData?.departments || [];
    const topStudents = adminData?.topStudents || [];
    const recentSessions = adminData?.recentSessions || [];
    const health = adminData?.health || { markingSuccessRate: 100, avgMarkingTime: '0s', storageUsed: '0GB' };

    return (
      <DashboardLayout>
        <div className="mb-10">
          <h1 className="text-3xl font-serif font-bold text-navy mb-2">University Analytics</h1>
          <p className="text-text-muted">High-level performance monitoring and system health overview.</p>
        </div>

        {/* Admin Stats Grid */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-12">
          {[
            { label: 'Exams Marked', value: adminStats.totalExams, icon: Target, color: 'navy' },
            { label: 'Overall Pass Rate', value: `${adminStats.passRate}%`, icon: ShieldCheck, color: 'accent' },
            { label: 'Average Score', value: `${adminStats.avgScore}%`, icon: TrendingUp, color: 'gold' },
            { label: 'Most Active Unit', value: adminStats.activeDept, icon: Activity, color: 'navy' },
          ].map((stat, i) => (
            <motion.div 
              key={stat.label}
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: i * 0.1 }}
              className="card p-6 border-l-4"
              style={{ borderLeftColor: stat.color === 'accent' ? '#2ECC9A' : stat.color === 'gold' ? '#F2C94C' : '#0F2A4A' }}
            >
              <div className="flex justify-between items-start mb-4">
                <div className={cn(
                  "p-2 rounded-lg",
                  stat.color === 'navy' && "bg-navy/10 text-navy",
                  stat.color === 'accent' && "bg-accent/10 text-accent",
                  stat.color === 'gold' && "bg-gold/10 text-gold"
                )}>
                  <stat.icon size={20} />
                </div>
              </div>
              <p className="text-[10px] font-bold text-text-muted uppercase tracking-widest mb-1">{stat.label}</p>
              <p className="text-2xl font-serif font-bold text-navy">{stat.value}</p>
            </motion.div>
          ))}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 mb-12">
          {/* Department Performance Table */}
          <div className="lg:col-span-2 card p-0 overflow-hidden">
            <div className="p-8 border-b border-border flex justify-between items-center">
              <h3 className="text-sm font-bold text-navy uppercase tracking-[0.2em]">Departmental Performance</h3>
              <Layers size={18} className="text-text-muted" />
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="bg-bg/50 text-text-muted text-[10px] font-bold uppercase tracking-widest">
                    <th className="px-8 py-4">Department</th>
                    <th className="px-8 py-4 text-center">Students</th>
                    <th className="px-8 py-4 text-center">Avg. Score</th>
                    <th className="px-8 py-4 text-center">Pass Rate</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {departments.length > 0 ? departments.map((dept: any, i: number) => (
                    <tr key={i} className="hover:bg-bg/40 transition-colors">
                      <td className="px-8 py-5 font-bold text-navy">{dept.name}</td>
                      <td className="px-8 py-5 text-center text-text-mid">{dept.studentCount}</td>
                      <td className="px-8 py-5 text-center">
                        <span className={cn(
                          "px-2 py-1 rounded-md text-xs font-bold",
                          dept.avgScore >= 70 ? "bg-accent/10 text-accent" : dept.avgScore >= 50 ? "bg-gold/10 text-gold-dark" : "bg-red/10 text-red"
                        )}>
                          {dept.avgScore}%
                        </span>
                      </td>
                      <td className="px-8 py-5 text-center text-text-mid font-medium">{dept.passRate}%</td>
                    </tr>
                  )) : (
                    <tr><td colSpan={4} className="px-8 py-10 text-center text-text-muted italic">No departmental data synchronization yet.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Top Students */}
          <div className="card p-0 overflow-hidden">
             <div className="p-8 border-b border-border">
                <h3 className="text-sm font-bold text-navy uppercase tracking-[0.2em]">Top Performers</h3>
             </div>
             <div className="divide-y divide-border">
               {topStudents.length > 0 ? topStudents.map((student: any, i: number) => (
                 <div key={i} className="p-6 flex items-center justify-between hover:bg-bg/30 transition-colors group">
                    <div className="flex items-center gap-4">
                       <div className="w-10 h-10 rounded-full bg-accent/10 flex items-center justify-center text-accent font-bold text-xs">
                         #{i+1}
                       </div>
                       <div>
                          <p className="text-sm font-bold text-navy">{student.id}</p>
                          <p className="text-[10px] text-text-muted uppercase tracking-wider">{student.subject}</p>
                       </div>
                    </div>
                    <div className="text-right">
                       <p className="text-sm font-bold text-accent">{student.score}%</p>
                       <p className="text-[10px] text-text-muted italic">Best Score</p>
                    </div>
                 </div>
               )) : (
                 <div className="p-10 text-center text-text-muted italic text-sm">No results available.</div>
               )}
             </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-12">
           {/* Sessions Overview */}
           <div className="card p-0 overflow-hidden">
             <div className="p-8 border-b border-border">
                <h3 className="text-sm font-bold text-navy uppercase tracking-[0.2em]">Recent University Sessions</h3>
             </div>
             <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead>
                    <tr className="bg-bg/50 text-[10px] font-bold text-text-muted uppercase tracking-widest">
                       <th className="px-8 py-4">Session Name</th>
                       <th className="px-8 py-4">Status</th>
                       <th className="px-8 py-4 text-center">Results</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {recentSessions.length > 0 ? recentSessions.map((session: any, i: number) => (
                      <tr key={i} className="text-sm hover:bg-bg/30 transition-colors">
                        <td className="px-8 py-4">
                          <p className="font-bold text-navy">{session.name}</p>
                          <p className="text-[10px] text-text-muted">{session.subject}</p>
                        </td>
                        <td className="px-8 py-4">
                           <span className={cn(
                             "px-2 py-0.5 rounded text-[10px] font-bold tracking-tight",
                             session.status === 'COMPLETED' ? "bg-accent/10 text-accent" : "bg-gold/10 text-gold-dark"
                           )}>
                             {session.status}
                           </span>
                        </td>
                        <td className="px-8 py-4 text-center font-medium text-navy">{session.students}</td>
                      </tr>
                    )) : (
                      <tr><td colSpan={3} className="px-8 py-10 text-center text-text-muted italic">No recent sessions found.</td></tr>
                    )}
                  </tbody>
                </table>
             </div>
           </div>

           {/* System Health */}
           <div className="card p-8 bg-navy text-white">
             <h3 className="text-sm font-bold uppercase tracking-[0.2em] mb-8 border-b border-white/10 pb-4">System Infrastructure Health</h3>
             <div className="space-y-8">
               {[
                 { label: 'Marking Success Rate', value: `${health.markingSuccessRate}%`, icon: ShieldCheck, progress: health.markingSuccessRate },
                 { label: 'Average Process Latency', value: health.avgMarkingTime, icon: Clock, progress: 95 },
                 { label: 'Database Storage Used', value: health.storageUsed, icon: Layers, progress: 35 },
               ].map((item, i) => (
                 <div key={i} className="space-y-3">
                   <div className="flex justify-between items-center">
                     <div className="flex items-center gap-3">
                        <item.icon size={16} className="text-accent" />
                        <span className="text-sm font-medium">{item.label}</span>
                     </div>
                     <span className="text-xs font-bold text-accent">{item.value}</span>
                   </div>
                   <div className="w-full h-1.5 bg-white/10 rounded-full overflow-hidden">
                      <motion.div 
                        initial={{ width: 0 }}
                        animate={{ width: `${item.progress}%` }}
                        className="h-full bg-accent"
                      />
                   </div>
                 </div>
               ))}
               <p className="text-xs text-white/40 italic mt-6 leading-relaxed">
                 All marking pipelines are currently operational. AI performance is optimized for high-volume intake.
               </p>
             </div>
           </div>
        </div>
      </DashboardLayout>
    );
  }

  // --- STUDENT/LECTURER VIEW (Original) ---
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
                       {analytics?.subjects.map((entry: any, index: number) => (
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
                          animate={{ width: `${(analytics?.subjects.find((s: any) => s.name === 'Biology')?.score || 0) / 0.8}%` }}
                          className="h-full bg-accent"
                       />
                    </div>
                    <p className="text-[10px] opacity-50 uppercase tracking-widest font-bold">Current progress: {analytics?.subjects.find((s: any) => s.name === 'Biology')?.score || 0}% / 80%</p>
                 </div>
              </div>
              <p className="text-xs text-white/60 leading-relaxed italic">
                {analytics?.avgScore && analytics.avgScore > 75 
                  ? "You're consistently performing above average. Ready to tackle more advanced modules?"
                  : "Focus on your weaker subjects to improve your overall average score."}
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
