import React, { useState, useRef, useEffect } from 'react';
import { DashboardLayout } from '@/src/components/DashboardLayout';
import { 
  Upload, FileText, Check, ArrowRight, X, Zap, 
  Loader2, Plus, Trash2, LayoutGrid, Users 
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation } from '@tanstack/react-query';
import { cn } from '@/src/lib/utils';

// Helper to prompt for AI OCR
const callAI = async (prompt: string, context?: object) => {
  const token = localStorage.getItem('markai_token');
  const res = await fetch('/api/ai/generate', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({ prompt, context })
  });
  const data = await res.json();
  return data.text;
};

const NewSessionPage = () => {
  const [step, setStep] = useState(1);
  const navigate = useNavigate();
  const [markingSessionId, setMarkingSessionId] = useState<string | null>(null);

  // Form State
  const [formData, setFormData] = useState({
    name: '',
    subject: '',
    sessionType: '',
    examBoard: '',
    courseId: '',
    classId: '',
    markingStrictness: 'Standard' as 'Strict' | 'Standard' | 'Lenient',
    feedbackDetail: 'Detailed' as 'Brief' | 'Detailed',
    questionPdf: null as { url: string; text: string; name: string } | null,
    markSchemePdf: null as { url: string; text: string; name: string } | null,
    students: [] as { 
      studentId: string; 
      studentName: string; 
      pdfUrl: string; 
      extractedText: string; 
      extractMethod: string;
      status: 'PENDING' | 'UPLOADING' | 'COMPLETE' | 'ERROR';
      fileName?: string;
    }[]
  });

  // Queries
  const { data: classes } = useQuery({
    queryKey: ['classes'],
    queryFn: () => fetch('/api/classes', {
      headers: { 'Authorization': `Bearer ${localStorage.getItem('markai_token')}` }
    }).then(res => res.json())
  });

  const { data: classStudents } = useQuery({
    queryKey: ['classStudents', formData.classId],
    queryFn: () => fetch(`/api/classes/${formData.classId}/students`, {
      headers: { 'Authorization': `Bearer ${localStorage.getItem('markai_token')}` }
    }).then(res => res.json()),
    enabled: !!formData.classId
  });

  // Effect: Pre-populate students when class is selected
  useEffect(() => {
    if (classStudents && classStudents.length > 0) {
      setFormData(prev => ({
        ...prev,
        students: classStudents.map((s: any) => ({
          studentId: s.studentCode || s.id,
          studentName: s.name,
          pdfUrl: '',
          extractedText: '',
          extractMethod: 'pdf-parse',
          status: 'PENDING'
        }))
      }));
    }
  }, [classStudents]);

  // Upload Logic
  const uploadFileMutation = useMutation({
    mutationFn: async (file: File) => {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch('/api/upload/answer-pdf', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${localStorage.getItem('markai_token')}` },
        body: fd
      });
      if (!res.ok) throw new Error('Upload failed');
      return res.json();
    }
  });

  const handleMaterialUpload = async (file: File, type: 'question' | 'markscheme') => {
    try {
      const data = await uploadFileMutation.mutateAsync(file);
      setFormData(prev => ({
        ...prev,
        [type === 'question' ? 'questionPdf' : 'markSchemePdf']: {
          url: data.fileUrl,
          text: data.text,
          name: file.name
        }
      }));
    } catch (e) {
      console.error(e);
    }
  };

  const handleStudentUpload = async (file: File, index: number) => {
    // Update status to uploading
    setFormData(prev => ({
      ...prev,
      students: prev.students.map((s, i) => i === index ? { ...s, status: 'UPLOADING' } : s)
    }));

    try {
      const data = await uploadFileMutation.mutateAsync(file);
      setFormData(prev => ({
        ...prev,
        students: prev.students.map((s, i) => i === index ? {
          ...s,
          pdfUrl: data.fileUrl,
          extractedText: data.text,
          extractMethod: data.method,
          status: 'COMPLETE',
          fileName: file.name
        } : s)
      }));
    } catch (e) {
      setFormData(prev => ({
        ...prev,
        students: prev.students.map((s, i) => i === index ? { ...s, status: 'ERROR' } : s)
      }));
    }
  };

  const handleAddStudent = () => {
    setFormData(prev => ({
      ...prev,
      students: [...prev.students, {
        studentId: '',
        studentName: '',
        pdfUrl: '',
        extractedText: '',
        extractMethod: 'pdf-parse',
        status: 'PENDING'
      }]
    }));
  };

  // Marking Polling
  const { data: progress } = useQuery({
    queryKey: ['markingProgress', markingSessionId],
    queryFn: () => fetch(`/api/sessions/${markingSessionId}/progress`, {
      headers: { 'Authorization': `Bearer ${localStorage.getItem('markai_token')}` }
    }).then(res => res.json()),
    enabled: !!markingSessionId,
    refetchInterval: (query) => {
      const data = query.state.data;
      return data?.status === 'COMPLETE' ? false : 3000;
    }
  });

  useEffect(() => {
    if (progress?.status === 'COMPLETE') {
      navigate(`/lecturer/sessions/${markingSessionId}`);
    }
  }, [progress, markingSessionId, navigate]);

  const handleStartMarking = async () => {
    try {
      // 1. Create Session
      const sessionRes = await fetch('/api/sessions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('markai_token')}`
        },
        body: JSON.stringify({
          name: formData.name,
          subject: formData.subject,
          sessionType: formData.sessionType,
          examBoard: formData.examBoard,
          courseId: formData.courseId,
          classId: formData.classId || undefined,
          questionPdfUrl: formData.questionPdf?.url,
          markSchemePdfUrl: formData.markSchemePdf?.url,
          markingStrictness: formData.markingStrictness,
          feedbackDetail: formData.feedbackDetail
        })
      });
      const session = await sessionRes.json();

      // 2. Save Answer Sheets
      await fetch(`/api/sessions/${session.id}/answer-sheets`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('markai_token')}`
        },
        body: JSON.stringify({
          students: formData.students
            .filter(s => s.status === 'COMPLETE')
            .map(s => ({
              studentId: s.studentId,
              studentName: s.studentName,
              extractedText: s.extractedText,
              pdfUrl: s.pdfUrl,
              extractMethod: s.extractMethod
            }))
        })
      });

      // 3. Start Marking
      await fetch(`/api/sessions/${session.id}/mark`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('markai_token')}`
        },
        body: JSON.stringify({
          questionPdfText: formData.questionPdf?.text,
          markSchemeText: formData.markSchemePdf?.text
        })
      });

      setMarkingSessionId(session.id);
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <DashboardLayout>
      <div className="max-w-5xl mx-auto px-4 py-8">
        {/* Progress Header */}
        <div className="mb-12">
          <div className="flex justify-between items-center mb-8">
            <div>
              <h1 className="text-3xl font-serif font-bold text-navy">New Marking Session</h1>
              <p className="text-text-muted mt-2">Set up your exam, upload materials, and start AI evaluation.</p>
            </div>
            <div className="hidden md:flex gap-2">
              {[1, 2, 3, 4].map(i => (
                <div key={i} className={cn(
                  "w-3 h-3 rounded-full",
                  step >= i ? "bg-accent" : "bg-border"
                )} />
              ))}
            </div>
          </div>

          <div className="flex border-b border-border">
            {['Session Details', 'Materials', 'Student Papers', 'Confirm'].map((label, i) => (
              <button 
                key={i}
                disabled={step < i + 1}
                onClick={() => setStep(i + 1)}
                className={cn(
                  "px-6 py-4 text-sm font-bold uppercase tracking-widest border-b-2 transition-all",
                  step === i + 1 ? "border-accent text-navy" : "border-transparent text-text-muted hover:text-navy"
                )}
              >
                Step {i + 1}: {label}
              </button>
            ))}
          </div>
        </div>

        <div className="min-h-[500px]">
          <AnimatePresence mode="wait">
            {step === 1 && (
              <motion.div 
                key="step1"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                className="grid grid-cols-1 md:grid-cols-2 gap-12"
              >
                <div className="space-y-6">
                  <div className="card p-8">
                    <h2 className="text-xl font-bold text-navy mb-6">Basic Information</h2>
                    <div className="space-y-4">
                      <div>
                        <label className="label">Session Name</label>
                        <input 
                          type="text" 
                          className="input" 
                          placeholder="e.g. Unit 4 Final Exam"
                          value={formData.name}
                          onChange={e => setFormData({ ...formData, name: e.target.value })}
                        />
                      </div>
                      <div>
                        <label className="label">Subject</label>
                        <input 
                          type="text" 
                          className="input" 
                          placeholder="Mathematics, Biology, etc."
                          value={formData.subject}
                          onChange={e => setFormData({ ...formData, subject: e.target.value })}
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <label className="label">Session Type</label>
                          <select 
                            className="input"
                            value={formData.sessionType}
                            onChange={e => setFormData({ ...formData, sessionType: e.target.value })}
                          >
                            <option value="">Select...</option>
                            <option value="CA">CA</option>
                            <option value="Mid Term">Mid Term</option>
                            <option value="Semester">Semester</option>
                          </select>
                        </div>
                        <div>
                          <label className="label">Exam Board</label>
                          <select 
                            className="input"
                            value={formData.examBoard}
                            onChange={e => setFormData({ ...formData, examBoard: e.target.value })}
                          >
                            <option value="">Select...</option>
                            <optgroup label="Local">
                              <option value="UGC">UGC</option>
                              <option value="QAAC">QAAC</option>
                            </optgroup>
                            <optgroup label="International">
                              <option value="Cambridge">Cambridge</option>
                              <option value="Edexcel">Edexcel</option>
                              <option value="IB">IB</option>
                              <option value="AQA">AQA</option>
                              <option value="OCR">OCR</option>
                            </optgroup>
                          </select>
                        </div>
                      </div>
                      <div>
                        <label className="label">Course ID</label>
                        <input 
                          type="text" 
                          className="input" 
                          placeholder="e.g. BIO-101"
                          value={formData.courseId}
                          onChange={e => setFormData({ ...formData, courseId: e.target.value })}
                        />
                      </div>
                    </div>
                  </div>
                </div>

                <div className="space-y-6">
                  <div className="card p-8">
                    <h2 className="text-xl font-bold text-navy mb-6">Target Class</h2>
                    <div className="space-y-4">
                      <p className="text-sm text-text-muted">Select a class to automatically load student names and IDs.</p>
                      <select 
                        className="input"
                        value={formData.classId}
                        onChange={e => setFormData({ ...formData, classId: e.target.value })}
                      >
                        <option value="">-- No Class (Manual Entry) --</option>
                        {classes?.map((c: any) => (
                          <option key={c.id} value={c.id}>{c.name}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <div className="flex justify-end pt-4">
                    <button 
                      onClick={() => setStep(2)}
                      disabled={!formData.name || !formData.subject || !formData.sessionType || !formData.courseId}
                      className="btn-primary flex items-center gap-2 disabled:opacity-50"
                    >
                      Step 2: Upload Materials <ArrowRight size={18} />
                    </button>
                  </div>
                </div>
              </motion.div>
            )}

            {step === 2 && (
              <motion.div 
                key="step2"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                className="max-w-2xl mx-auto"
              >
                <div className="card p-12 text-center space-y-12">
                   <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                      <div className="space-y-4">
                        <h3 className="text-navy font-bold flex items-center justify-center gap-2">
                          <FileText size={20} className="text-accent" /> Question Paper
                        </h3>
                        <div 
                          className={cn(
                            "border-2 border-dashed rounded-xl p-8 transition-all cursor-pointer",
                            formData.questionPdf ? "border-green-500 bg-green-50" : "border-border hover:border-accent"
                          )}
                          onClick={() => document.getElementById('qp-upload')?.click()}
                        >
                          <input type="file" id="qp-upload" hidden accept=".pdf" onChange={e => e.target.files && handleMaterialUpload(e.target.files[0], 'question')} />
                          {formData.questionPdf ? (
                            <div className="text-green-600 space-y-1">
                              <Check size={32} className="mx-auto" />
                              <p className="text-sm font-bold truncate">{formData.questionPdf.name}</p>
                            </div>
                          ) : (
                            <div className="text-text-muted">
                              <Upload size={32} className="mx-auto mb-2 opacity-50" />
                              <p className="text-xs font-bold uppercase tracking-widest">Click to upload</p>
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="space-y-4">
                        <h3 className="text-navy font-bold flex items-center justify-center gap-2">
                          <Zap size={20} className="text-accent" /> Mark Scheme
                        </h3>
                        <div 
                          className={cn(
                            "border-2 border-dashed rounded-xl p-8 transition-all cursor-pointer",
                            formData.markSchemePdf ? "border-green-500 bg-green-50" : "border-border hover:border-accent"
                          )}
                          onClick={() => document.getElementById('ms-upload')?.click()}
                        >
                          <input type="file" id="ms-upload" hidden accept=".pdf" onChange={e => e.target.files && handleMaterialUpload(e.target.files[0], 'markscheme')} />
                          {formData.markSchemePdf ? (
                            <div className="text-green-600 space-y-1">
                              <Check size={32} className="mx-auto" />
                              <p className="text-sm font-bold truncate">{formData.markSchemePdf.name}</p>
                            </div>
                          ) : (
                            <div className="text-text-muted">
                              <Upload size={32} className="mx-auto mb-2 opacity-50" />
                              <p className="text-xs font-bold uppercase tracking-widest">Click to upload</p>
                            </div>
                          )}
                        </div>
                      </div>
                   </div>

                   <div className="flex gap-4 pt-8 border-t border-border">
                     <button onClick={() => setStep(1)} className="btn-ghost flex-1">Back</button>
                     <button 
                        onClick={() => setStep(3)} 
                        disabled={!formData.questionPdf || !formData.markSchemePdf}
                        className="btn-primary flex-1 flex items-center justify-center gap-2 disabled:opacity-50"
                      >
                       Step 3: Student Papers <ArrowRight size={18} />
                     </button>
                   </div>
                </div>
              </motion.div>
            )}

            {step === 3 && (
              <motion.div 
                key="step3"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                className="space-y-8"
              >
                <div className="flex justify-between items-center">
                  <h2 className="text-xl font-bold text-navy flex items-center gap-2">
                    <Users size={24} className="text-accent" /> 
                    Student Answer Sheets ({formData.students.length})
                  </h2>
                  <button onClick={handleAddStudent} className="btn-ghost text-xs flex items-center gap-1">
                    <Plus size={14} /> Add Student
                  </button>
                </div>

                <div className="card overflow-hidden">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-bg border-b border-border">
                        <th className="px-6 py-4 text-[10px] uppercase tracking-widest font-bold text-text-muted">Student ID</th>
                        <th className="px-6 py-4 text-[10px] uppercase tracking-widest font-bold text-text-muted">Name</th>
                        <th className="px-6 py-4 text-[10px] uppercase tracking-widest font-bold text-text-muted">Answer Sheet</th>
                        <th className="px-6 py-4 text-[10px] uppercase tracking-widest font-bold text-text-muted text-right">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {formData.students.map((student, idx) => (
                        <tr key={idx} className="border-b border-border group">
                          <td className="px-6 py-4">
                            <input 
                              type="text" 
                              className="bg-transparent border-none focus:ring-0 text-sm font-bold text-navy p-0 w-full"
                              placeholder="STU-001"
                              value={student.studentId}
                              onChange={e => {
                                const newStudents = [...formData.students];
                                newStudents[idx].studentId = e.target.value;
                                setFormData({ ...formData, students: newStudents });
                              }}
                            />
                          </td>
                          <td className="px-6 py-4">
                            <input 
                              type="text" 
                              className="bg-transparent border-none focus:ring-0 text-sm text-text-muted p-0 w-full"
                              placeholder="Name"
                              value={student.studentName}
                              onChange={e => {
                                const newStudents = [...formData.students];
                                newStudents[idx].studentName = e.target.value;
                                setFormData({ ...formData, students: newStudents });
                              }}
                            />
                          </td>
                          <td className="px-6 py-4">
                            <div className="flex items-center gap-3">
                              <button 
                                onClick={() => document.getElementById(`stu-upload-${idx}`)?.click()}
                                className={cn(
                                  "p-2 rounded-lg transition-all",
                                  student.status === 'COMPLETE' ? "bg-green-100 text-green-600" : "bg-bg text-text-muted hover:text-navy"
                                )}
                              >
                                {student.status === 'UPLOADING' ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
                              </button>
                              <input 
                                type="file" 
                                id={`stu-upload-${idx}`} 
                                hidden 
                                accept=".pdf" 
                                onChange={e => e.target.files && handleStudentUpload(e.target.files[0], idx)} 
                              />
                              {student.status === 'COMPLETE' && (
                                <div className="text-[10px] space-y-0.5">
                                  <p className="font-bold text-navy truncate max-w-[120px]">{student.fileName}</p>
                                  <span className={cn(
                                    "px-1.5 py-0.5 rounded text-[8px] font-bold uppercase",
                                    student.extractMethod === 'gemini-vision' ? "bg-blue-100 text-blue-600" : "bg-green-100 text-green-600"
                                  )}>
                                    {student.extractMethod === 'gemini-vision' ? '🤖 AI OCR' : '📄 Text'}
                                  </span>
                                </div>
                              )}
                            </div>
                          </td>
                          <td className="px-6 py-4 text-right">
                             <button 
                              onClick={() => {
                                const newStudents = formData.students.filter((_, i) => i !== idx);
                                setFormData({ ...formData, students: newStudents });
                              }}
                              className="text-text-muted opacity-0 group-hover:opacity-100 hover:text-red-500 transition-all"
                             >
                               <Trash2 size={14} />
                             </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="flex justify-between items-center pt-8 border-t border-border">
                  <button onClick={() => setStep(2)} className="btn-ghost">Back</button>
                  <button 
                    onClick={() => setStep(4)} 
                    disabled={formData.students.filter(s => s.status === 'COMPLETE').length === 0}
                    className="btn-primary flex items-center gap-2 disabled:opacity-50"
                  >
                    Step 4: Confirm & Start <ArrowRight size={18} />
                  </button>
                </div>
              </motion.div>
            )}

            {step === 4 && (
              <motion.div 
                key="step4"
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 1.05 }}
                className="max-w-2xl mx-auto"
              >
                <div className="card p-12 space-y-8 relative overflow-hidden">
                   {/* Background Glow */}
                   <div className="absolute top-0 right-0 w-64 h-64 bg-accent/10 rounded-full blur-3xl -mr-32 -mt-32" />

                   <h2 className="text-2xl font-bold text-navy">Final Confirmation</h2>
                   
                   <div className="grid grid-cols-2 gap-8 text-sm">
                      <div className="space-y-4">
                        <div>
                          <p className="text-[10px] uppercase tracking-widest font-bold text-text-muted">Exam Details</p>
                          <p className="text-navy font-bold">{formData.name}</p>
                          <p className="text-text-muted">{formData.subject} • {formData.sessionType} • {formData.courseId}</p>
                        </div>
                        <div>
                          <p className="text-[10px] uppercase tracking-widest font-bold text-text-muted">Materials</p>
                          <p className="text-navy font-medium flex items-center gap-2"><Check size={14} className="text-green-500" /> Question Paper</p>
                          <p className="text-navy font-medium flex items-center gap-2"><Check size={14} className="text-green-500" /> Mark Scheme</p>
                        </div>
                      </div>
                      <div className="space-y-4">
                        <div>
                          <p className="text-[10px] uppercase tracking-widest font-bold text-text-muted">Students</p>
                          <p className="text-3xl font-serif font-bold text-navy">{formData.students.filter(s => s.status === 'COMPLETE').length}</p>
                          <p className="text-text-muted">Answer sheets uploaded</p>
                        </div>
                        <div>
                           <p className="text-[10px] uppercase tracking-widest font-bold text-text-muted">Strictness</p>
                           <div className="flex gap-2 mt-1">
                             {['Strict', 'Standard', 'Lenient'].map(s => (
                               <button 
                                key={s}
                                onClick={() => setFormData({...formData, markingStrictness: s as any})}
                                className={cn(
                                  "px-2 py-1 rounded text-[10px] font-bold border transition-all",
                                  formData.markingStrictness === s ? "bg-navy text-white border-navy" : "bg-white text-text-muted border-border"
                                )}
                               >
                                 {s}
                               </button>
                             ))}
                           </div>
                        </div>
                      </div>
                   </div>

                   <div className="pt-8 border-t border-border flex gap-4">
                     <button onClick={() => setStep(3)} className="btn-ghost flex-1">Back</button>
                     <button onClick={handleStartMarking} className="btn-accent flex-1 flex items-center justify-center gap-2 shadow-lg shadow-accent/20">
                       <Zap size={18} fill="currentColor" /> Start AI Marking
                     </button>
                   </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* Marking Overlay */}
      <AnimatePresence>
        {markingSessionId && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="fixed inset-0 z-50 bg-navy/95 flex items-center justify-center p-8 backdrop-blur-sm"
          >
            <div className="max-w-md w-full text-center space-y-8">
              <div className="relative inline-block">
                <div className="w-24 h-24 border-4 border-accent/20 rounded-full flex items-center justify-center">
                  <div className="w-16 h-16 border-4 border-accent border-t-transparent rounded-full animate-spin" />
                </div>
                <Zap className="absolute inset-0 m-auto text-accent animate-pulse" size={32} fill="currentColor" />
              </div>
              
              <div className="space-y-2">
                <h2 className="text-2xl font-bold text-white">Gemini is marking papers...</h2>
                <p className="text-white/60">Using AI to evaluate {progress?.total || 0} student submissions.</p>
              </div>

              <div className="bg-white/5 rounded-2xl p-6 space-y-4">
                <div className="flex justify-between items-center text-sm font-bold uppercase tracking-widest text-white/40">
                  <span>Progress</span>
                  <span className="text-accent">{progress?.completed || 0} / {progress?.total || 0}</span>
                </div>
                <div className="h-2 bg-white/10 rounded-full overflow-hidden">
                  <motion.div 
                    initial={{ width: 0 }}
                    animate={{ width: `${((progress?.completed || 0) / (progress?.total || 1)) * 100}%` }}
                    className="h-full bg-accent"
                  />
                </div>
                {progress?.currentStudentName && (
                  <p className="text-xs text-white/40 animate-pulse">
                    Currently Marking: <span className="text-white font-bold">{progress.currentStudentName}</span>
                  </p>
                )}
              </div>

              <div className="flex items-center justify-center gap-2 text-white/40 text-sm">
                <Loader2 size={16} className="animate-spin" />
                <span>Estimated time remaining: ~{progress?.estimatedSecondsRemaining || 0} seconds</span>
              </div>

              <p className="text-[10px] text-white/20 uppercase tracking-widest pt-8">Please do not close this window</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </DashboardLayout>
  );
};

export default NewSessionPage;
