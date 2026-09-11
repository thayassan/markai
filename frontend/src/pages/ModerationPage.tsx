import React, { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { 
  CheckCircle2, 
  AlertCircle, 
  ArrowLeft, 
  FileText, 
  User, 
  BookOpen, 
  Send, 
  ExternalLink,
  Loader2, 
  ChevronDown, 
  ChevronUp, 
  Save, 
  Clock, 
  Check, 
  ShieldCheck,
  Award
} from 'lucide-react';
import { cn } from '@/src/lib/utils';
import { motion, AnimatePresence } from 'framer-motion';

export default function ModerationPage() {
  const { token } = useParams<{ token: string }>();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Expanded student cards
  const [expandedStudent, setExpandedStudent] = useState<string | null>(null);

  // Local state for editing marks: { [questionId]: { mark: number, note: string } }
  const [edits, setEdits] = useState<Record<string, { mark: number; note: string }>>({});
  const [savingQuestionId, setSavingQuestionId] = useState<string | null>(null);
  const [savedSuccessId, setSavedSuccessId] = useState<string | null>(null);

  // Modals for final actions
  const [showApproveModal, setShowApproveModal] = useState(false);
  const [showReturnModal, setShowReturnModal] = useState(false);
  const [returnFeedback, setReturnFeedback] = useState('');
  const [actionLoading, setActionLoading] = useState(false);

  useEffect(() => {
    if (!token) return;
    fetch(`/api/moderation/${token}`)
      .then(async res => {
        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: 'Failed to load moderation session' }));
          throw new Error(err.error || 'Failed to load session');
        }
        return res.json();
      })
      .then(json => {
        setData(json);
        // Initialize edits from existing overrides
        const initialEdits: Record<string, { mark: number; note: string }> = {};
        json.overrides?.forEach((ov: any) => {
          initialEdits[ov.questionResultId] = {
            mark: ov.moderatorMark,
            note: ov.moderatorNote || ''
          };
        });
        setEdits(initialEdits);
        if (json.results?.length > 0) {
          setExpandedStudent(json.results[0].id);
        }
        setLoading(false);
      })
      .catch(err => {
        setError(err.message);
        setLoading(false);
      });
  }, [token]);

  const handleMarkChange = (questionId: string, mark: number, originalMark: number) => {
    setEdits(prev => ({
      ...prev,
      [questionId]: {
        mark,
        note: prev[questionId]?.note || ''
      }
    }));
  };

  const handleNoteChange = (questionId: string, note: string, currentMark: number) => {
    setEdits(prev => ({
      ...prev,
      [questionId]: {
        mark: prev[questionId]?.mark ?? currentMark,
        note
      }
    }));
  };

  const saveOverride = async (questionId: string, currentMark: number) => {
    const edit = edits[questionId];
    const markToSave = edit?.mark ?? currentMark;
    const noteToSave = edit?.note ?? '';

    setSavingQuestionId(questionId);
    try {
      const res = await fetch(`/api/moderation/${token}/override`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          questionResultId: questionId,
          moderatorMark: markToSave,
          moderatorNote: noteToSave
        })
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to save override');
      }

      const resData = await res.json();

      // Update in-memory student total
      setData((prev: any) => {
        if (!prev) return prev;
        const updatedResults = prev.results.map((r: any) => {
          if (r.id === resData.studentResultId) {
            return {
              ...r,
              totalMarks: resData.newTotalMarks,
              percentage: resData.newPercentage,
              questions: r.questions.map((q: any) => {
                if (q.id === questionId) {
                  return {
                    ...q,
                    lecturerOverride: markToSave,
                    lecturerNote: noteToSave ? `Moderator: ${noteToSave}` : q.lecturerNote
                  };
                }
                return q;
              })
            };
          }
          return r;
        });

        return { ...prev, results: updatedResults };
      });

      setSavedSuccessId(questionId);
      setTimeout(() => setSavedSuccessId(null), 2000);
    } catch (err: any) {
      alert(`Error saving mark: ${err.message}`);
    } finally {
      setSavingQuestionId(null);
    }
  };

  const handleDecision = async (decision: 'APPROVE' | 'RETURN') => {
    setActionLoading(true);
    try {
      const res = await fetch(`/api/moderation/${token}/decision`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          decision,
          feedback: decision === 'RETURN' ? returnFeedback : undefined
        })
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to submit decision');
      }

      const resData = await res.json();
      setData((prev: any) => prev ? {
        ...prev,
        session: {
          ...prev.session,
          moderationStatus: resData.moderationStatus,
          moderationFeedback: resData.feedback
        }
      } : null);

      setShowApproveModal(false);
      setShowReturnModal(false);
    } catch (err: any) {
      alert(`Error submitting decision: ${err.message}`);
    } finally {
      setActionLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-bg flex flex-col items-center justify-center p-6">
        <div className="w-12 h-12 border-4 border-navy border-t-transparent rounded-full animate-spin mb-4"></div>
        <p className="font-serif font-bold text-navy text-lg">Loading Moderation Workspace...</p>
        <p className="text-text-muted text-sm mt-1">Verifying secure external token</p>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen bg-bg flex items-center justify-center p-6">
        <div className="card max-w-md w-full text-center p-8 border border-red-200">
          <div className="w-12 h-12 rounded-full bg-red-100 text-red-600 flex items-center justify-center mx-auto mb-4">
            <AlertCircle size={24} />
          </div>
          <h2 className="text-xl font-serif font-bold text-navy mb-2">Access Error</h2>
          <p className="text-sm text-text-muted mb-6">{error || 'This moderation link is invalid or has expired.'}</p>
          <Link to="/" className="btn-primary inline-flex items-center gap-2 text-xs">
            <ArrowLeft size={14} /> Back to MarkAI Home
          </Link>
        </div>
      </div>
    );
  }

  const { session, results } = data;
  const isFinalised = session.moderationStatus === 'APPROVED';
  const isReturned = session.moderationStatus === 'RETURNED';
  const totalOverrides = Object.keys(edits).length;

  return (
    <div className="min-h-screen bg-bg pb-20">
      {/* Top QA Navigation Bar */}
      <header className="bg-navy text-white border-b border-navy-light sticky top-0 z-40 shadow-sm">
        <div className="max-w-7xl mx-auto px-6 h-18 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-white rounded-sm flex items-center justify-center">
              <span className="text-navy font-serif font-bold text-xl">M</span>
            </div>
            <div>
              <span className="font-serif font-bold text-lg text-white">MarkAI</span>
              <span className="ml-2 text-xs uppercase tracking-widest text-gold font-semibold bg-white/10 px-2 py-0.5 rounded">
                External Moderation
              </span>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <span className={cn(
              "text-xs px-3 py-1 rounded-full font-bold uppercase tracking-wider flex items-center gap-1.5",
              isFinalised ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40" :
              isReturned ? "bg-amber-500/20 text-amber-300 border border-amber-500/40" :
              "bg-blue-500/20 text-blue-300 border border-blue-500/40"
            )}>
              {isFinalised ? <CheckCircle2 size={12} /> : <ShieldCheck size={12} />}
              {session.moderationStatus || 'UNDER_REVIEW'}
            </span>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-6 pt-8">
        {/* Session Header Card */}
        <div className="card p-6 md:p-8 mb-8 border border-border bg-surface">
          <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-6">
            <div>
              <div className="flex items-center gap-2 text-xs font-bold text-text-muted uppercase tracking-widest mb-1">
                <span>{session.subject}</span>
                <span>•</span>
                <span>{session.courseId}</span>
                <span>•</span>
                <span>{session.examBoard}</span>
              </div>
              <h1 className="text-2xl md:text-3xl font-serif font-bold text-navy mb-2">
                {session.name}
              </h1>
              <div className="flex flex-wrap items-center gap-4 text-xs text-text-muted">
                <span className="flex items-center gap-1.5">
                  <User size={13} className="text-navy" /> First Marker: <strong>{session.lecturer?.fullName}</strong> ({session.lecturer?.department || 'Faculty'})
                </span>
                <span className="flex items-center gap-1.5">
                  <BookOpen size={13} className="text-navy" /> Papers: <strong>{results?.length || 0}</strong>
                </span>
                <span className="flex items-center gap-1.5">
                  <Clock size={13} className="text-navy" /> Validity: <strong>7 Days Active</strong>
                </span>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex flex-wrap items-center gap-3">
              {!isFinalised && (
                <>
                  <button
                    onClick={() => setShowReturnModal(true)}
                    className="btn-ghost border border-border text-xs flex items-center gap-2"
                  >
                    <AlertCircle size={14} className="text-amber-600" />
                    Return with Comments
                  </button>
                  <button
                    onClick={() => setShowApproveModal(true)}
                    className="btn-primary text-xs flex items-center gap-2 bg-emerald-700 hover:bg-emerald-800"
                  >
                    <CheckCircle2 size={14} />
                    Approve & Finalise
                  </button>
                </>
              )}
              {isFinalised && (
                <div className="text-xs bg-emerald-50 text-emerald-800 border border-emerald-200 px-4 py-2.5 rounded-md flex items-center gap-2">
                  <CheckCircle2 size={16} className="text-emerald-600" />
                  <strong>Moderation Finalised:</strong> Marks have been locked and submitted to the university.
                </div>
              )}
            </div>
          </div>

          {/* Marker's note to moderator if present */}
          {session.moderatorNote && (
            <div className="mt-6 p-4 bg-navy/5 border border-navy/10 rounded-md text-xs">
              <span className="font-bold text-navy uppercase tracking-wider block mb-1">
                Note from First Marker ({session.lecturer?.fullName}):
              </span>
              <p className="text-text-main italic">{session.moderatorNote}</p>
            </div>
          )}

          {/* Moderator's return comments if returned */}
          {session.moderationFeedback && (
            <div className="mt-4 p-4 bg-amber-50 border border-amber-200 rounded-md text-xs">
              <span className="font-bold text-amber-900 uppercase tracking-wider block mb-1">
                Moderation Comments Submitted:
              </span>
              <p className="text-amber-950">{session.moderationFeedback}</p>
            </div>
          )}
        </div>

        {/* Quality Assurance Instructions */}
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h2 className="text-xl font-serif font-bold text-navy">Student Papers & Overrides</h2>
            <p className="text-xs text-text-muted">
              Review AI marks alongside marker awards. Enter any override mark to update candidate records instantly.
            </p>
          </div>
          <div className="text-xs font-semibold text-text-muted bg-surface border border-border px-3 py-1.5 rounded">
            Active Overrides: <span className="text-navy font-bold">{totalOverrides}</span>
          </div>
        </div>

        {/* Candidate List */}
        <div className="space-y-4">
          {results.map((student: any, idx: number) => {
            const isExpanded = expandedStudent === student.id;
            const studentOverridesCount = student.questions?.filter(
              (q: any) => edits[q.id]?.mark !== undefined || q.lecturerOverride !== null
            ).length;

            return (
              <div 
                key={student.id} 
                className="card border border-border bg-surface transition-all overflow-hidden"
              >
                {/* Accordion Header */}
                <div 
                  onClick={() => setExpandedStudent(isExpanded ? null : student.id)}
                  className="p-5 flex flex-col md:flex-row md:items-center justify-between gap-4 cursor-pointer hover:bg-bg/40 transition-colors"
                >
                  <div className="flex items-center gap-4">
                    <div className="w-8 h-8 rounded-full bg-navy/5 text-navy font-bold text-xs flex items-center justify-center border border-border">
                      {idx + 1}
                    </div>
                    <div>
                      <h3 className="font-bold text-navy text-sm flex items-center gap-2">
                        {student.studentName || `Student ${student.studentCode || idx + 1}`}
                        {student.studentCode && (
                          <span className="text-xs font-mono text-text-muted bg-bg px-2 py-0.5 rounded">
                            {student.studentCode}
                          </span>
                        )}
                      </h3>
                      <p className="text-xs text-text-muted">
                        {student.questions?.length || 0} Questions Evaluated
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-6">
                    {studentOverridesCount > 0 && (
                      <span className="badge bg-gold-pale text-gold font-bold text-xs">
                        {studentOverridesCount} Overrides
                      </span>
                    )}
                    <div className="text-right">
                      <div className="text-sm font-bold text-navy">
                        {student.totalMarks} / {student.maxMarks}
                        <span className="text-xs font-normal text-text-muted ml-1.5">
                          ({student.percentage}%)
                        </span>
                      </div>
                      <span className="badge bg-navy text-white text-[10px] px-2 py-0.5">
                        Grade {student.grade}
                      </span>
                    </div>

                    <div className="text-text-muted">
                      {isExpanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                    </div>
                  </div>
                </div>

                {/* Expanded Question Breakdown */}
                {isExpanded && (
                  <div className="border-t border-border bg-bg/20 p-5 space-y-4">
                    <div className="flex justify-between items-center pb-2 border-b border-border/60">
                      <h4 className="text-xs font-bold text-navy uppercase tracking-wider">
                        Question-by-Question Moderation
                      </h4>
                      {student.answerPdfUrl && (
                        <a 
                          href={student.answerPdfUrl} 
                          target="_blank" 
                          rel="noreferrer"
                          className="text-xs text-navy font-bold hover:underline inline-flex items-center gap-1"
                        >
                          <FileText size={13} /> View Original Submission PDF <ExternalLink size={11} />
                        </a>
                      )}
                    </div>

                    <div className="space-y-3">
                      {student.questions?.map((q: any) => {
                        const currentEdit = edits[q.id];
                        const aiMark = q.marksAwarded;
                        const originalMarkerMark = q.lecturerOverride ?? q.marksAwarded;
                        const moderatorMark = currentEdit?.mark ?? originalMarkerMark;
                        const moderatorNote = currentEdit?.note ?? (q.lecturerNote?.startsWith('Moderator:') ? q.lecturerNote.replace('Moderator:', '').trim() : '');
                        const isSaving = savingQuestionId === q.id;
                        const isSaved = savedSuccessId === q.id;

                        return (
                          <div 
                            key={q.id}
                            className="p-4 rounded-md border border-border bg-surface text-xs"
                          >
                            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-3">
                              <div className="flex items-center gap-2">
                                <span className="font-bold text-navy text-sm">
                                  {q.questionNumber}
                                </span>
                                <span className="badge bg-bg text-text-muted text-[11px]">
                                  {q.topic}
                                </span>
                                <span className="text-text-muted">
                                  Max: {q.marksAvailable} marks
                                </span>
                              </div>

                              {/* Marks Comparison Pill */}
                              <div className="flex items-center gap-3">
                                <div className="flex items-center gap-2 bg-bg px-3 py-1.5 rounded border border-border">
                                  <div className="text-center">
                                    <span className="block text-[10px] text-text-muted uppercase">AI</span>
                                    <span className="font-mono font-bold text-navy">{aiMark}</span>
                                  </div>
                                  <span className="text-border">|</span>
                                  <div className="text-center">
                                    <span className="block text-[10px] text-text-muted uppercase">Marker</span>
                                    <span className="font-mono font-bold text-navy">{originalMarkerMark}</span>
                                  </div>
                                  <span className="text-border">|</span>
                                  <div className="text-center">
                                    <span className="block text-[10px] text-gold uppercase font-bold">Moderator</span>
                                    <input 
                                      type="number"
                                      min="0"
                                      max={q.marksAvailable}
                                      disabled={isFinalised}
                                      value={moderatorMark}
                                      onChange={(e) => handleMarkChange(q.id, Number(e.target.value), originalMarkerMark)}
                                      className="w-12 h-6 text-center font-mono font-bold border border-gold/40 rounded bg-gold-pale/30 text-navy focus:outline-none focus:ring-1 focus:ring-gold"
                                    />
                                  </div>
                                </div>

                                {!isFinalised && (
                                  <button
                                    onClick={() => saveOverride(q.id, moderatorMark)}
                                    disabled={isSaving}
                                    className="btn-primary text-[11px] h-8 px-3 flex items-center gap-1.5"
                                  >
                                    {isSaving ? <Loader2 size={12} className="animate-spin" /> : 
                                     isSaved ? <Check size={12} className="text-emerald-300" /> : 
                                     <Save size={12} />}
                                    {isSaved ? 'Saved' : 'Save'}
                                  </button>
                                )}
                              </div>
                            </div>

                            {/* Question Details / Feedback */}
                            {q.questionText && (
                              <div className="mb-2 text-text-muted italic bg-bg/50 p-2 rounded">
                                <span className="font-bold not-italic">Question: </span>{q.questionText}
                              </div>
                            )}

                            {q.aiFeedback && (
                              <div className="mb-3 text-text-main">
                                <span className="font-bold text-navy">AI Feedback: </span>{q.aiFeedback}
                              </div>
                            )}

                            {/* Moderator Override Note Input */}
                            <div className="mt-2">
                              <input 
                                type="text"
                                placeholder="Moderator rationale / comment on mark adjustment (optional)..."
                                disabled={isFinalised}
                                value={moderatorNote}
                                onChange={(e) => handleNoteChange(q.id, e.target.value, moderatorMark)}
                                className="input-field text-xs w-full py-1.5 px-3 bg-bg/30"
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </main>

      {/* Approve Modal */}
      <AnimatePresence>
        {showApproveModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
            <motion.div 
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="card max-w-md w-full p-6 border border-border bg-surface"
            >
              <div className="w-10 h-10 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center mb-4">
                <Award size={22} />
              </div>
              <h3 className="text-lg font-serif font-bold text-navy mb-2">
                Approve & Finalise Moderation
              </h3>
              <p className="text-xs text-text-muted mb-4 leading-relaxed">
                By approving, all current marks (including your overrides) will be formally ratified. The primary marker ({session.lecturer?.fullName}) will be notified and final results will be ready for student release.
              </p>
              <div className="p-3 bg-bg rounded mb-6 text-xs text-text-muted">
                <strong>Session:</strong> {session.name}<br/>
                <strong>Total Overrides:</strong> {totalOverrides} adjusted mark(s)
              </div>
              <div className="flex justify-end gap-3">
                <button 
                  onClick={() => setShowApproveModal(false)}
                  className="btn-ghost text-xs border border-border"
                >
                  Cancel
                </button>
                <button 
                  onClick={() => handleDecision('APPROVE')}
                  disabled={actionLoading}
                  className="btn-primary text-xs bg-emerald-700 hover:bg-emerald-800 flex items-center gap-1.5"
                >
                  {actionLoading ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={13} />}
                  Confirm Approval
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Return Modal */}
      <AnimatePresence>
        {showReturnModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
            <motion.div 
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="card max-w-md w-full p-6 border border-border bg-surface"
            >
              <div className="w-10 h-10 rounded-full bg-amber-100 text-amber-600 flex items-center justify-center mb-4">
                <AlertCircle size={22} />
              </div>
              <h3 className="text-lg font-serif font-bold text-navy mb-2">
                Return Session to Marker
              </h3>
              <p className="text-xs text-text-muted mb-3 leading-relaxed">
                Provide constructive feedback explaining why the session is being returned (e.g. strictness inconsistencies, discrepancy on specific questions).
              </p>
              <textarea 
                rows={4}
                value={returnFeedback}
                onChange={(e) => setReturnFeedback(e.target.value)}
                placeholder="Enter feedback and instructions for the marker..."
                className="input-field text-xs w-full mb-6 p-3"
              />
              <div className="flex justify-end gap-3">
                <button 
                  onClick={() => setShowReturnModal(false)}
                  className="btn-ghost text-xs border border-border"
                >
                  Cancel
                </button>
                <button 
                  onClick={() => handleDecision('RETURN')}
                  disabled={actionLoading || !returnFeedback.trim()}
                  className="btn-primary text-xs bg-amber-600 hover:bg-amber-700 flex items-center gap-1.5"
                >
                  {actionLoading ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
                  Submit & Return
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
