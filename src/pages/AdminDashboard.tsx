import React, { useState } from 'react';
import { DashboardLayout } from '@/src/components/DashboardLayout';
import { Users, School, FileText, TrendingUp, Search, Plus, CheckCircle2, X } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '@/src/lib/utils';
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
  const [inviteStudentCode, setInviteStudentCode] = useState('');

  const triggerToast = (message: string) => {
    setToastMessage(message);
    setShowToast(true);
    setTimeout(() => setShowToast(false), 3000);
  };

  const stats = [
    { label: 'Total Students', value: '1,240', icon: Users, color: 'navy' },
    { label: 'Total Lecturers', value: '84', icon: School, color: 'accent' },
    { label: 'Sessions (Month)', value: '156', icon: FileText, color: 'gold' },
    { label: 'School Avg.', value: '71.2%', icon: TrendingUp, color: 'navy' },
  ];

  const lineData = {
    labels: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'],
    datasets: [
      {
        label: 'School Avg. Score',
        data: [65, 68, 72, 70, 74, 71],
        borderColor: '#0f2a4a',
        tension: 0.4,
      },
    ],
  };

  const barData = {
    labels: ['Biology', 'Chemistry', 'Physics', 'Maths', 'English'],
    datasets: [
      {
        label: 'Avg. Score',
        data: [74, 68, 71, 82, 65],
        backgroundColor: '#2ecc9a',
        borderRadius: 4,
      },
    ],
  };

  const handleInvite = () => {
    setShowInviteDialog(true);
  };

  const submitInvite = (e: React.FormEvent) => {
    e.preventDefault();
    if (inviteRole === 'STUDENT' && !/^[A-Za-z0-9-]{4,20}$/.test(inviteStudentCode)) {
      triggerToast('Invalid Student ID format.');
      return;
    }
    setShowInviteDialog(false);
    triggerToast(`Invitation sent to ${inviteEmail}`);
    setInviteEmail('');
    setInviteName('');
    setInviteStudentCode('');
  };

  const staffData = [
    { name: 'Dr. Rachel Okonkwo', dept: 'Science', classes: 6, sessions: 24, joined: 'Sep 2024' },
    { name: 'Mr. Sanjay Mehta', dept: 'Mathematics', classes: 8, sessions: 32, joined: 'Jan 2025' },
    { name: 'Prof. Linda Wanjiru', dept: 'Humanities', classes: 4, sessions: 18, joined: 'Aug 2024' },
  ];

  const filteredStaff = staffData.filter(staff => 
    staff.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    staff.dept.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <DashboardLayout>
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-10">
        <div>
          <h1 className="text-3xl text-navy mb-2">School Administration</h1>
          <p className="text-text-muted">Overview of performance across all departments.</p>
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
          <div className="h-64">
            <Line 
              data={lineData} 
              options={{ 
                responsive: true, 
                maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: { y: { beginAtZero: true, grid: { color: 'rgba(0,0,0,0.05)' } }, x: { grid: { display: false } } }
              }} 
            />
          </div>
        </div>
        <div className="card">
          <h3 className="text-sm font-bold text-navy uppercase tracking-widest mb-8">Course ID Comparison</h3>
          <div className="h-64">
            <Bar 
              data={barData} 
              options={{ 
                responsive: true, 
                maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: { y: { beginAtZero: true, grid: { color: 'rgba(0,0,0,0.05)' } }, x: { grid: { display: false } } }
              }} 
            />
          </div>
        </div>
      </div>

      <div className="card p-0 overflow-hidden">
        <div className="p-8 border-b border-border flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <h2 className="text-xl font-serif font-bold text-navy">Department Lecturers</h2>
          <div className="relative w-full sm:w-64">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" size={16} />
            <input 
              type="text" 
              placeholder="Search staff..." 
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-10 py-2 bg-bg border border-border rounded-button text-sm focus:outline-none focus:border-accent transition-colors" 
            />
            {searchTerm && (
              <button 
                onClick={() => setSearchTerm('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-navy transition-colors"
              >
                <Plus className="rotate-45" size={16} />
              </button>
            )}
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="bg-bg/50 text-text-muted text-[10px] font-bold uppercase tracking-[0.2em]">
                <th className="px-8 py-4">Lecturer Name</th>
                <th className="px-8 py-4">Department</th>
                <th className="px-8 py-4">Classes</th>
                <th className="px-8 py-4">Sessions</th>
                <th className="px-8 py-4">Joined</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filteredStaff.length > 0 ? (
                filteredStaff.map((staff, i) => (
                  <tr key={i} className="hover:bg-bg/30 transition-colors">
                    <td className="px-8 py-5 font-bold text-navy">{staff.name}</td>
                    <td className="px-8 py-5 text-text-mid text-sm">{staff.dept}</td>
                    <td className="px-8 py-5 text-navy font-medium">{staff.classes}</td>
                    <td className="px-8 py-5 text-navy font-medium">{staff.sessions}</td>
                    <td className="px-8 py-5 text-text-muted text-sm">{staff.joined}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={5} className="px-8 py-10 text-center text-text-muted italic">
                    No staff members found matching your search.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <AnimatePresence>
        {showInviteDialog && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-navy/40 backdrop-blur-sm">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white rounded-xl shadow-2xl w-full max-w-md overflow-hidden"
            >
              <div className="p-6 border-b border-border flex justify-between items-center">
                <h2 className="text-xl font-serif font-bold text-navy">Invite User</h2>
                <button onClick={() => setShowInviteDialog(false)} className="text-text-muted hover:text-navy transition-colors">
                  <X size={20} />
                </button>
              </div>
              
              <form onSubmit={submitInvite} className="p-6 space-y-5">
                <div>
                  <label className="block text-xs font-bold text-navy uppercase tracking-widest mb-2">Role</label>
                  <div className="flex p-1 bg-bg rounded-lg">
                    {(['LECTURER', 'STUDENT'] as const).map((r) => (
                      <button
                        key={r}
                        type="button"
                        onClick={() => setInviteRole(r)}
                        className={cn(
                          "flex-1 py-2 text-xs font-bold rounded-md transition-all",
                          inviteRole === r ? "bg-white text-navy shadow-sm" : "text-text-muted hover:text-text-mid"
                        )}
                      >
                        {r}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-navy uppercase tracking-widest mb-2">Full Name</label>
                  <input 
                    type="text" 
                    required
                    value={inviteName}
                    onChange={(e) => setInviteName(e.target.value)}
                    placeholder="John Doe"
                    className="w-full px-4 py-3 bg-bg border border-border rounded-button focus:outline-none focus:border-accent transition-colors" 
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-navy uppercase tracking-widest mb-2">Email Address</label>
                  <input 
                    type="email" 
                    required
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    placeholder="name@institution.edu"
                    className="w-full px-4 py-3 bg-bg border border-border rounded-button focus:outline-none focus:border-accent transition-colors" 
                  />
                </div>

                {inviteRole === 'STUDENT' && (
                  <div>
                    <label className="block text-xs font-bold text-navy uppercase tracking-widest mb-2">Student ID</label>
                    <input 
                      type="text" 
                      required
                      value={inviteStudentCode}
                      onChange={(e) => setInviteStudentCode(e.target.value)}
                      placeholder="e.g. S2024-0042"
                      className="w-full px-4 py-3 bg-bg border border-border rounded-button focus:outline-none focus:border-accent transition-colors" 
                    />
                  </div>
                )}

                <div className="pt-4 flex justify-end gap-3">
                  <button type="button" onClick={() => setShowInviteDialog(false)} className="px-5 py-2.5 rounded-button text-text-muted font-bold hover:bg-bg transition-colors">
                    Cancel
                  </button>
                  <button type="submit" className="btn-primary">
                    Send Invite
                  </button>
                </div>
              </form>
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
            className="fixed bottom-8 right-8 z-[100] bg-navy text-white px-6 py-3 rounded-button shadow-2xl flex items-center gap-3 border border-white/10"
          >
            <CheckCircle2 size={18} className="text-accent" />
            <span className="text-sm font-medium">{toastMessage}</span>
          </motion.div>
        )}
      </AnimatePresence>
    </DashboardLayout>
  );
};

export default AdminDashboard;
