import React, { useState, useRef, useEffect } from 'react';
import { DashboardLayout } from '@/src/components/DashboardLayout';
import { 
  Upload, FileText, Check, ArrowRight, X, Zap, 
  Loader2, Plus, Trash2, LayoutGrid, Users,
  CheckCircle2, AlertCircle, TrendingUp, Target, Award, Calendar, ChevronRight, ArrowUpRight, BarChart2,
  Sparkles, BookOpen, Hash, Clock, Layers, Globe
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { cn } from '@/src/lib/utils';
import { safeGetItem } from '../lib/storage';
import { apiFetch } from '../lib/api';

const NewSessionPage = () => {
  const navigate = useNavigate();
  const [currentStep, setCurrentStep] = useState(1);
  const [isBulkMode, setIsBulkMode] = useState(false);

  // Step 1 data
  const [sessionDetails, setSessionDetails] = useState({
    name: '',
    subject: '',
    sessionType: '',
    examBoard: '',
    courseId: '',
    paperType: 'Theory'
  });

  // Step 2 data
  const [questionPaper, setQuestionPaper] = useState<{
    file: File | null;
    fileUrl: string;
    textUrl: string;
    extractedText: string;
    uploading: boolean;
    uploaded: boolean;
  }>({ file: null, fileUrl: '', textUrl: '', extractedText: '', uploading: false, uploaded: false });

  const [markScheme, setMarkScheme] = useState<{
    file: File | null;
    fileUrl: string;
    textUrl: string;
    extractedText: string;
    uploading: boolean;
    uploaded: boolean;
  }>({ file: null, fileUrl: '', textUrl: '', extractedText: '', uploading: false, uploaded: false });

  // Step 3 data
  const [studentSheets, setStudentSheets] = useState<{
    studentId: string;
    studentName: string;
    file: File | null;
    fileUrl: string;
    extractedText: string;
    extractMethod: string;
    uploading: boolean;
    uploaded: boolean;
    previewOpen: boolean;
  }[]>([]);

  // Step 4 data
  const [markingStrictness, setMarkingStrictness] = useState('Standard');
  const [feedbackDetail, setFeedbackDetail] = useState('Detailed');
  const [isMarking, setIsMarking] = useState(false);
  const [markingProgress, setMarkingProgress] = useState({
    total: 0, 
    completed: 0,
    currentStudentId: '', 
    currentStudentName: '',
    estimatedSecondsRemaining: 0,
    status: 'PENDING'
  });
  const [sessionId, setSessionId] = useState('');

  // Errors
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Student sheets initialization
  useEffect(() => {
    if (studentSheets.length === 0) {
      setStudentSheets([{
        studentId: '', studentName: '', file: null, fileUrl: '',
        extractedText: '', extractMethod: 'pdf-parse',
        uploading: false, uploaded: false, previewOpen: false
      }]);
    }
  }, []);

  const generateSessionName = () => {
    const { subject, sessionType, examBoard, courseId } = sessionDetails;
    if (!subject || !sessionType) return '';
    const year = new Date().getFullYear();
    const parts = [
      subject,
      sessionType,
      courseId ? `— ${courseId}` : '',
      examBoard ? `(${examBoard})` : '',
      year
    ].filter(Boolean);
    return parts.join(' ');
  };

  useEffect(() => {
    const generatedName = generateSessionName();
    setSessionDetails(prev => ({ ...prev, name: generatedName }));
  }, [
    sessionDetails.subject,
    sessionDetails.sessionType,
    sessionDetails.examBoard,
    sessionDetails.courseId
  ]);

  // --- Handlers ---

  const handleFileUpload = async (
    file: File,
    setter: (val: any) => void
  ) => {
    if (file.type !== 'application/pdf') {
      alert('Only PDF files are allowed');
      return;
    }
    if (file.size > 20 * 1024 * 1024) {
      alert('File size must be under 20MB');
      return;
    }

    setter((prev: any) => ({ ...prev, file, uploading: true }));

    const formData = new FormData();
    formData.append('file', file);

    try {
      const res = await apiFetch('/api/upload/answer-pdf', {
        method: 'POST',
        body: formData
      });
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Upload failed');
      }


      setter((prev: any) => ({
        ...prev,
        fileUrl: data.fileUrl,
        textUrl: data.textUrl,
        extractedText: data.text,
        uploading: false,
        uploaded: true
      }));
    } catch (error: any) {
      setter((prev: any) => ({ ...prev, uploading: false }));
      alert(`Upload failed: ${error.message || 'Please try again.'}`);
    }
  };

  const handleStudentFileUpload = async (file: File, index: number) => {
    if (file.type !== 'application/pdf') {
       alert('Only PDF files are allowed');
       return;
    }
    
    setStudentSheets(prev => prev.map((s, i) => i === index ? { ...s, uploading: true } : s));

    const formData = new FormData();
    formData.append('file', file);

    try {
      const res = await apiFetch('/api/upload/answer-pdf', {
        method: 'POST',
        body: formData
      });
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Upload failed');
      }


      setStudentSheets(prev => prev.map((s, i) => i === index ? {
        ...s,
        file: file,
        fileUrl: data.fileUrl,
        extractedText: data.text,
        extractMethod: data.method,
        uploading: false,
        uploaded: true
      } : s));
    } catch (error: any) {
      setStudentSheets(prev => prev.map((s, i) => i === index ? { ...s, uploading: false } : s));
      alert(`Upload failed: ${error.message || 'Please try again.'}`);
    }
  };

  const startProgressPolling = (id: string) => {
    const interval = setInterval(async () => {
      if (!id || id === 'undefined') {
        clearInterval(interval);
        return;
      }
      const res = await apiFetch(`/api/sessions/${id}/progress`);
      if (!res.ok) return; // Silent skip if polling fails once
      const data = await res.json();
      setMarkingProgress(data);

      if (data.status === 'COMPLETE') {
        clearInterval(interval);
        const target = `/lecturer/sessions/${id}`;
        if (window.location.pathname !== target) {
          setTimeout(() => navigate(target, { replace: true }), 1000);
        }
      }

    }, 3000);
  };

  const handleStartMarking = async () => {
    setIsMarking(true);

    try {
      // 1. Create session
      const payload = {
        ...sessionDetails,
        paperType: sessionDetails.paperType,
        questionPdfUrl: questionPaper.fileUrl || '',
        markSchemePdfUrl: markScheme.fileUrl || '',
        questionTextUrl: questionPaper.textUrl || '',
        markSchemeTextUrl: markScheme.textUrl || '',
        markingStrictness,
        feedbackDetail,
        status: 'PENDING'
      };
      
      console.log('Creating session with payload:', payload);

      const sessionRes = await apiFetch('/api/sessions', {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      if (!sessionRes.ok) {
        const errData = await sessionRes.json();
        throw new Error(errData.error || 'Failed to create session');
      }
      const session = await sessionRes.json();
      setSessionId(session.id);

      // 2. Save all answer sheets
      const uploadedSheets = studentSheets.filter(s => s.uploaded);
      const sheetsRes = await apiFetch(`/api/sessions/${session.id}/answer-sheets`, {
        method: 'POST',
        body: JSON.stringify({
          students: uploadedSheets.map(s => ({
            studentId: s.studentId,
            studentName: s.studentName,
            extractedText: s.extractedText,
            pdfUrl: s.fileUrl,
            extractMethod: s.extractMethod
          }))
        })
      });
      if (!sheetsRes.ok) throw new Error('Failed to upload answer sheets metadata');

      // 3. Start marking
      const markRes = await apiFetch(`/api/sessions/${session.id}/mark`, {
        method: 'POST',
        body: JSON.stringify({
          questionPdfText: questionPaper.extractedText,
          markSchemeText: markScheme.extractedText
        })
      });
      if (!markRes.ok) {
        let errMsg = 'Failed to start marking process';
        try {
          const errData = await markRes.json();
          errMsg = errData.error || errMsg;
        } catch (e) {
          /* Fallback if response is not JSON */
        }
        throw new Error(errMsg);
      }

      // 4. Start polling progress
      startProgressPolling(session.id);

    } catch (error: any) {
      setIsMarking(false);
      alert(error.message || 'Failed to start marking. Please try again.');
    }
  };

  const validateStep1 = () => {
    const newErrors: Record<string, string> = {};
    
    if (!sessionDetails.subject || sessionDetails.subject.length < 2)
      newErrors.subject = 'Subject is required';
    
    if (!sessionDetails.sessionType)
      newErrors.sessionType = 'Please select a session type';
    
    if (!sessionDetails.examBoard)
      newErrors.examBoard = 'Please select an exam board';
    
    if (!sessionDetails.courseId || !/^[A-Za-z0-9-]{1,20}$/.test(sessionDetails.courseId))
      newErrors.courseId = 'Invalid Course ID format';
    
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  // --- Components ---

  const StepIndicator = () => (
    <div className="max-w-4xl mx-auto mb-12 relative px-4">
      <div className="flex justify-between items-center relative z-10">
        {[
          { step: 1, label: 'Session Details', sub: 'The Basics' },
          { step: 2, label: 'Upload Papers', sub: 'Q & MS' },
          { step: 3, label: 'Answer Sheets', sub: 'Students' },
          { step: 4, label: 'Confirm & Start', sub: 'Launch' }
        ].map((s, i) => (
          <div key={s.step} className="flex flex-col items-center">
            <div className={cn(
              "w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm transition-all duration-300",
              currentStep > s.step ? "bg-navy text-white" : 
              currentStep === s.step ? "bg-navy text-white ring-4 ring-navy/10" : 
              "bg-bg border-2 border-border text-text-muted"
            )}>
              {currentStep > s.step ? <Check size={18} /> : s.step}
            </div>
            <div className="mt-3 text-center">
              <p className={cn(
                "text-[10px] font-bold uppercase tracking-widest",
                currentStep >= s.step ? "text-navy" : "text-text-muted"
              )}>{s.label}</p>
              <p className="text-[10px] text-text-muted mt-0.5">{s.sub}</p>
            </div>
          </div>
        ))}
      </div>
      {/* Background Line */}
      <div className="absolute top-5 left-8 right-8 h-0.5 bg-border -z-10" />
      {/* Progress Line */}
      <motion.div 
        initial={false}
        animate={{ width: `${((currentStep - 1) / 3) * 100}%` }}
        className="absolute top-5 left-8 h-0.5 bg-navy -z-10" 
      />
    </div>
  );

  const UploadZone = ({ title, fileData, onUpload, icon: Icon }: any) => {
    const inputId = `upload-${title.replace(/\s+/g, '-')}`;
    const [isDragging, setIsDragging] = React.useState(false);

    return (
    <div className="flex-1">
      <h3 className="text-sm font-bold text-navy mb-3 flex items-center gap-2">
        <Icon size={18} className="text-accent" /> {title}
      </h3>
      <div 
        onClick={() => document.getElementById(inputId)?.click()}
        onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
        onDragLeave={(e) => { e.preventDefault(); setIsDragging(false); }}
        onDrop={(e) => {
          e.preventDefault();
          setIsDragging(false);
          const file = e.dataTransfer.files?.[0];
          if (file) onUpload(file);
        }}
        className={cn(
          "border-2 border-dashed rounded-xl p-8 text-center transition-all cursor-pointer group relative overflow-hidden",
          isDragging ? "border-navy bg-navy/5" :
          fileData.uploaded ? "border-green-500 bg-green-50" : 
          fileData.uploading ? "border-accent bg-bg" :
          "border-border hover:border-accent hover:bg-bg"
        )}
      >
        <input 
          id={inputId} 
          type="file" 
          accept=".pdf" 
          className="hidden" 
          onChange={(e) => {
            if (e.target.files?.[0]) {
              onUpload(e.target.files[0]);
              e.target.value = '';
            }
          }} 
        />
        
        {fileData.uploading ? (
          <div className="space-y-4">
            <Loader2 size={32} className="mx-auto text-accent animate-spin" />
            <div className="space-y-1">
              <p className="text-xs font-bold text-navy">Uploading {fileData.file?.name}...</p>
              <div className="w-full bg-border rounded-full h-1 overflow-hidden">
                <motion.div 
                  initial={{ width: 0 }} 
                  animate={{ width: '80%' }} 
                  className="h-full bg-accent" 
                />
              </div>
            </div>
          </div>
        ) : fileData.uploaded ? (
          <div className="space-y-3">
            <div className="w-12 h-12 bg-green-500 text-white rounded-full flex items-center justify-center mx-auto">
              <Check size={24} />
            </div>
            <div>
              <p className="text-sm font-bold text-navy truncate">{fileData.file?.name}</p>
              <p className="text-[10px] text-text-muted mt-1 uppercase tracking-widest">
                {fileData.file?.size < 1024 * 1024 
                  ? `${(fileData.file?.size / 1024).toFixed(1)} KB` 
                  : `${(fileData.file?.size / (1024 * 1024)).toFixed(2)} MB`} • PDF
              </p>
            </div>
            <div className="flex items-center justify-center gap-2 pt-2">
              <span className="px-2 py-1 bg-green-100 text-green-700 rounded text-[10px] font-bold uppercase">
                📄 Text Extracted
              </span>
            </div>
            <button 
              onClick={(e) => {
                e.stopPropagation();
                setterMap[title]({ file: null, fileUrl: '', extractedText: '', uploading: false, uploaded: false });
              }}
              className="text-[10px] text-red-500 font-bold hover:underline"
            >
              Remove
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="w-16 h-16 bg-bg rounded-full flex items-center justify-center mx-auto group-hover:bg-accent/10 transition-colors">
              <Icon size={32} className="text-text-muted group-hover:text-accent" />
            </div>
            <div>
              <p className="text-sm font-bold text-navy">Drag & drop your PDF here</p>
              <p className="text-xs text-text-muted mt-1">or click to browse</p>
            </div>
            <p className="text-[10px] text-text-muted uppercase tracking-widest">PDF only · Max 20MB</p>
          </div>
        )}
      </div>
    </div>
  );
};

  const setterMap: Record<string, any> = {
    'Question Paper': setQuestionPaper,
    'Mark Scheme': setMarkScheme
  };

  // --- Rendering ---

  return (
    <DashboardLayout>
      <div className="max-w-6xl mx-auto px-4 py-12">
        <StepIndicator />

        <AnimatePresence mode="wait">
          {/* Step 1: Session Details */}
          {currentStep === 1 && (
            <motion.div 
              key="step1"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="max-w-3xl mx-auto"
            >
              <div className="card p-8 bg-white/80 backdrop-blur-sm border-white/20 shadow-xl overflow-hidden relative group" style={{ WebkitBackdropFilter: 'blur(8px)' }}>
                {/* Visual Accent */}
                <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-navy via-accent to-gold opacity-30" />
                
                <div className="relative z-10 space-y-8">
                  <header>
                    <h2 className="text-2xl font-serif font-bold text-navy flex items-center gap-2">
                      <Target size={24} className="text-accent" /> Configure Session
                    </h2>
                    <p className="text-text-muted mt-1 text-sm">Provide the core details to set up your AI marking environment.</p>
                  </header>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-6">
                    {/* Subject Field */}
                    <div className="space-y-2">
                      <label className="text-[10px] uppercase tracking-widest font-bold text-navy/50 flex items-center gap-1.5 ml-1">
                        <BookOpen size={12} className="text-accent" /> Subject *
                      </label>
                      <input 
                        type="text" 
                        className={cn(
                          "w-full h-12 bg-bg/50 border border-border rounded-xl px-4 text-sm font-medium outline-none transition-all focus:border-accent focus:bg-white focus:ring-4 focus:ring-accent/5 placeholder:text-text-muted/40",
                          errors.subject && "border-red-500 bg-red-50/10"
                        )}
                        placeholder="e.g. Biology, Mathematics..."
                        value={sessionDetails.subject}
                        onChange={e => setSessionDetails({ ...sessionDetails, subject: e.target.value })}
                      />
                      {errors.subject && <p className="text-[10px] text-red-500 font-bold uppercase ml-1">{errors.subject}</p>}
                    </div>

                    {/* Course ID Field */}
                    <div className="space-y-2">
                      <label className="text-[10px] uppercase tracking-widest font-bold text-navy/50 flex items-center gap-1.5 ml-1">
                        <Hash size={12} className="text-gold" /> Course ID *
                      </label>
                      <input 
                        type="text" 
                        className={cn(
                          "w-full h-12 bg-bg/50 border border-border rounded-xl px-4 text-sm font-medium outline-none transition-all focus:border-accent focus:bg-white focus:ring-4 focus:ring-accent/5 placeholder:text-text-muted/40",
                          errors.courseId && "border-red-500 bg-red-50/10"
                        )}
                        placeholder="e.g. BIO301, CS402"
                        value={sessionDetails.courseId}
                        onChange={e => setSessionDetails({ ...sessionDetails, courseId: e.target.value })}
                      />
                      {errors.courseId ? (
                        <p className="text-[10px] text-red-500 font-bold uppercase ml-1">{errors.courseId}</p>
                      ) : (
                        <p className="text-[9px] text-text-muted ml-1 opacity-60">Alphanumeric & hyphens (Max 20)</p>
                      )}
                    </div>

                    {/* Session Type Field */}
                    <div className="space-y-2">
                      <label className="text-[10px] uppercase tracking-widest font-bold text-navy/50 flex items-center gap-1.5 ml-1">
                        <Clock size={12} className="text-accent" /> Session Type *
                      </label>
                      <select 
                        className={cn(
                          "w-full h-12 bg-bg/50 border border-border rounded-xl px-4 text-sm font-medium outline-none transition-all focus:border-accent focus:bg-white focus:ring-4 focus:ring-accent/5 appearance-none",
                          errors.sessionType && "border-red-500 bg-red-50/10"
                        )}
                        value={sessionDetails.sessionType}
                        onChange={e => setSessionDetails({ ...sessionDetails, sessionType: e.target.value })}
                      >
                        <option value="" disabled>Select type...</option>
                        <option value="CA">Continuous Assessment (CA)</option>
                        <option value="Mid Term">Mid Term Exam</option>
                        <option value="Semester">Semester Exam</option>
                      </select>
                    </div>

                    {/* Paper Type Field */}
                    <div className="space-y-2">
                      <label className="text-[10px] uppercase tracking-widest font-bold text-navy/50 flex items-center gap-1.5 ml-1">
                        <Layers size={12} className="text-gold" /> Paper Type *
                      </label>
                      <select 
                        className="w-full h-12 bg-bg/50 border border-border rounded-xl px-4 text-sm font-medium outline-none transition-all focus:border-accent focus:bg-white focus:ring-4 focus:ring-accent/5 appearance-none"
                        value={sessionDetails.paperType}
                        onChange={e => setSessionDetails({ ...sessionDetails, paperType: e.target.value })}
                      >
                        <option value="Theory">Theory Paper</option>
                        <option value="Practical">Practical Paper</option>
                        <option value="MCQ">MCQ / Multiple Choice</option>
                        <option value="Alternative to Practical">Alternative to Practical</option>
                      </select>
                    </div>

                    {/* Exam Board Field - Full Width */}
                    <div className="space-y-2 md:col-span-2">
                      <label className="text-[10px] uppercase tracking-widest font-bold text-navy/50 flex items-center gap-1.5 ml-1">
                        <Globe size={12} className="text-accent" /> Exam Board *
                      </label>
                      <select 
                        className={cn(
                          "w-full h-12 bg-bg/50 border border-border rounded-xl px-4 text-sm font-medium outline-none transition-all focus:border-accent focus:bg-white focus:ring-4 focus:ring-accent/5 appearance-none",
                          errors.examBoard && "border-red-500 bg-red-50/10"
                        )}
                        value={sessionDetails.examBoard}
                        onChange={e => setSessionDetails({ ...sessionDetails, examBoard: e.target.value })}
                      >
                        <option value="" disabled>Select an exam board...</option>
                        <optgroup label="Government / Local Boards">
                          <option value="UGC">University Grants Commission (UGC)</option>
                          <option value="QAAC">Quality Assurance Council (QAAC)</option>
                        </optgroup>
                        <optgroup label="International / Foreign Boards">
                          <option value="Cambridge">Cambridge International</option>
                          <option value="Edexcel">Pearson Edexcel</option>
                          <option value="IB">International Baccalaureate (IB)</option>
                          <option value="AQA">AQA</option>
                          <option value="OCR">OCR</option>
                        </optgroup>
                      </select>
                    </div>
                  </div>

                  {/* Auto-generated Session Name Preview */}
                  {sessionDetails.name && (
                    <motion.div
                      initial={{ opacity: 0, scale: 0.98 }}
                      animate={{ opacity: 1, scale: 1 }}
                      className="relative overflow-hidden p-6 rounded-2xl bg-gradient-to-br from-navy to-navy-mid text-white ring-1 ring-white/10 shadow-lg"
                    >
                      {/* Decorative elements */}
                      <div className="absolute -top-12 -right-12 w-32 h-32 bg-accent/20 rounded-full blur-3xl" />
                      <div className="absolute -bottom-12 -left-12 w-32 h-32 bg-gold/10 rounded-full blur-3xl" />
                      
                      <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-4">
                        <div className="space-y-1">
                          <p className="text-[10px] font-bold uppercase tracking-widest text-white/40 flex items-center gap-2">
                             <Sparkles size={10} className="text-accent animate-pulse" /> Live Session Preview
                          </p>
                          <h3 className="text-xl font-serif font-bold text-white tracking-tight">
                            {sessionDetails.name}
                          </h3>
                        </div>
                        <div className="flex items-center gap-2 bg-white/5 py-1.5 px-3 rounded-lg backdrop-blur-sm border border-white/10 shrink-0 self-start md:self-center" style={{ WebkitBackdropFilter: 'blur(4px)' }}>
                          <div className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
                          <span className="text-[10px] font-bold uppercase tracking-wider text-white/70">Ready to Mark</span>
                        </div>
                      </div>
                    </motion.div>
                  )}
                </div>

                <div className="flex justify-between items-center mt-12 bg-bg/30 -mx-8 -mb-8 p-8 border-t border-border">
                  <p className="text-[10px] text-text-muted font-bold uppercase tracking-widest">
                    Step 1 of 4: The Basics
                  </p>
                  <button 
                    onClick={() => validateStep1() && setCurrentStep(2)}
                    className="bg-navy text-white h-12 px-8 rounded-xl font-bold flex items-center gap-3 transition-all hover:bg-navy-mid hover:shadow-lg hover:shadow-navy/10 active:scale-[0.98] group"
                  >
                    Continue to Uploads
                    <ArrowRight size={18} className="group-hover:translate-x-1 transition-transform" />
                  </button>
                </div>
              </div>
            </motion.div>
          )}

          {/* Step 2: Upload Papers */}
          {currentStep === 2 && (
            <motion.div 
              key="step2"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="space-y-8"
            >
              <div className="bg-bg p-4 rounded-xl border border-border flex items-center gap-3">
                <div className="w-10 h-10 bg-accent/10 text-accent rounded-full flex items-center justify-center shrink-0">
                  <AlertCircle size={20} />
                </div>
                <p className="text-xs text-navy font-medium">
                  Upload the question paper and mark scheme here. 
                  You will link student answer sheets to Student IDs in the next step.
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                <UploadZone 
                  title="Question Paper" 
                  fileData={questionPaper} 
                  onUpload={(f: File) => handleFileUpload(f, setQuestionPaper)}
                  icon={FileText} 
                />
                <UploadZone 
                  title="Mark Scheme" 
                  fileData={markScheme} 
                  onUpload={(f: File) => handleFileUpload(f, setMarkScheme)}
                  icon={Zap} 
                />
              </div>

              <div className="flex justify-between mt-12 pt-8 border-t border-border">
                <button 
                  onClick={() => setCurrentStep(1)}
                  className="btn-ghost"
                >
                  Back
                </button>
                <div className="flex gap-4">
                  <button 
                    onClick={() => {
                        if (!questionPaper.uploaded) return alert('Please upload the Question Paper before continuing');
                        if (!markScheme.uploaded) return alert('Please upload the Mark Scheme before continuing');
                        setCurrentStep(3);
                    }}
                    className="btn-primary px-8 flex items-center gap-2"
                  >
                    Continue to Students <ArrowRight size={18} />
                  </button>
                </div>
              </div>
            </motion.div>
          )}

          {/* Step 3: Answer Sheets */}
          {currentStep === 3 && (
            <motion.div 
              key="step3"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="space-y-8"
            >
              <div className="text-center">
                <h2 className="text-2xl font-serif font-bold text-navy">Student Answer Sheets</h2>
                <p className="text-text-muted mt-2">Link each answer sheet PDF to a Student ID.</p>
              </div>

              <div className="flex justify-center mb-8">
                <div className="bg-bg p-1 rounded-xl flex gap-1">
                  <button 
                    onClick={() => setIsBulkMode(false)}
                    className={cn(
                      "px-6 py-2 rounded-lg text-xs font-bold transition-all",
                      !isBulkMode ? "bg-white text-navy shadow-sm" : "text-text-muted hover:text-navy"
                    )}
                  >
                    Upload Individually
                  </button>
                  <button 
                    onClick={() => setIsBulkMode(true)}
                    className={cn(
                      "px-6 py-2 rounded-lg text-xs font-bold transition-all",
                      isBulkMode ? "bg-white text-navy shadow-sm" : "text-text-muted hover:text-navy"
                    )}
                  >
                    Bulk Upload
                  </button>
                </div>
              </div>

              {!isBulkMode ? (
                <div className="card overflow-hidden">
                  <table className="w-full text-left">
                    <thead>
                      <tr className="bg-bg border-b border-border">
                        <th className="px-6 py-4 text-[10px] uppercase tracking-widest font-bold text-text-muted">Student ID *</th>
                        <th className="px-6 py-4 text-[10px] uppercase tracking-widest font-bold text-text-muted">Student Name</th>
                        <th className="px-6 py-4 text-[10px] uppercase tracking-widest font-bold text-text-muted">Answer Sheet PDF</th>
                        <th className="px-6 py-4 text-[10px] uppercase tracking-widest font-bold text-text-muted text-right">Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {studentSheets.map((s, idx) => (
                        <tr key={idx} className="border-b border-border last:border-0">
                          <td className="px-6 py-4">
                            <input 
                              type="text" 
                              className={cn(
                                "input text-xs h-9 bg-white border-border hover:border-navy/30 focus:border-navy transition-all",
                                !s.studentId && s.uploaded && "border-red-300 bg-red-50/30"
                              )} 
                              placeholder="ID (Required) *"
                              value={s.studentId}
                              readOnly={false}
                              onChange={e => setStudentSheets(prev => prev.map((item, i) => i === idx ? { ...item, studentId: e.target.value } : item))}
                            />
                          </td>
                          <td className="px-6 py-4">
                            <input 
                              type="text" 
                              className="input text-xs h-9 bg-white border-border hover:border-navy/30 focus:border-navy transition-all" 
                              placeholder="Student Name (Optional)"
                              value={s.studentName}
                              readOnly={false}
                              onChange={e => setStudentSheets(prev => prev.map((item, i) => i === idx ? { ...item, studentName: e.target.value } : item))}
                            />
                          </td>
                          <td className="px-6 py-4">
                            <div className="flex items-center gap-3">
                              {s.uploaded ? (
                                <>
                                  <div className="flex flex-col">
                                    <span className="text-xs font-bold text-navy truncate max-w-[200px]">{s.file?.name}</span>
                                    <div className="flex gap-2 mt-1">
                                      <span className={cn(
                                        "px-1.5 py-0.5 rounded text-[8px] font-bold uppercase",
                                        s.extractMethod === 'gemini-vision' ? "bg-blue-100 text-blue-600" : "bg-green-100 text-green-600"
                                      )}>
                                        {s.extractMethod === 'gemini-vision' ? '🤖 AI OCR' : '📄 Text'}
                                      </span>
                                      <button 
                                        onClick={() => setStudentSheets(prev => prev.map((item, i) => i === idx ? { ...item, previewOpen: !item.previewOpen } : item))}
                                        className="text-[8px] font-bold uppercase text-accent hover:underline"
                                      >
                                        {s.previewOpen ? '▼ Hide Preview' : '▶ Preview Text'}
                                      </button>
                                    </div>
                                  </div>
                                </>
                              ) : s.uploading ? (
                                <div className="flex items-center gap-2">
                                  <Loader2 size={16} className="animate-spin text-accent" />
                                  <span className="text-xs text-text-muted">Uploading...</span>
                                </div>
                              ) : (
                                <button 
                                  onClick={() => document.getElementById(`stu-file-${idx}`)?.click()}
                                  className="text-[10px] font-bold text-accent flex items-center gap-1 hover:underline"
                                >
                                  <Upload size={14} /> Upload PDF
                                </button>
                              )}
                              <input 
                                id={`stu-file-${idx}`}
                                type="file"
                                accept=".pdf"
                                className="hidden"
                                onChange={(e) => e.target.files?.[0] && handleStudentFileUpload(e.target.files[0], idx)}
                              />
                            </div>
                            {s.previewOpen && (
                              <div className="mt-4 p-4 bg-bg rounded-lg text-[10px] text-text-muted max-h-32 overflow-y-auto font-mono whitespace-pre-wrap border border-border">
                                {s.extractedText || "No text extracted."}
                              </div>
                            )}
                          </td>
                          <td className="px-6 py-4 text-right">
                            <button 
                              onClick={() => setStudentSheets(prev => prev.filter((_, i) => i !== idx))}
                              className="text-text-muted hover:text-red-500 transition-colors"
                            >
                              <Trash2 size={16} />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <div className="p-4 bg-bg/30 border-t border-border">
                    <button 
                      onClick={() => setStudentSheets(prev => [...prev, {
                        studentId: '', studentName: '', file: null, fileUrl: '',
                        extractedText: '', extractMethod: 'pdf-parse',
                        uploading: false, uploaded: false, previewOpen: false
                      }])}
                      className="text-xs font-bold text-navy flex items-center gap-2 hover:text-accent transition-colors"
                    >
                      <Plus size={16} /> Add Extra Student
                    </button>
                  </div>
                </div>
              ) : (
                /* Bulk Upload Mode */
                <div className="space-y-8">
                  <div 
                    onClick={() => document.getElementById('bulk-upload-input')?.click()}
                    className="card p-12 border-2 border-dashed border-border hover:border-accent hover:bg-bg/50 transition-all text-center cursor-pointer group"
                  >
                    <input 
                      id="bulk-upload-input"
                      type="file"
                      multiple
                      accept=".pdf"
                      className="hidden"
                      onChange={(e) => {
                        const files = Array.from(e.target.files || []);
                        const newSheets = files.map(file => {
                          // Simple auto-match logic
                          const filename = file.name.toUpperCase();
                          const match = filename.match(/(STU[-_]?\d+|[A-Z]\d{3,})/i);
                          return {
                            studentId: match ? match[0] : '',
                            studentName: '',
                            file: file,
                            fileUrl: '',
                            extractedText: '',
                            extractMethod: 'pdf-parse',
                            uploading: false,
                            uploaded: false,
                            previewOpen: false
                          };
                        });
                        setStudentSheets(prev => [...prev, ...newSheets]);
                      }}
                    />
                    <div className="w-20 h-20 bg-bg rounded-2xl flex items-center justify-center mx-auto mb-6 group-hover:bg-accent/10 transition-colors">
                      <LayoutGrid size={40} className="text-text-muted group-hover:text-accent" />
                    </div>
                    <h3 className="text-lg font-bold text-navy">Drop all student PDFs here</h3>
                    <p className="text-text-muted mt-2">or click to select multiple files</p>
                  </div>

                  {studentSheets.length > 0 && (
                    <div className="card overflow-hidden">
                       <div className="bg-bg p-4 border-b border-border flex justify-between items-center">
                         <span className="text-xs font-bold text-navy uppercase tracking-widest">{studentSheets.length} Files Ready</span>
                         <button 
                            onClick={() => {
                              studentSheets.forEach((s, i) => {
                                if (s.file && !s.uploaded && !s.uploading) {
                                  handleStudentFileUpload(s.file, i);
                                }
                              });
                            }}
                            className="btn-accent px-4 py-2 text-[10px]"
                          >
                            Upload All
                         </button>
                       </div>
                       <table className="w-full text-left">
                         <thead>
                           <tr className="bg-bg/50 border-b border-border">
                             <th className="px-6 py-4 text-[10px] uppercase tracking-widest font-bold text-text-muted">Uploaded File</th>
                             <th className="px-6 py-4 text-[10px] uppercase tracking-widest font-bold text-text-muted">Assign Student ID *</th>
                             <th className="px-6 py-4 text-[10px] uppercase tracking-widest font-bold text-text-muted">Student Name</th>
                           </tr>
                         </thead>
                         <tbody>
                            {studentSheets.map((s, idx) => (
                              <tr key={idx} className="border-b border-border last:border-0">
                                <td className="px-6 py-4">
                                  <div className="flex items-center gap-2">
                                    <FileText size={14} className="text-text-muted" />
                                    <span className="text-xs font-medium text-navy truncate max-w-[200px]">{s.file?.name}</span>
                                    {s.studentId && <span className="px-1.5 py-0.5 bg-green-100 text-green-700 rounded text-[8px] font-bold">Auto-matched</span>}
                                  </div>
                                </td>
                                <td className="px-6 py-4">
                                  <input 
                                    type="text" 
                                    className={cn(
                                      "input h-9 text-xs bg-white border-border hover:border-navy/30 focus:border-navy transition-all",
                                      !s.studentId && s.uploaded && "border-red-300 bg-red-50/30"
                                    )} 
                                    placeholder="ID (Required) *"
                                    value={s.studentId}
                                    onChange={e => setStudentSheets(prev => prev.map((item, i) => i === idx ? { ...item, studentId: e.target.value } : item))}
                                  />
                                </td>
                                <td className="px-6 py-4">
                                  <input 
                                    type="text" 
                                    className="input h-9 text-xs bg-white border-border hover:border-navy/30 focus:border-navy transition-all" 
                                    placeholder="Student Name (Optional)"
                                    value={s.studentName}
                                    onChange={e => setStudentSheets(prev => prev.map((item, i) => i === idx ? { ...item, studentName: e.target.value } : item))}
                                  />
                                </td>
                              </tr>
                            ))}
                         </tbody>
                       </table>
                    </div>
                  )}
                </div>
              )}

              {/* Progress Summary Bar */}
              <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-border p-4 z-20 shadow-lg">
                <div className="max-w-6xl mx-auto flex items-center gap-8">
                  <div className="flex gap-6 shrink-0">
                    <div className="flex items-center gap-2">
                       <Check size={16} className="text-green-500" />
                       <span className="text-xs font-bold text-navy">{studentSheets.filter(s => s.uploaded).length} uploaded</span>
                    </div>
                    <div className="flex items-center gap-2">
                       <Loader2 size={16} className="text-accent animate-spin" />
                       <span className="text-xs font-bold text-navy">{studentSheets.filter(s => s.uploading).length} pending</span>
                    </div>
                  </div>
                  <div className="flex-1">
                    <div className="h-2 bg-bg rounded-full overflow-hidden">
                       <motion.div 
                        initial={{ width: 0 }}
                        animate={{ width: `${(studentSheets.filter(s => s.uploaded).length / (studentSheets.length || 1)) * 100}%` }}
                        className="h-full bg-accent"
                       />
                    </div>
                  </div>
                  <div className="flex gap-4">
                    <button onClick={() => setCurrentStep(2)} className="btn-ghost">Back</button>
                    <button 
                      onClick={() => {
                        const uploadedCount = studentSheets.filter(s => s.uploaded).length;
                        if (uploadedCount === 0) return alert('At least 1 student must have an uploaded answer sheet');
                        
                        const hasEmptyId = studentSheets.some(s => s.uploaded && !s.studentId);
                        if (hasEmptyId) return alert('Please assign Student IDs to all uploaded sheets');

                        setCurrentStep(4);
                      }}
                      className="btn-primary"
                    >
                      Confirm & Start
                    </button>
                  </div>
                </div>
              </div>
              <div className="h-24" /> {/* Spacer for fixed footer */}
            </motion.div>
          )}

          {/* Step 4: Confirm & Start */}
          {currentStep === 4 && (
            <motion.div 
              key="step4"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="grid grid-cols-1 lg:grid-cols-2 gap-8"
            >
              {/* Left Column: Summary */}
              <div className="space-y-6">
                <div className="card p-6">
                  <h3 className="text-sm font-bold text-navy uppercase tracking-widest mb-6 pb-4 border-b border-border flex items-center gap-2">
                    <FileText size={18} className="text-accent" /> Session Summary
                  </h3>
                  <div className="space-y-4">
                    {[
                      { label: 'Session Name', value: sessionDetails.name, icon: <Sparkles size={12} className="text-accent" /> },
                      { label: 'Subject', value: sessionDetails.subject },
                      { label: 'Type', value: sessionDetails.sessionType },
                      { label: 'Board', value: sessionDetails.examBoard },
                      { label: 'Course ID', value: sessionDetails.courseId },
                      { label: 'Question Paper', value: questionPaper.file?.name, isStatus: true },
                      { label: 'Mark Scheme', value: markScheme.file?.name, isStatus: true }
                    ].map((row, i) => (
                      <div key={i} className="flex justify-between items-center text-xs py-2 border-b border-slate-100 last:border-0">
                        <span className="text-text-muted font-bold uppercase tracking-tighter">{row.label}</span>
                        <div className="flex items-center gap-2 text-right">
                          {row.icon}
                          <span className="text-navy font-bold truncate max-w-[200px]">{row.value}</span>
                          {row.isStatus && <CheckCircle2 size={14} className="text-green-500" />}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="card overflow-hidden">
                  <div className="p-4 bg-bg border-b border-border flex justify-between items-center">
                    <h4 className="text-[10px] font-bold text-navy uppercase tracking-widest">Student Sheets Preview</h4>
                    <button onClick={() => setCurrentStep(3)} className="text-[10px] font-bold text-accent hover:underline">Edit</button>
                  </div>
                  <div className="max-h-64 overflow-y-auto">
                    <table className="w-full text-left text-[10px]">
                      <thead className="sticky top-0 bg-white">
                        <tr className="border-b border-border">
                          <th className="px-4 py-2 font-bold text-text-muted">Student ID</th>
                          <th className="px-4 py-2 font-bold text-text-muted">File</th>
                          <th className="px-4 py-2 font-bold text-text-muted">Method</th>
                        </tr>
                      </thead>
                      <tbody>
                        {studentSheets.filter(s => s.uploaded).map((s, idx) => (
                          <tr key={idx} className="border-b border-border last:border-0 hover:bg-bg transition-colors">
                            <td className="px-4 py-2 font-bold text-navy">{s.studentId}</td>
                            <td className="px-4 py-2 text-text-muted truncate max-w-[120px]">{s.file?.name}</td>
                            <td className="px-4 py-2">
                              <span className={cn(
                                "px-1.5 py-0.5 rounded text-[8px] font-bold uppercase",
                                s.extractMethod === 'gemini-vision' ? "bg-blue-100 text-blue-600" : "bg-green-100 text-green-600"
                              )}>
                                {s.extractMethod === 'gemini-vision' ? 'AI OCR' : 'Text'}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>

              {/* Right Column: Settings */}
              <div className="space-y-6">
                <div className="card p-6">
                  <h3 className="text-sm font-bold text-navy uppercase tracking-widest mb-6 pb-4 border-b border-border flex items-center gap-2">
                    <BarChart2 size={18} className="text-accent" /> Marking Settings
                  </h3>
                  
                  <div className="space-y-8">
                    <div>
                      <label className="text-xs font-bold text-navy mb-4 block">Marking Strictness</label>
                      <div className="space-y-3">
                        {[
                          { id: 'Strict', color: 'bg-red-500', desc: 'Follow mark scheme exactly. Only award marks for answers that precisely match criteria.' },
                          { id: 'Standard', color: 'bg-amber-500', desc: 'Allow minor variations in wording if the correct concept is demonstrated.' },
                          { id: 'Lenient', color: 'bg-green-500', desc: 'Credit partial understanding and creative approaches showing knowledge.' }
                        ].map(opt => (
                          <label 
                            key={opt.id}
                            className={cn(
                              "flex p-3 rounded-xl border-2 transition-all cursor-pointer",
                              markingStrictness === opt.id ? "border-navy bg-navy/5" : "border-border hover:border-text-muted"
                            )}
                          >
                            <input 
                              type="radio" 
                              className="hidden" 
                              name="strictness" 
                              checked={markingStrictness === opt.id}
                              onChange={() => setMarkingStrictness(opt.id)}
                            />
                            <div className="flex gap-3">
                              <div className={cn("w-2 h-2 rounded-full mt-1.5 shrink-0", opt.color)} />
                              <div>
                                <p className="text-xs font-bold text-navy">{opt.id}</p>
                                <p className="text-[10px] text-text-muted mt-1 leading-relaxed">{opt.desc}</p>
                              </div>
                            </div>
                          </label>
                        ))}
                      </div>
                    </div>

                    <div>
                      <label className="text-xs font-bold text-navy mb-4 block">AI Feedback Detail</label>
                      <div className="grid grid-cols-2 gap-4">
                        {['Detailed', 'Brief'].map(detail => (
                          <button 
                            key={detail}
                            onClick={() => setFeedbackDetail(detail)}
                            className={cn(
                              "px-4 py-3 rounded-xl border-2 text-xs font-bold transition-all",
                              feedbackDetail === detail ? "border-navy bg-navy text-white shadow-lg" : "border-border text-text-muted hover:border-navy"
                            )}
                          >
                            {detail}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="card p-6 bg-navy text-white">
                  <div className="flex justify-between items-start mb-6">
                    <div>
                      <h4 className="text-sm font-bold flex items-center gap-2">
                        <TrendingUp size={18} className="text-accent" /> Estimated Marking Time
                      </h4>
                      <p className="text-white/40 text-[10px] uppercase tracking-widest mt-1">Based on student volume</p>
                    </div>
                    <div className="text-right">
                       <p className="text-2xl font-serif font-bold text-accent">~{Math.round((studentSheets.filter(s => s.uploaded).length * 30) / 60)} min</p>
                       <p className="text-[10px] text-white/40 font-bold uppercase tracking-widest mt-0.5">Powered by AI</p>
                    </div>
                  </div>
                  <div className="space-y-4 pt-6 border-t border-white/10">
                    <div className="flex justify-between text-xs">
                      <span className="text-white/40 font-medium">Papers to Mark</span>
                      <span className="font-bold">{studentSheets.filter(s => s.uploaded).length} Papers</span>
                    </div>
                    <div className="flex justify-between text-xs">
                      <span className="text-white/40 font-medium">Processing Speed</span>
                      <span className="font-bold">~30 sec / paper</span>
                    </div>
                  </div>
                </div>

                <div className="flex gap-4 pt-4">
                  <button onClick={() => setCurrentStep(3)} className="btn-ghost flex-1">Back</button>
                  <button 
                    onClick={handleStartMarking}
                    className="btn-accent flex-1 flex items-center justify-center gap-2 shadow-lg shadow-accent/20 group hover:scale-[1.02] transition-all"
                  >
                    <Zap size={20} fill="currentColor" className="group-hover:animate-pulse" /> 
                    <span className="font-bold">Save & Start Marking</span>
                  </button>
                </div>
                <button 
                  onClick={() => {/* Save Draft logic same but without mark endopoint */}}
                  className="w-full text-[10px] font-bold text-text-muted uppercase tracking-widest hover:text-navy transition-colors text-center"
                >
                  Save as Draft Only
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* --- Marking Overlay --- */}
      <AnimatePresence>
        {isMarking && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="fixed inset-0 z-[100] bg-navy/95 flex items-center justify-center p-8 backdrop-blur-md"
          >
            <div className="max-w-lg w-full text-center space-y-12">
              <div className="relative inline-block scale-125">
                 <div className="w-24 h-24 border-4 border-accent/20 rounded-full flex items-center justify-center">
                    <div className="w-16 h-16 border-4 border-t-accent border-r-accent/30 border-b-accent/10 border-l-accent/50 rounded-full animate-spin" />
                 </div>
                 <div className="absolute inset-0 flex items-center justify-center">
                    <Zap size={32} className="text-accent animate-pulse" fill="currentColor" />
                 </div>
              </div>

              <div className="space-y-4">
                <h1 className="text-3xl font-serif font-bold text-white tracking-tight">AI is marking papers...</h1>
                <p className="text-white/50 text-sm max-w-xs mx-auto">Evaluating student submissions against your mark scheme using advanced AI evaluation logic.</p>
              </div>

              <div className="bg-white/5 rounded-3xl p-8 border border-white/10 space-y-6">
                <div className="flex justify-between items-end mb-2">
                  <div className="text-left">
                    <p className="text-[10px] font-bold text-white/40 uppercase tracking-widest">Marking Progress</p>
                    <p className="text-3xl font-serif font-bold text-white mt-1">
                      {markingProgress.completed} <span className="text-lg font-sans text-white/30">/ {markingProgress.total || studentSheets.length}</span>
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-[10px] font-bold text-accent uppercase tracking-widest">Estimated Time</p>
                    <p className="text-sm font-bold text-white mt-1">~{Math.ceil(markingProgress.estimatedSecondsRemaining / 60)} minutes left</p>
                  </div>
                </div>

                <div className="h-3 bg-white/10 rounded-full overflow-hidden relative">
                   <motion.div 
                    initial={{ width: 0 }}
                    animate={{ width: `${((markingProgress.completed || 0) / (markingProgress.total || studentSheets.length || 1)) * 100}%` }}
                    className="h-full bg-gradient-to-r from-accent to-accent-light"
                   />
                </div>

                {markingProgress.currentStudentName && (
                  <div className="pt-4 border-t border-white/5 flex items-center justify-center gap-3">
                    <div className="w-2 h-2 bg-accent rounded-full animate-ping" />
                    <p className="text-xs text-white/70">
                      Currently Marking: <span className="font-bold text-white">{markingProgress.currentStudentName}</span>
                    </p>
                  </div>
                )}
              </div>

              <div className="space-y-4 pt-12">
                <div className="flex items-center justify-center gap-3 text-white/30 text-xs">
                  <Loader2 size={16} className="animate-spin" />
                  <span className="uppercase tracking-[0.2em] font-medium">Please do not navigate away</span>
                </div>
                <div className="flex justify-center gap-2">
                  <div className="w-1 h-1 bg-white/20 rounded-full animate-bounce [animation-delay:-0.3s]" />
                  <div className="w-1 h-1 bg-white/20 rounded-full animate-bounce [animation-delay:-0.15s]" />
                  <div className="w-1 h-1 bg-white/20 rounded-full animate-bounce" />
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </DashboardLayout>
  );
};

export default NewSessionPage;
