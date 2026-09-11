import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { 
  ShieldCheck, 
  Clock, 
  Users, 
  TrendingUp, 
  CheckCircle, 
  Edit3, 
  Check, 
  RotateCcw,
  Loader2,
  AlertCircle
} from 'lucide-react';

export default function ModerationPage() {
  const { token } = useParams<{ token: string }>();
  const [session, setSession] = useState<any>(null);
  const [overrides, setOverrides] = useState<Record<string, number>>({});
  const [moderatorNote, setModeratorNote] = useState('');
  const [decision, setDecision] = useState<'approve' | 'adjust' | 'return' | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    fetch(`/api/moderation/${token}`)
      .then(async res => {
        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: 'Failed to load session' }));
          throw new Error(err.error || 'Failed to load session');
        }
        return res.json();
      })
      .then(data => {
        setSession(data.session);
        // Pre-fill existing overrides if any
        const initialOverrides: Record<string, number> = {};
        data.overrides?.forEach((ov: any) => {
          initialOverrides[ov.questionResultId] = ov.moderatorMark;
        });
        setOverrides(initialOverrides);
        if (data.session?.moderationFeedback) {
          setModeratorNote(data.session.moderationFeedback);
        }
        if (data.session?.moderationStatus === 'MODERATION_APPROVED' || data.session?.moderationStatus === 'APPROVED') {
          setDecision('approve');
        }
        setLoading(false);
      })
      .catch(err => {
        setError(err.message);
        setLoading(false);
      });
  }, [token]);

  const handleSubmitDecision = async () => {
    if (!decision || !token) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/moderation/${token}/decision`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          decision,
          note: moderatorNote,
          overrides
        })
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Failed to submit decision' }));
        throw new Error(err.error || 'Failed to submit decision');
      }

      setSubmitted(true);
    } catch (err: any) {
      alert(`Error submitting moderation decision: ${err.message}`);
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-6">
        <Loader2 size={36} className="text-navy animate-spin mb-4" />
        <p className="font-bold text-navy text-lg">Loading Moderation Review...</p>
        <p className="text-slate-400 text-sm mt-1">Verifying secure token</p>
      </div>
    );
  }

  if (error || !session) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="bg-white rounded-2xl shadow-xl p-8 max-w-md w-full text-center border border-slate-100">
          <div className="w-12 h-12 rounded-full bg-red-100 text-red-600 flex items-center justify-center mx-auto mb-4">
            <AlertCircle size={24} />
          </div>
          <h2 className="text-xl font-bold text-navy mb-2">Access Denied or Link Expired</h2>
          <p className="text-sm text-slate-500 mb-6">{error || 'This moderation link is invalid or has expired.'}</p>
        </div>
      </div>
    );
  }

  // Confirmation view after decision submitted
  if (submitted) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="bg-white rounded-2xl shadow-xl p-10 max-w-md w-full text-center border border-slate-100">
          <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-5">
            <ShieldCheck size={32} className="text-green-600" />
          </div>
          <h1 className="text-2xl font-bold text-navy mb-2">Moderation Complete</h1>
          <p className="text-slate-500 text-sm mb-6">
            Your decision has been submitted. {session?.lecturerName || 'The lecturer'} will be notified by email.
          </p>
          <div className="bg-slate-50 rounded-xl p-4 text-left mb-6">
            <div className="flex justify-between text-sm mb-2">
              <span className="text-slate-500">Decision</span>
              <span className="font-semibold text-navy capitalize">
                {decision === 'adjust' ? 'Adjust & Approve' : decision === 'approve' ? 'Approve' : 'Return for Review'}
              </span>
            </div>
            <div className="flex justify-between text-sm mb-2">
              <span className="text-slate-500">Marks changed</span>
              <span className="font-semibold text-navy">{Object.keys(overrides).length}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-slate-500">Session</span>
              <span className="font-semibold text-navy">{session?.name}</span>
            </div>
          </div>
          <p className="text-xs text-slate-400">You may now close this tab.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 pb-16">
      {/* Top banner */}
      <div className="bg-navy text-white py-4 px-6">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-white/10 rounded-lg flex items-center justify-center">
              <ShieldCheck size={16} />
            </div>
            <div>
              <p className="text-xs text-white/60 uppercase tracking-wide">Moderation Review</p>
              <p className="font-semibold text-sm">{session?.name}</p>
            </div>
          </div>
          <div className="flex items-center gap-2 text-xs text-white/60">
            <Clock size={12} />
            Requested by {session?.lecturerName || 'Lecturer'}
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-6 py-8">
        {/* Stats row */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          {[
            { label: 'Total Students', value: session?.results?.length || 0, icon: Users },
            { label: 'Average Score', value: `${session?.avgScore || 0}%`, icon: TrendingUp },
            { label: 'Pass Rate', value: `${session?.passRate || 0}%`, icon: CheckCircle },
            { label: 'Your Overrides', value: Object.keys(overrides).length, icon: Edit3 }
          ].map(stat => (
            <div key={stat.label} className="bg-white rounded-2xl p-5 border border-slate-100 shadow-sm">
              <div className="flex items-center justify-between mb-3">
                <stat.icon size={18} className="text-slate-400" />
              </div>
              <p className="text-2xl font-bold text-navy">{stat.value}</p>
              <p className="text-xs text-slate-400 mt-1">{stat.label}</p>
            </div>
          ))}
        </div>

        {/* Main review table */}
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm mb-6">
          <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
            <h2 className="font-bold text-navy">Student Results</h2>
            <p className="text-xs text-slate-400">
              Click any mark to override it
            </p>
          </div>

          {session?.results?.map((result: any) => {
            const studentCode = result.studentCode || result.studentId || 'Student';
            const initial = (result.studentName || studentCode || 'S')[0].toUpperCase();

            return (
              <div key={result.id} className="px-6 py-5 border-b border-slate-100 last:border-b-0">
                {/* Student header */}
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 bg-navy rounded-xl flex items-center justify-center text-white text-sm font-bold">
                      {initial}
                    </div>
                    <div>
                      <p className="font-semibold text-navy text-sm">{result.studentName || studentCode}</p>
                      <p className="text-xs text-slate-400">ID: {result.studentCode || result.studentId}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-lg font-bold text-navy">{result.totalMarks}/{result.maxMarks}</p>
                    <p className="text-xs text-slate-400">{result.percentage}% · Grade {result.grade}</p>
                  </div>
                </div>

                {/* Per-question review */}
                <div className="space-y-2">
                  {result.questions?.map((q: any) => {
                    const originalAwarded = q.lecturerOverride ?? q.marksAwarded;
                    const isChanged = overrides[q.id] !== undefined && overrides[q.id] !== originalAwarded;

                    return (
                      <div key={q.id} className="flex items-center gap-4 py-2.5 px-4 bg-slate-50 rounded-xl">
                        <div className="w-8 h-8 bg-white border border-slate-200 rounded-lg flex items-center justify-center text-xs font-bold text-navy shrink-0">
                          {q.questionNumber}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs text-slate-600 truncate">{q.questionText || q.topic || `Question ${q.questionNumber}`}</p>
                          <p className="text-xs text-slate-400 mt-0.5">{q.topic}</p>
                        </div>

                        {/* AI mark */}
                        <div className="text-center shrink-0">
                          <p className="text-xs text-slate-400 mb-0.5">AI Mark</p>
                          <span className="text-sm font-semibold text-slate-600">
                            {q.marksAwarded}/{q.marksAvailable}
                          </span>
                        </div>

                        {/* Moderator override */}
                        <div className="text-center shrink-0">
                          <p className="text-xs text-slate-400 mb-0.5">Your Mark</p>
                          <input
                            type="number"
                            min={0}
                            max={q.marksAvailable}
                            value={overrides[q.id] ?? originalAwarded}
                            onChange={e => {
                              const val = Math.max(0, Math.min(q.marksAvailable, Number(e.target.value)));
                              setOverrides(prev => ({
                                ...prev,
                                [q.id]: val
                              }));
                            }}
                            className={`w-14 text-center py-1 px-2 rounded-lg text-sm font-bold border transition-colors ${
                              isChanged
                                ? 'border-accent bg-accent/10 text-navy'
                                : 'border-slate-200 bg-white text-navy'
                            }`}
                          />
                        </div>

                        {/* Changed indicator */}
                        <div className="w-6 h-6 flex items-center justify-center shrink-0">
                          {isChanged && (
                            <div className="w-5 h-5 bg-accent rounded-full flex items-center justify-center">
                              <Check size={12} className="text-navy stroke-[3]" />
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        {/* Decision panel */}
        <div className="bg-white rounded-2xl border border-slate-100 p-6 shadow-sm">
          <h3 className="font-bold text-navy mb-4">Your Decision</h3>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-5">
            {[
              {
                id: 'approve',
                label: 'Approve',
                description: 'Marks are correct, finalise',
                icon: ShieldCheck,
                color: 'border-green-200 bg-green-50 text-green-700',
                activeColor: 'border-green-500 bg-green-100 text-green-800'
              },
              {
                id: 'adjust',
                label: 'Adjust & Approve',
                description: 'Changed marks above, approve',
                icon: Edit3,
                color: 'border-amber-200 bg-amber-50 text-amber-700',
                activeColor: 'border-amber-500 bg-amber-100 text-amber-800'
              },
              {
                id: 'return',
                label: 'Return for Review',
                description: 'Needs marker attention',
                icon: RotateCcw,
                color: 'border-red-200 bg-red-50 text-red-700',
                activeColor: 'border-red-500 bg-red-100 text-red-800'
              }
            ].map(opt => {
              const Icon = opt.icon;
              const isSelected = decision === opt.id;
              return (
                <button
                  key={opt.id}
                  onClick={() => setDecision(opt.id as any)}
                  className={`p-4 rounded-xl border-2 text-left transition-all ${
                    isSelected ? opt.activeColor : opt.color
                  }`}
                >
                  <Icon size={18} className="mb-2" />
                  <p className="font-semibold text-sm">{opt.label}</p>
                  <p className="text-xs opacity-70 mt-0.5">{opt.description}</p>
                </button>
              );
            })}
          </div>

          <textarea
            value={moderatorNote}
            onChange={e => setModeratorNote(e.target.value)}
            placeholder="Add a note for the original marker (optional)..."
            rows={3}
            className="w-full px-4 py-3 border border-slate-200 rounded-xl text-sm resize-none focus:outline-none focus:border-navy focus:ring-2 focus:ring-navy/10 mb-4"
          />

          <button
            disabled={!decision || submitting}
            onClick={handleSubmitDecision}
            className="w-full py-3 bg-navy text-white rounded-xl font-semibold text-sm hover:bg-navy/90 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {submitting ? <Loader2 size={16} className="animate-spin" /> : <ShieldCheck size={16} />}
            {submitting ? 'Submitting...' : 'Submit Moderation Decision'}
          </button>
        </div>
      </div>
    </div>
  );
}
