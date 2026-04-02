import React, { useState } from 'react';
import { DashboardLayout } from '@/src/components/DashboardLayout';
import { 
  FileText, Search, Filter, MoreVertical, Calendar, 
  CheckCircle2, Plus, Loader2, ChevronRight, X, 
  BarChart3, Download, Play, AlertCircle, Users
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { cn } from '@/src/lib/utils';
import DatePicker from 'react-datepicker';
import 'react-datepicker/dist/react-datepicker.css';

const LecturerSessionsPage = () => {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [showCalendar, setShowCalendar] = useState(false);
  const [dateRange, setDateRange] = useState<[Date | null, Date | null]>([null, null]);
  const [startDate, endDate] = dateRange;

  // Queries
  const { data: sessionsData, isLoading, isError } = useQuery({
    queryKey: ['sessions', statusFilter],
    queryFn: () => {
      const url = new URL('/api/sessions', window.location.origin);
      if (statusFilter !== 'ALL') url.searchParams.append('status', statusFilter);
      return fetch(url.toString(), {
        headers: { 'Authorization': `Bearer ${localStorage.getItem('markai_token')}` }
      }).then(res => {
        if (!res.ok) throw new Error('Failed to fetch sessions');
        return res.json();
      });
    }
  });

  const selectedSession = sessionsData?.data?.find((s: any) => s.id === selectedSessionId);

  const filteredSessions = sessionsData?.data?.filter((session: any) => 
    session.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    (session.courseId || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
    (session.subject || '').toLowerCase().includes(searchQuery.toLowerCase())
  ) || [];

  if (isError) return (
    <DashboardLayout>
      <div className="card p-12 text-center max-w-lg mx-auto mt-10">
        <AlertCircle size={48} className="text-red-500 mx-auto mb-4" />
        <h2 className="text-2xl font-serif font-bold text-navy mb-2">Sync Error</h2>
        <p className="text-text-muted mb-6">We couldn't connect to the server to fetch your sessions. Please check your connection.</p>
        <button onClick={() => window.location.reload()} className="btn-primary">Retry Connection</button>
      </div>
    </DashboardLayout>
  );

  return (
    <DashboardLayout>
      <div className="flex justify-between items-end mb-10">
        <div>
          <h1 className="text-3xl font-serif font-bold text-navy mb-2">Marking Sessions</h1>
          <p className="text-text-muted">Manage and review all your past and active marking sessions.</p>
        </div>
        <Link to="/lecturer/sessions/new" className="btn-primary flex items-center gap-2">
          <Plus size={18} /> New Session
        </Link>
      </div>

      <div className="flex flex-col lg:flex-row gap-8">
        {/* Main Content */}
        <div className="flex-1 space-y-6">
          <div className="card p-6 flex flex-wrap items-center gap-4">
            <div className="relative flex-1 min-w-[300px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" size={16} />
              <input 
                type="text" 
                placeholder="Search by name, subject, or course ID..." 
                className="input pl-10" 
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
              />
            </div>
            <select 
              className="input w-auto min-w-[150px]"
              value={statusFilter}
              onChange={e => setStatusFilter(e.target.value)}
            >
              <option value="ALL">All Statuses</option>
              <option value="PENDING">Pending</option>
              <option value="MARKING">Marking</option>
              <option value="REVIEW_REQUIRED">Review Required</option>
              <option value="COMPLETE">Complete</option>
            </select>
            <div className="relative">
              <button 
                onClick={() => setShowCalendar(!showCalendar)}
                className="btn-ghost flex items-center gap-2 text-sm border border-border"
              >
                <Calendar size={16} /> {startDate ? `${startDate.toLocaleDateString()} - ${endDate?.toLocaleDateString() || ''}` : 'Date Range'}
              </button>
              {showCalendar && (
                <div className="absolute top-full right-0 mt-2 z-50 shadow-2xl rounded-xl overflow-hidden border border-border">
                  <DatePicker
                    selectsRange={true}
                    startDate={startDate}
                    endDate={endDate}
                    onChange={(update) => setDateRange(update)}
                    inline
                  />
                </div>
              )}
            </div>
          </div>

          <div className="card overflow-hidden">
            <table className="w-full text-left">
              <thead>
                <tr className="bg-bg text-[10px] font-bold uppercase tracking-[0.2em] text-text-muted">
                  <th className="px-8 py-5">Session</th>
                  <th className="px-8 py-5">Metadata</th>
                  <th className="px-8 py-5">Students</th>
                  <th className="px-8 py-5">Status</th>
                  <th className="px-8 py-5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {isLoading ? (
                  <tr>
                    <td colSpan={5} className="px-8 py-20 text-center">
                      <Loader2 className="animate-spin inline-block text-accent" size={32} />
                      <p className="mt-2 text-text-muted text-sm font-bold uppercase tracking-widest">Loading Sessions...</p>
                    </td>
                  </tr>
                ) : filteredSessions.map((session: any) => (
                  <tr 
                    key={session.id} 
                    onClick={() => setSelectedSessionId(session.id)}
                    className={cn(
                      "hover:bg-bg/30 transition-all cursor-pointer group",
                      selectedSessionId === session.id && "bg-accent/5"
                    )}
                  >
                    <td className="px-8 py-5">
                      <p className="font-bold text-navy group-hover:text-accent transition-colors">{session.name}</p>
                      <p className="text-[10px] text-text-muted font-bold uppercase tracking-widest mt-1">
                        {new Date(session.createdAt).toLocaleDateString()}
                      </p>
                    </td>
                    <td className="px-8 py-5">
                      <div className="flex flex-col">
                        <span className="text-sm font-medium text-navy">{session.subject}</span>
                        <span className="text-xs text-text-muted">{session.courseId} • {session.examBoard}</span>
                      </div>
                    </td>
                    <td className="px-8 py-5">
                      <div className="flex items-center gap-2">
                        <Users size={14} className="text-text-muted" />
                        <span className="text-sm font-bold text-navy">{session?._count?.results ?? 0}</span>
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
                       <button className="p-2 inline-block rounded-lg hover:bg-white transition-all text-text-muted hover:text-navy">
                        <ChevronRight size={20} />
                      </button>
                    </td>
                  </tr>
                ))}
                {filteredSessions.length === 0 && !isLoading && (
                  <tr>
                    <td colSpan={5} className="px-8 py-20 text-center text-text-muted italic">
                      No sessions found. Try adjusting your filters.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Detail Sidebar */}
        <AnimatePresence>
          {selectedSessionId && (
            <motion.div 
              initial={{ x: 300, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: 300, opacity: 0 }}
              className="w-full lg:w-96 space-y-6"
            >
              <div className="card p-8 sticky top-8">
                <button 
                  onClick={() => setSelectedSessionId(null)}
                  className="absolute top-4 right-4 p-2 text-text-muted hover:text-navy"
                >
                  <X size={20} />
                </button>

                <div className="mb-8">
                  <div className={cn(
                    "w-12 h-12 rounded-xl flex items-center justify-center mb-4",
                    selectedSession?.status === 'COMPLETE' ? "bg-green-100 text-green-600" : "bg-accent/10 text-accent"
                  )}>
                    <BarChart3 size={24} />
                  </div>
                  <h2 className="text-xl font-bold text-navy mb-1">{selectedSession?.name}</h2>
                  <p className="text-sm text-text-muted">{selectedSession?.subject} • {selectedSession?.sessionType}</p>
                </div>

                <div className="grid grid-cols-2 gap-4 mb-8">
                   <div className="bg-bg p-4 rounded-xl">
                      <p className="text-[10px] font-bold text-text-muted uppercase tracking-widest mb-1">Students</p>
                      <p className="text-2xl font-serif font-bold text-navy">{selectedSession?._count?.results || 0}</p>
                   </div>
                   <div className="bg-bg p-4 rounded-xl">
                      <p className="text-[10px] font-bold text-text-muted uppercase tracking-widest mb-1">Avg Score</p>
                      <p className="text-2xl font-serif font-bold text-navy">--</p>
                   </div>
                </div>

                <div className="space-y-4 mb-8">
                  <div className="flex justify-between items-center text-sm">
                    <span className="text-text-muted">Status</span>
                    <span className="font-bold text-navy">{selectedSession?.status}</span>
                  </div>
                  <div className="flex justify-between items-center text-sm">
                    <span className="text-text-muted">Exam Board</span>
                    <span className="font-bold text-navy">{selectedSession?.examBoard}</span>
                  </div>
                  <div className="flex justify-between items-center text-sm">
                    <span className="text-text-muted">Strictness</span>
                    <span className="font-bold text-navy">{selectedSession?.markingStrictness}</span>
                  </div>
                </div>

                <div className="space-y-3">
                  <Link 
                    to={`/lecturer/sessions/${selectedSession?.id}`} 
                    className="btn-primary w-full flex items-center justify-center gap-2"
                  >
                    Open Full Results <ChevronRight size={18} />
                  </Link>
                  {selectedSession?.status === 'PENDING' && (
                    <button className="btn-accent w-full flex items-center justify-center gap-2">
                       <Play size={18} fill="currentColor" /> Start Marking
                    </button>
                  )}
                  <button className="btn-ghost w-full flex items-center justify-center gap-2 text-xs">
                    <Download size={14} /> Download Report (ZIP)
                  </button>
                </div>
                
                <div className="mt-8 pt-8 border-t border-border">
                   <div className="flex items-center gap-2 text-accent mb-2">
                      <AlertCircle size={14} />
                      <span className="text-[10px] font-bold uppercase tracking-widest">Review Necessary</span>
                   </div>
                   <p className="text-xs text-text-muted leading-relaxed">
                     Some papers may require manual review where AI marks were borderline. These are marked as 'PARTIAL' in the detail view.
                   </p>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </DashboardLayout>
  );
};

export default LecturerSessionsPage;
