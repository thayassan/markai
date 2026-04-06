import React, { useState } from 'react';
import { DashboardLayout } from '@/src/components/DashboardLayout';
import { Users, GraduationCap, FileText, TrendingUp, Search, Plus, CheckCircle2, X, Loader2, AlertCircle } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '@/src/lib/utils';
import { useQuery, useMutation } from '@tanstack/react-query';
import { apiFetch } from '../lib/api';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  Title,
  Tooltip,
  Legend,
} from 'chart.js';
import { Line, Bar } from 'react-chartjs-2';

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  Title,
  Tooltip,
  Legend
);

const AdminDashboard = () => {
  const [searchTerm, setSearchTerm] = useState('');
  const [showToast, setShowToast] = useState(false);
  const [toastMessage, setToastMessage] = useState('');
  const [showInviteDialog, setShowInviteDialog] = useState(false);
  const [inviteRole, setInviteRole] = useState<'STUDENT' | 'LECTURER'>('LECTURER');
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteName, setInviteName] = useState('');
  const [lastGeneratedCode, setLastGeneratedCode] = useState<string | null>(null);

  // Fetch Dashboard Data
  const { data: dashboardData, isLoading: dashboardLoading, refetch: refetchDashboard } = useQuery({
    queryKey: ['adminDashboard'],
    queryFn: () => apiFetch('/api/admin/dashboard').then(res => res.json())
  });

  // Fetch Invitations
  const { data: invitations, isLoading: invitesLoading, refetch: refetchInvites } = useQuery({
    queryKey: ['adminInvitations'],
    queryFn: () => apiFetch('/api/admin/invitations').then(res => res.json())
  });

  // Invitation Mutation
  const inviteMutation = useMutation({
    mutationFn: (payload: any) => apiFetch('/api/admin/invite', {
      method: 'POST',
      body: JSON.stringify(payload)
    }).then(res => res.json()),
    onSuccess: (data) => {
      if (data.inviteCode) {
        setLastGeneratedCode(data.inviteCode);
        triggerToast(`Invitation sent! Code: ${data.inviteCode}`);
      } else {
        triggerToast(`Invitation sent successfully!`);
        setShowInviteDialog(false);
      }
      setInviteEmail('');
      setInviteName('');
      refetchInvites();
    }
  });

  // Revoke Invitation Mutation
  const revokeMutation = useMutation({
    mutationFn: (id: string) => apiFetch(`/api/admin/invitations/${id}`, {
      method: 'DELETE'
    }).then(res => res.json()),
    onSuccess: () => {
      triggerToast('Invitation revoked');
      refetchInvites();
    }
  });

  const triggerToast = (message: string) => {
    setToastMessage(message);
    setShowToast(true);
    setTimeout(() => setShowToast(false), 5000);
  };

  const stats = [
    { label: 'Total Students', value: dashboardData?.stats?.totalStudents?.toLocaleString() || '0', icon: Users, color: 'navy' },
    { label: 'Total Lecturers', value: dashboardData?.stats?.totalLecturers?.toLocaleString() || '0', icon: GraduationCap, color: 'accent' },
    { label: 'Sessions (Month)', value: dashboardData?.stats?.sessionsThisMonth?.toString() || '0', icon: FileText, color: 'gold' },
    { label: 'University Avg.', value: `${Math.round(dashboardData?.stats?.universityAverage || 0)}%`, icon: TrendingUp, color: 'navy' },
  ];

  const lineLabels = dashboardData?.trends?.map((t: any) => t.month) || ['-', '-', '-', '-', '-', '-'];
  const lineData = {
    labels: lineLabels,
    datasets: [
      {
        label: 'University Avg. Score',
        data: dashboardData?.trends?.map((t: any) => Math.round(t.avg)) || [0, 0, 0, 0, 0, 0],
        borderColor: '#0f2a4a',
        tension: 0.4,
      },
    ],
  };

  const barLabels = dashboardData?.courseComparison?.map((c: any) => c.subject) || ['No Data'];
  const barData = {
    labels: barLabels,
    datasets: [
      {
        label: 'Avg. Score',
        data: dashboardData?.courseComparison?.map((c: any) => Math.round(c.avg)) || [0],
        backgroundColor: '#2ecc9a',
        borderRadius: 4,
      },
    ],
  };

  const handleInvite = () => {
    setLastGeneratedCode(null);
    setShowInviteDialog(true);
  };

  const submitInvite = (e: React.FormEvent) => {
    e.preventDefault();
    inviteMutation.mutate({
      email: inviteEmail,
      userType: inviteRole
    });
  };

  const staffData = dashboardData?.staff || [];
  const filteredStaff = staffData.filter((staff: any) => 
    staff.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    staff.dept.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const isLoading = dashboardLoading || invitesLoading;

  if (isLoading && !dashboardData) {
    return (
      <DashboardLayout>
        <div className="min-h-[60vh] flex flex-col items-center justify-center gap-4">
          <Loader2 className="animate-spin text-navy" size={48} />
          <p className="text-text-muted font-medium italic">Syncing university analytics...</p>
        </div>
      </DashboardLayout>
    )
  }

  const hasTrendData = dashboardData?.trends && dashboardData.trends.some((t: any) => t.avg > 0);
  const hasComparisonData = dashboardData?.courseComparison && dashboardData.courseComparison.length > 0;

  return (
    <DashboardLayout>
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-10">
        <div>
          <h1 className="text-3xl text-navy mb-2">University Administration</h1>
          <p className="text-text-muted">Recruitment management and faculty analytics.</p>
        </div>
        <button onClick={handleInvite} className="btn-primary flex items-center gap-2">
          <Plus size={18} /> Invite Staff
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-10">
        {stats.map((stat, i) => (
          <motion.div 
            key={stat.label}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.1 }}
            className="card p-6"
          >
            <div className={cn(
              "w-10 h-10 rounded-lg flex items-center justify-center mb-4",
              stat.color === 'navy' && "bg-navy/10 text-navy",
              stat.color === 'accent' && "bg-accent/10 text-accent",
              stat.color === 'gold' && "bg-gold/10 text-gold",
              stat.color === 'red' && "bg-red/10 text-red"
            )}>
              <stat.icon size={20} />
            </div>
            <p className="text-text-muted text-xs font-bold uppercase tracking-widest mb-1">{stat.label}</p>
            <p className="text-2xl font-serif font-bold text-navy">{stat.value}</p>
          </motion.div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-10">
        <div className="card">
          <h3 className="text-sm font-bold text-navy uppercase tracking-widest mb-8">Performance Trend</h3>
          <div className="h-64 flex flex-col items-center justify-center relative">
            {hasTrendData ? (
              <Line 
                data={lineData} 
                options={{ 
                  responsive: true, 
                  maintainAspectRatio: false,
                  plugins: { legend: { display: false } },
                  scales: { y: { beginAtZero: true, grid: { color: 'rgba(0,0,0,0.05)' } }, x: { grid: { display: false } } }
                }} 
              />
            ) : (
              <div className="text-center flex flex-col items-center gap-2">
                <TrendingUp className="text-text-muted opacity-20" size={48} />
                <p className="text-text-muted italic text-sm">No performance data available yet.</p>
              </div>
            )}
          </div>
        </div>
        <div className="card">
          <h3 className="text-sm font-bold text-navy uppercase tracking-widest mb-8">Course ID Comparison</h3>
          <div className="h-64 flex flex-col items-center justify-center">
            {hasComparisonData ? (
              <Bar 
                data={barData} 
                options={{ 
                  responsive: true, 
                  maintainAspectRatio: false,
                  plugins: { legend: { display: false } },
                  scales: { y: { beginAtZero: true, grid: { color: 'rgba(0,0,0,0.05)' } }, x: { grid: { display: false } } }
                }} 
              />
            ) : (
              <div className="text-center flex flex-col items-center gap-2">
                <GraduationCap className="text-text-muted opacity-20" size={48} />
                <p className="text-text-muted italic text-sm">Upload papers to see course comparison.</p>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-8 mb-10">
        {/* Invitations Activity */}
        <div className="xl:col-span-1 card p-0 overflow-hidden">
          <div className="p-6 border-b border-border flex justify-between items-center bg-bg/30">
            <h2 className="text-sm font-bold text-navy uppercase tracking-widest">Recent Invites</h2>
          </div>
          <div className="max-h-[500px] overflow-y-auto">
            {invitations && invitations.length > 0 ? (
              <div className="divide-y divide-border">
                {invitations.map((invite: any) => (
                  <div key={invite.id} className="p-4 hover:bg-bg/20 transition-colors">
                    <div className="flex justify-between items-start mb-2">
                      <div className="flex flex-col">
                        <span className="text-sm font-bold text-navy truncate max-w-[150px]">{invite.email}</span>
                        <span className="text-[10px] text-text-muted uppercase tracking-wider">{invite.userType}</span>
                      </div>
                      <span className={cn(
                        "text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider",
                        invite.used ? "bg-accent/10 text-accent" : 
                        new Date(invite.expiresAt) < new Date() ? "bg-red/10 text-red" : 
                        "bg-gold/10 text-gold-dark"
                      )}>
                        {invite.used ? 'Used' : new Date(invite.expiresAt) < new Date() ? 'Expired' : 'Pending'}
                      </span>
                    </div>
                    <div className="flex justify-between items-center text-[11px]">
                      <code className="bg-bg px-1.5 py-0.5 rounded border border-border text-navy font-mono">
                        {invite.used ? '****-****' : invite.code}
                      </code>
                      {!invite.used && (
                        <button 
                          onClick={() => revokeMutation.mutate(invite.id)}
                          disabled={revokeMutation.isPending}
                          className="text-red hover:underline font-bold"
                        >
                          Revoke
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="p-10 text-center text-text-muted text-sm italic">
                No staff invitations sent yet.
              </div>
            )}
          </div>
        </div>

        {/* Staff Table */}
        <div className="xl:col-span-2 card p-0 overflow-hidden">
          <div className="p-6 border-b border-border flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
            <h2 className="text-sm font-bold text-navy uppercase tracking-widest">Faculty Lecturers</h2>
            <div className="relative w-full sm:w-64">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" size={16} />
              <input 
                type="text" 
                placeholder="Search staff..." 
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-10 pr-3 py-1.5 bg-bg border border-border rounded-button text-sm focus:outline-none focus:border-accent transition-colors" 
              />
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="bg-bg/50 text-text-muted text-[10px] font-bold uppercase tracking-[0.2em]">
                  <th className="px-6 py-4">Name</th>
                  <th className="px-6 py-4">Role</th>
                  <th className="px-6 py-4">Dept</th>
                  <th className="px-6 py-4">Classes</th>
                  <th className="px-6 py-4 text-right">Joined</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filteredStaff.length > 0 ? (
                  filteredStaff.map((staff, i) => (
                    <tr key={i} className="hover:bg-bg/30 transition-colors">
                      <td className="px-6 py-4 font-bold text-navy text-sm">{staff.name}</td>
                      <td className="px-6 py-4">
                        <span className={cn(
                          "text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider",
                          staff.role === 'ADMIN' ? "bg-navy/10 text-navy" : "bg-accent/10 text-accent"
                        )}>
                          {staff.role}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-text-mid text-xs">{staff.dept}</td>
                      <td className="px-6 py-4 text-navy font-medium text-sm">{staff.classes}</td>
                      <td className="px-6 py-4 text-text-muted text-right text-xs">
                        {staff.joined}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={4} className="px-6 py-10 text-center text-text-muted italic">
                      No staff members found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <AnimatePresence>
        {showInviteDialog && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-navy/40 backdrop-blur-sm" style={{ WebkitBackdropFilter: 'blur(4px)' }}>
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white rounded-xl shadow-2xl w-full max-w-md overflow-hidden border border-border"
            >
              <div className="p-6 border-b border-border flex justify-between items-center bg-bg/10">
                <h2 className="text-lg font-serif font-bold text-navy">Recruit Faculty</h2>
                <button onClick={() => setShowInviteDialog(false)} className="text-text-muted hover:text-navy transition-colors">
                  <X size={20} />
                </button>
              </div>
              
              {lastGeneratedCode ? (
                <div className="p-8 text-center space-y-6">
                  <div className="w-16 h-16 bg-accent/20 text-accent rounded-full flex items-center justify-center mx-auto mb-4">
                    <CheckCircle2 size={32} />
                  </div>
                  <div>
                    <h3 className="text-xl font-bold text-navy mb-2">Invitation Sent!</h3>
                    <p className="text-sm text-text-muted">A secure link and one-time code has been emailed.</p>
                  </div>
                  <div className="bg-bg border-2 border-dashed border-border rounded-xl p-6">
                    <span className="text-[10px] text-text-muted uppercase tracking-[0.2em] block mb-2 font-bold">Manual Copy</span>
                    <h2 className="text-3xl font-mono font-bold text-navy tracking-[0.3em]">{lastGeneratedCode}</h2>
                  </div>
                  <button 
                    onClick={() => setShowInviteDialog(false)}
                    className="w-full btn-primary py-3"
                  >
                    Done
                  </button>
                </div>
              ) : (
                <form onSubmit={submitInvite} className="p-6 space-y-5">
                  <p className="text-sm text-text-muted leading-relaxed">
                    Enter the prospective staff member's email to send an institutional invitation.
                  </p>
                  
                  <div>
                    <label className="block text-[10px] font-bold text-navy uppercase tracking-widest mb-2">Institutional Email</label>
                    <input 
                      type="email" 
                      required
                      value={inviteEmail}
                      onChange={(e) => setInviteEmail(e.target.value)}
                      placeholder="name@university.edu"
                      className="w-full px-4 py-3 bg-bg border border-border rounded-button text-sm focus:outline-none focus:border-accent transition-colors" 
                    />
                  </div>

                  <div>
                    <label className="block text-[10px] font-bold text-navy uppercase tracking-widest mb-2">Platform Role</label>
                    <select 
                      value={inviteRole}
                      onChange={(e) => setInviteRole(e.target.value as any)}
                      className="w-full px-4 py-3 bg-bg border border-border rounded-button text-sm focus:outline-none focus:border-accent transition-colors"
                    >
                      <option value="LECTURER">Faculty Lecturer</option>
                      <option value="ADMIN">University Admin</option>
                    </select>
                  </div>

                  <div className="pt-4 flex justify-end gap-3">
                    <button type="button" onClick={() => setShowInviteDialog(false)} className="px-5 py-2.5 rounded-button text-text-muted text-sm font-bold hover:bg-bg transition-colors">
                      Cancel
                    </button>
                    <button 
                      type="submit" 
                      disabled={inviteMutation.isPending}
                      className="btn-primary px-8 flex items-center gap-2"
                    >
                      {inviteMutation.isPending && <Loader2 size={16} className="animate-spin" />}
                      {inviteMutation.isPending ? 'Sending...' : 'Issue Invitation'}
                    </button>
                  </div>
                </form>
              )}
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showToast && (
          <motion.div 
            initial={{ opacity: 0, y: 50 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 50 }}
            className="fixed bottom-8 right-8 z-[100] bg-navy text-white px-6 py-4 rounded-xl shadow-2xl flex items-center gap-3 border border-white/10"
          >
            <div className="w-8 h-8 bg-accent/20 rounded-full flex items-center justify-center">
              <CheckCircle2 size={16} className="text-accent" />
            </div>
            <span className="text-sm font-medium">{toastMessage}</span>
          </motion.div>
        )}
      </AnimatePresence>
    </DashboardLayout>
  );
};

export default AdminDashboard;
