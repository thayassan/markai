import React, { useState, useRef, useEffect } from 'react';
import { DashboardLayout } from '@/src/components/DashboardLayout';
import { 
  Upload, FileText, Check, ArrowRight, X, Zap, 
  Loader2, Plus, Trash2, LayoutGrid, Users,
  CheckCircle2, AlertCircle, AlertTriangle, TrendingUp, Target, Award, Calendar, ChevronRight, ArrowUpRight, BarChart2,
  Sparkles, BookOpen, Hash, Clock, Layers, Globe
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { cn } from '@/src/lib/utils';
import { safeGetItem } from '../lib/storage';
import { apiFetch, apiUploadAndPoll } from '../lib/api';

const useCountdown = (targetTimestamp: number | null | undefined) => {
  const [secondsLeft, setSecondsLeft] = useState(0);

  useEffect(() => {
    if (!targetTimestamp) {
      setSecondsLeft(0);
      return;
    }

    const calculateSeconds = () => {
      const diff = Math.ceil((targetTimestamp - Date.now()) / 1000);
      return diff > 0 ? diff : 0;
    };

    setSecondsLeft(calculateSeconds());

    const timer = setInterval(() => {
      const left = calculateSeconds();
      setSecondsLeft(left);
      if (left <= 0) {
        clearInterval(timer);
      }
    }, 1000);

    return () => clearInterval(timer);
  }, [targetTimestamp]);

  return secondsLeft;
};

interface StudentUploadFailureBoxProps {
  errorMessage?: string;
  retryAvailableAt?: number | null;
  manualEntryOpen?: boolean;
  extractedText?: string;
  onRetry: () => void;
  onToggleManualEntry: () => void;
  onUpdateText: (text: string) => void;
}

const StudentUploadFailureBox: React.FC<StudentUploadFailureBoxProps> = ({
  errorMessage,
  retryAvailableAt,
  manualEntryOpen,
  extractedText,
  onRetry,
  onToggleManualEntry,
  onUpdateText
}) => {
  const secondsLeft = useCountdown(retryAvailableAt);
  const isCooldownActive = secondsLeft > 0;
  const noRetryPossible = retryAvailableAt === null;

  return (
    <div className="mt-2 p-3 bg-amber-50 border border-amber-200 rounded-lg">
      <p className="text-xs text-amber-700 mb-2 flex items-start gap-1.5">
        <AlertTriangle size={13} className="shrink-0 mt-0.5" />
        <span>{errorMessage || 'Upload failed.'}</span>
      </p>
      <div className="flex gap-2 mb-2">
        {!noRetryPossible && (
          <button
            onClick={onRetry}
            disabled={isCooldownActive}
            className={cn(
              "text-xs px-3 py-1.5 text-white rounded-md transition-all flex items-center gap-1.5",
              isCooldownActive 
                ? "bg-slate-400 cursor-not-allowed opacity-75" 
                : "bg-navy hover:bg-navy/90"
            )}
          >
            {isCooldownActive ? (
              <>
                <Clock size={12} className="animate-spin" />
                <span>Retry in {secondsLeft}s</span>
              </>
            ) : (
              'Retry Upload'
            )}
          </button>
        )}
        <button
          onClick={onToggleManualEntry}
          className="text-xs px-3 py-1.5 border border-navy text-navy rounded-md hover:bg-navy/5"
        >
          Type Answer Manually
        </button>
      </div>

      {manualEntryOpen && (
        <textarea
          className="w-full p-2 border border-slate-200 rounded-md text-xs font-sans mt-2"
          rows={6}
          placeholder="Type or paste the student's answers here..."
          value={extractedText || ''}
          onChange={(e) => onUpdateText(e.target.value)}
        />
      )}
    </div>
  );
};

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
    textUrl?: string;
    extractedText: string;
    extractMethod: string;
    uploading: boolean;
    uploaded: boolean;
    previewOpen: boolean;
    uploadStatus?: string;
    uploadFailed?: boolean;
    errorMessage?: string;
    manualEntryOpen?: boolean;
    retryAvailableAt?: number | null;
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
  const [markingState, setMarkingState] = useState<string | null>(null);
  const [markingErrorMessage, setMarkingErrorMessage] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState('');
  const [isParsingPaper, setIsParsingPaper] = useState(false);
  const [paperStructure, setPaperStructure] = useState<{
    totalMaxMarks: number | null;
    questionCount: number;
    mismatchWarning: string | null;
  } | null>(null);
  const [needsManualMarks, setNeedsManualMarks] = useState(false);
  const [manualQuestions, setManualQuestions] = useState<any[]>([]);

  // Errors
  const [errors, setErrors] = useState<Record<string, string>>({});
  const uploadLocksRef = useRef<Set<number>>(new Set());
  const pollingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollingFailureCountRef = useRef(0);

  const stopProgressPolling = () => {
    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current);
      pollingIntervalRef.current = null;
    }
  };

  // Student sheets initialization
  useEffect(() => {
    if (studentSheets.length === 0) {
      setStudentSheets([{
        studentId: '', studentName: '', file: null, fileUrl: '', textUrl: '',
        extractedText: '', extractMethod: 'pdf-parse',
        uploading: false, uploaded: false, previewOpen: false
      }]);
    }
  }, []);

  useEffect(() => {
    return () => {
      stopProgressPolling();
    };
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

    setter((prev: any) => {
      // Prevent duplicate uploads while one is already in progress
      if (prev.uploading) return prev;
      return { ...prev, file, uploading: true };
    });

    const formData = new FormData();
    formData.append('file', file);

    try {
      const data = await apiUploadAndPoll(
        '/api/upload/answer-pdf',
        formData
      );

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
    const ext = file.name.split('.').pop()?.toLowerCase();
    const isAllowedExt = ext === 'pdf' || ext === 'jpg' || ext === 'jpeg' || ext === 'png';
    const isValidType = file.type === 'application/pdf' || 
                         file.type === 'image/jpeg' || 
                         file.type === 'image/jpg' || 
                         file.type === 'image/png' ||
                         isAllowedExt;
    if (!isValidType) {
       setStudentSheets(prev => prev.map((s, i) => i === index ? {
         ...s,
         uploading: false,
         uploadFailed: true,
         errorMessage: 'Only PDF, JPG, or PNG files are allowed'
       } : s));
       return;
    }
    if (file.size > 20 * 1024 * 1024) {
       setStudentSheets(prev => prev.map((s, i) => i === index ? {
         ...s,
         uploading: false,
         uploadFailed: true,
         errorMessage: 'File size must be under 20MB'
       } : s));
       return;
    }

    if (uploadLocksRef.current.has(index)) {
      console.warn(`Upload already locked for index ${index}, ignoring duplicate trigger`);
      return;
    }
    uploadLocksRef.current.add(index);
    
    setStudentSheets(prev =>
      prev.map((s, i) => i === index
        ? { ...s, file, uploading: true, uploadFailed: false, uploadStatus: 'Uploading...', retryAvailableAt: null }
        : s
      )
    );

    const formData = new FormData();
    formData.append('file', file);

    try {
      const result = await apiUploadAndPoll(
        '/api/upload/answer-pdf',
        formData,
        (status) => {
          const statusLabel =
            status === 'PENDING' ? 'Queued...' :
            status === 'PROCESSING' ? 'AI is reading the document...' :
            'Processing...';

          setStudentSheets(prev =>
            prev.map((s, i) => i === index ? { ...s, uploadStatus: statusLabel } : s)
          );
        }
      );

      setStudentSheets(prev => prev.map((s, i) => i === index ? {
        ...s,
        file: file,
        fileUrl: result.fileUrl,
        textUrl: result.textUrl,
        extractedText: result.text,
        extractMethod: result.method,
        fileType: result.fileType,
        uploading: false,
        uploaded: true
      } : s));
    } catch (error: any) {
      const cooldownSec = error.retryAfterSeconds;
      setStudentSheets(prev => prev.map((s, i) => i === index ? {
        ...s,
        uploading: false,
        uploadFailed: true,
        errorMessage: error.message || 'Upload failed',
        showManualEntry: error.allowManualEntry !== false,
        retryAvailableAt: cooldownSec ? Date.now() + cooldownSec * 1000 : null
      } : s));
    } finally {
      uploadLocksRef.current.delete(index);
    }
  };

  const updateStudentText = (index: number, text: string) => {
    setStudentSheets(prev =>
      prev.map((s, i) =>
        i === index
          ? {
              ...s,
              extractedText: text,
              extractMethod: 'manual-entry',
              uploaded: text.trim().length > 5,
              uploadFailed: false,
              retryAvailableAt: null
            }
          : s
      )
    );
  };

  const retryUpload = async (index: number) => {
    const sheet = studentSheets[index];
    if (sheet?.file) {
      await handleStudentFileUpload(sheet.file, index);
    }
  };

  const startProgressPolling = (sessionId: string) => {
    stopProgressPolling();
    pollingFailureCountRef.current = 0;
    setMarkingState(null);
    setMarkingErrorMessage(null);

    const MAX_CONSECUTIVE_FAILURES = 5;
    const MAX_TOTAL_DURATION_MS = 10 * 60 * 1000; // 10 minutes hard ceiling
    const pollingStartTime = Date.now();

    pollingIntervalRef.current = setInterval(async () => {
      if (!sessionId || sessionId === 'undefined') {
        stopProgressPolling();
        return;
      }

      if (Date.now() - pollingStartTime > MAX_TOTAL_DURATION_MS) {
        console.warn('Progress polling exceeded max duration, stopping.');
        stopProgressPolling();
        setMarkingState('TIMEOUT');
        return;
      }

      try {
        const res = await apiFetch(`/api/sessions/${sessionId}/progress`);

        if (!res.ok) {
          throw new Error(`Progress check failed with status ${res.status}`);
        }

        const data = await res.json();
        pollingFailureCountRef.current = 0; // reset failure count on any success

        setMarkingProgress({
          total: data.total || 0,
          completed: data.completed || 0,
          currentStudentId: data.currentStudentId || '',
          currentStudentName: data.currentStudentName || '',
          estimatedSecondsRemaining: data.estimatedSecondsRemaining || 0,
          status: data.status || 'PENDING'
        });

        if (data.status === 'COMPLETE') {
          stopProgressPolling();
          setIsMarking(false);
          navigate(`/lecturer/sessions/${sessionId}`, { replace: true });
          return;
        }

        if (data.status === 'ERROR') {
          stopProgressPolling();
          setIsMarking(false);
          setMarkingState('ERROR');
          setMarkingErrorMessage(data.errorMessage || 'Marking failed. Please try again.');
          alert(data.errorMessage || 'Marking failed. Please try again.');
          return;
        }

      } catch (error: any) {
        pollingFailureCountRef.current++;
        console.warn(`Progress poll failed (attempt ${pollingFailureCountRef.current}/${MAX_CONSECUTIVE_FAILURES}):`, error.message);

        if (pollingFailureCountRef.current >= MAX_CONSECUTIVE_FAILURES) {
          console.error('Progress polling failed too many times in a row, stopping.');
          stopProgressPolling();
          setMarkingState('CONNECTION_LOST');
        }
      }
    }, 3000);
  };

  const createAndParseSession = async () => {
    setIsParsingPaper(true);
    try {
      let activeSessionId = sessionId;

      // 1. Create or retrieve session
      if (!activeSessionId) {
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

        const sessionRes = await apiFetch('/api/sessions', {
          method: 'POST',
          body: JSON.stringify(payload)
        });
        if (!sessionRes.ok) {
          const errData = await sessionRes.json();
          throw new Error(errData.error || 'Failed to create session');
        }
        const session = await sessionRes.json();
        activeSessionId = session.id;
        setSessionId(session.id);
      }

      // 2. Save all answer sheets metadata
      const uploadedSheets = studentSheets.filter(s => s.uploaded);

      // DIAGNOSTIC — log exactly what's about to be sent
      console.log('═══ PRE-SUBMIT ANSWER SHEET DATA ═══');
      uploadedSheets.forEach(s => {
        console.log(`Student ${s.studentId}:`, {
          hasExtractedText: !!s.extractedText,
          textLength: s.extractedText?.length || 0,
          textPreview: s.extractedText?.substring(0, 100) || '(EMPTY)',
          fileUrl: s.fileUrl,
          extractMethod: s.extractMethod
        });
      });
      console.log('═══════════════════════════════════');

      const payload = {
        students: uploadedSheets.map(s => ({
          studentId: s.studentId,
          studentName: s.studentName,
          extractedText: s.extractedText,
          pdfUrl: s.fileUrl,
          textUrl: s.textUrl,
          extractMethod: s.extractMethod
        }))
      };

      console.log('Payload being sent:', JSON.stringify(payload, null, 2));

      const sheetsRes = await apiFetch(`/api/sessions/${activeSessionId}/answer-sheets`, {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      if (!sheetsRes.ok) throw new Error('Failed to upload answer sheets metadata');

      // 3. Parse paper structure and lock it
      setNeedsManualMarks(false);
      const parseRes = await apiFetch(`/api/sessions/${activeSessionId}/parse-paper`, {
        method: 'POST'
      });
      const parseData = await parseRes.json();

      if (!parseRes.ok) {
        if (parseData.needsManualMarks) {
          setNeedsManualMarks(true);
          setManualQuestions(parseData.questions.map((q: any) => ({ ...q, marksAvailable: 1 })));
          setCurrentStep(4);
          return;
        }
        throw new Error(parseData.error || 'Failed to parse question paper structure');
      }

      setPaperStructure({
        totalMaxMarks: parseData.totalMaxMarks,
        questionCount: parseData.questions?.length || 0,
        mismatchWarning: parseData.mismatchWarning || null
      });

      setCurrentStep(4);
    } catch (error: any) {
      alert(error.message || 'Error parsing paper structure. Please try again.');
    } finally {
      setIsParsingPaper(false);
    }
  };

  const handleStartMarking = async () => {
    setIsMarking(true);

    try {
      if (!sessionId) {
        throw new Error('Session ID is missing. Please go back and try again.');
      }

      // Start marking
      const markRes = await apiFetch(`/api/sessions/${sessionId}/mark`, {
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

      // Start polling progress
      startProgressPolling(sessionId);

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

  const handleStartAnotherSession = () => {
    window.location.href = '/lecturer/sessions/new';
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
              <p className="text-xs font-bold text-navy">Processing {fileData.file?.name}...</p>
              <p className="text-[10px] text-text-muted mt-1">AI requests are queued to avoid rate limits, this may take a moment.</p>
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

  const hasEmptyAnswers = studentSheets
    .filter(s => s.uploaded)
    .some(s => !s.extractedText || s.extractedText.trim().length < 5);

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
                                <div className="flex items-center gap-2 text-xs text-slate-500">
                                  <Loader2 size={14} className="animate-spin text-accent" />
                                  <span>{s.uploadStatus || 'Processing...'}</span>
                                </div>
                              ) : (
                                <button 
                                  onClick={() => document.getElementById(`stu-file-${idx}`)?.click()}
                                  className="text-[10px] font-bold text-accent flex items-center gap-1 hover:underline"
                                >
                                  <Upload size={14} /> Upload PDF/Image
                                </button>
                              )}
                              <input 
                                id={`stu-file-${idx}`}
                                type="file"
                                accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
                                className="hidden"
                                onChange={(e) => {
                                  if (e.target.files?.[0]) {
                                    handleStudentFileUpload(e.target.files[0], idx);
                                    e.target.value = '';
                                  }
                                }}
                              />
                            </div>
                            {s.uploadFailed && (
                              <StudentUploadFailureBox
                                errorMessage={s.errorMessage}
                                retryAvailableAt={s.retryAvailableAt}
                                manualEntryOpen={s.manualEntryOpen}
                                extractedText={s.extractedText}
                                onRetry={() => retryUpload(idx)}
                                onToggleManualEntry={() =>
                                  setStudentSheets(prev =>
                                    prev.map((item, i) => i === idx
                                      ? { ...item, manualEntryOpen: !item.manualEntryOpen }
                                      : item
                                    )
                                  )
                                }
                                onUpdateText={(text) => updateStudentText(idx, text)}
                              />
                            )}
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
                        studentId: '', studentName: '', file: null, fileUrl: '', textUrl: '',
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
                      accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
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
                    <h3 className="text-lg font-bold text-navy">Drop all student PDFs or images here</h3>
                    <p className="text-text-muted mt-2">or click to select multiple files (PDF, JPG, PNG)</p>
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

                        createAndParseSession();
                      }}
                      disabled={isParsingPaper}
                      className="btn-primary flex items-center gap-2"
                    >
                      {isParsingPaper ? (
                        <>
                          <Loader2 size={16} className="animate-spin" />
                          Parsing Paper Structure...
                        </>
                      ) : (
                        <>
                          Confirm & Start <ArrowRight size={18} />
                        </>
                      )}
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
                {needsManualMarks && (
                  <div className="p-6 bg-amber-50/80 border border-amber-200 rounded-2xl mb-4 relative overflow-hidden backdrop-blur-sm">
                    <p className="text-sm font-semibold text-amber-800 mb-1 flex items-center gap-1.5 font-serif">
                      <AlertTriangle size={16} className="text-amber-600" />
                      Couldn't detect mark values automatically
                    </p>
                    <p className="text-xs text-amber-700/80 mb-4 leading-relaxed">
                      Please enter the marks for each question below — this only needs to be done once and will be locked for the whole session.
                    </p>

                    <div className="max-h-60 overflow-y-auto pr-2">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="text-left text-amber-800 border-b border-amber-200/50 pb-2">
                            <th className="pb-2 font-bold uppercase tracking-wider text-[10px]">Q#</th>
                            <th className="pb-2 font-bold uppercase tracking-wider text-[10px]">Question</th>
                            <th className="pb-2 font-bold uppercase tracking-wider text-[10px] w-20">Marks</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-amber-200/30">
                          {manualQuestions.map((q, idx) => (
                            <tr key={idx} className="hover:bg-amber-100/30 transition-colors">
                              <td className="py-2 pr-2 font-bold text-amber-900">{q.questionNumber}</td>
                              <td className="py-2 pr-4 text-amber-950/85 truncate max-w-[200px]" title={q.questionText}>{q.questionText}</td>
                              <td className="py-2">
                                <div className="relative">
                                  <input
                                    type="number"
                                    min="0"
                                    value={q.marksAvailable}
                                    onChange={(e) => {
                                      const updated = [...manualQuestions];
                                      updated[idx].marksAvailable = Number(e.target.value);
                                      setManualQuestions(updated);
                                    }}
                                    className="w-16 px-2 py-1 bg-white border border-amber-300 rounded text-xs font-bold text-amber-950 focus:outline-none focus:ring-2 focus:ring-amber-500"
                                  />
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    <button
                      onClick={async () => {
                        try {
                          const res = await apiFetch(`/api/sessions/${sessionId}/confirm-manual-marks`, {
                            method: 'POST',
                            body: JSON.stringify({ questions: manualQuestions })
                          });
                          if (!res.ok) {
                            throw new Error('Failed to save manual marks');
                          }
                          const data = await res.json();
                          setNeedsManualMarks(false);
                          setPaperStructure({
                            totalMaxMarks: data.totalMaxMarks,
                            questionCount: manualQuestions.length,
                            mismatchWarning: null
                          });
                        } catch (e: any) {
                          alert(e.message || 'Error saving marks');
                        }
                      }}
                      className="mt-4 w-full py-2 bg-navy text-white text-xs font-bold rounded-xl hover:bg-navy/90 transition-all shadow-md shadow-navy/10 flex items-center justify-center gap-1.5"
                    >
                      <Check size={14} /> Confirm Marks & Lock Structure
                    </button>
                  </div>
                )}

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

                  {paperStructure && (
                    <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg mt-4">
                      <p className="text-xs font-semibold text-navy mb-1">Paper Structure (locked)</p>
                      <p className="text-sm text-slate-600">
                        {paperStructure.questionCount} questions found · Total: {paperStructure.totalMaxMarks} marks
                      </p>
                      {paperStructure.mismatchWarning && (
                        <p className="text-xs text-amber-600 mt-2 flex items-start gap-1.5 font-bold">
                          <AlertTriangle size={13} className="shrink-0 mt-0.5" />
                          {paperStructure.mismatchWarning}
                        </p>
                      )}
                      <p className="text-[11px] text-slate-400 mt-2">
                        This total is locked once confirmed — all students in this session will be marked out of {paperStructure.totalMaxMarks}, every time.
                      </p>
                    </div>
                  )}
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
                          <th className="px-4 py-2 font-bold text-text-muted">Extracted Text</th>
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
                            <td className="px-4 py-2 font-semibold">
                              {s.extractedText && s.extractedText.trim().length >= 5 ? (
                                <span className="text-green-600">
                                  ✓ {s.extractedText.length} chars
                                </span>
                              ) : (
                                <span className="text-red-600 font-semibold">
                                  ⚠ EMPTY — will be marked as unanswered
                                </span>
                              )}
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
                    disabled={hasEmptyAnswers || needsManualMarks}
                    className={cn(
                       "btn-accent flex-1 flex items-center justify-center gap-2 shadow-lg shadow-accent/20 group transition-all",
                       (hasEmptyAnswers || needsManualMarks) ? "opacity-50 cursor-not-allowed" : "hover:scale-[1.02]"
                    )}
                  >
                    <Zap size={20} fill="currentColor" className="group-hover:animate-pulse" /> 
                    <span className="font-bold">Save & Start Marking</span>
                  </button>
                </div>
                {hasEmptyAnswers && (
                  <p className="text-xs text-red-600 mt-2 text-center font-bold">
                    Some students have no extracted text. Please go back and re-upload their answer sheets before starting.
                  </p>
                )}
                {needsManualMarks && (
                  <p className="text-xs text-amber-600 mt-2 text-center font-bold">
                    Marks could not be detected. Please confirm the manual marks structure above before starting.
                  </p>
                )}
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
            <div className="max-w-md w-full text-center space-y-8">
              {!markingState ? (
                <>
                  <div className="relative inline-block scale-125">
                     <div className="w-24 h-24 border-4 border-accent/20 rounded-full flex items-center justify-center mx-auto">
                        <div className="w-16 h-16 border-4 border-t-accent border-r-accent/30 border-b-accent/10 border-l-accent/50 rounded-full animate-spin" />
                     </div>
                     <div className="absolute inset-0 flex items-center justify-center">
                        <Zap size={32} className="text-accent animate-pulse" fill="currentColor" />
                     </div>
                  </div>

                  <div className="space-y-2">
                    <h1 className="text-3xl font-serif font-bold text-white tracking-tight">AI is marking papers...</h1>
                    <p className="text-white/50 text-sm max-w-xs mx-auto">Evaluating student submissions against your mark scheme using advanced AI evaluation logic.</p>
                  </div>

                  <div className="bg-white/5 rounded-3xl p-6 border border-white/10 space-y-6">
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

                  <div className="space-y-6">
                    <p className="text-white/40 text-xs leading-relaxed max-w-xs mx-auto">
                      Marking continues in the background even if you leave this page — come back anytime from Sessions to check progress.
                    </p>

                    <div className="flex gap-3 justify-center font-bold">
                      <button
                        onClick={handleStartAnotherSession}
                        className="px-5 py-2.5 bg-white/10 hover:bg-white/20 text-white text-xs font-bold rounded-xl transition-all"
                      >
                        Start Another Session
                      </button>
                      <button
                        onClick={() => navigate('/lecturer/dashboard')}
                        className="px-5 py-2.5 bg-accent hover:bg-accent/90 text-navy font-bold text-xs rounded-xl transition-all shadow-lg shadow-accent/20"
                      >
                        Go to Dashboard
                      </button>
                    </div>
                  </div>
                </>
              ) : markingState === 'CONNECTION_LOST' ? (
                <div className="text-center max-w-md">
                  <AlertTriangle size={32} className="text-amber-400 mx-auto mb-4" />
                  <h2 className="text-xl font-serif font-bold text-white mb-2">
                    Lost connection to the server
                  </h2>
                  <p className="text-white/60 text-sm mb-6">
                    Marking may still be running in the background. Check the Sessions page in a moment to see if it completed.
                  </p>
                  <div className="flex gap-3 justify-center">
                    <button onClick={() => navigate('/lecturer/sessions')} className="px-5 py-2.5 bg-accent text-navy font-semibold text-sm rounded-lg">
                      Check Sessions
                    </button>
                  </div>
                </div>
              ) : markingState === 'TIMEOUT' ? (
                <div className="text-center max-w-md">
                  <Clock size={32} className="text-amber-400 mx-auto mb-4" />
                  <h2 className="text-xl font-serif font-bold text-white mb-2">
                    This is taking longer than expected
                  </h2>
                  <p className="text-white/60 text-sm mb-6">
                    Marking continues in the background. Check the Sessions page shortly for an update.
                  </p>
                  <button onClick={() => navigate('/lecturer/sessions')} className="px-5 py-2.5 bg-accent text-navy font-semibold text-sm rounded-lg">
                    Go to Sessions
                  </button>
                </div>
              ) : null}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </DashboardLayout>
  );
};

export default NewSessionPage;
