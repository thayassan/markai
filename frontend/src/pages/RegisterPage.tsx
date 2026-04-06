import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion } from 'motion/react';
import { User, Mail, Lock, GraduationCap, Globe, IdCard, AlertCircle } from 'lucide-react';
import { cn } from '@/src/lib/utils';
import { useAuth } from '../context/AuthContext';

const RegisterPage = () => {
  const [userType, setUserType] = useState<'STUDENT' | 'LECTURER'>('STUDENT');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [studentCode, setStudentCode] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [universityName, setUniversityName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isRegistering, setIsRegistering] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (password !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }

    if (password.length < 8) {
      setError("Password must be at least 8 characters");
      return;
    }

    const passwordRegex = /^(?=.*[A-Z])(?=.*[0-9])/;
    if (!passwordRegex.test(password)) {
      setError("Password must contain at least one uppercase letter and one number");
      return;
    }

    if (userType === 'STUDENT') {
      const codeRegex = /^[A-Za-z0-9-]{4,20}$/;
      if (!codeRegex.test(studentCode)) {
        setError("Student ID must be 4–20 characters, letters, numbers, and hyphens only");
        return;
      }
    }

    if (userType === 'LECTURER' && !inviteCode) {
      setError("Lecturer invite code is required");
      return;
    }

    setIsRegistering(true);
    try {
      const response = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fullName,
          email,
          password,
          userType,
          inviteCode: userType === 'LECTURER' ? inviteCode : undefined,
          studentCode: userType === 'STUDENT' ? studentCode : undefined,
          universityName: userType === 'LECTURER' ? universityName : undefined,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        const errorMessage = Array.isArray(data.error) 
          ? data.error.map((e: any) => e.message).join('. ')
          : (data.error || 'Registration failed');
        throw new Error(errorMessage);
      }

      // Auto-login after successful registration
      await login(email, password);
    } catch (err: any) {
      setError(err.message || 'Failed to register');
    } finally {
      setIsRegistering(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col md:flex-row">
      {/* Left Panel */}
      <div className="hidden md:flex md:w-1/2 bg-navy relative items-center justify-center p-20 overflow-hidden">
        <div className="absolute inset-0 opacity-10" 
          style={{ backgroundImage: 'radial-gradient(circle at 2px 2px, white 1px, transparent 0)', backgroundSize: '40px 40px' }}>
        </div>
        <div className="relative z-10 max-w-md">
          <Link to="/" className="flex items-center gap-3 mb-20">
            <div className="w-10 h-10 bg-white rounded-sm flex items-center justify-center">
              <span className="text-navy font-serif font-bold text-2xl">M</span>
            </div>
            <span className="font-serif font-bold text-2xl text-white">MarkAI</span>
          </Link>
          <h2 className="text-white text-4xl font-serif italic mb-12 leading-tight">
            Join thousands of educators scaling their impact with AI.
          </h2>
          <div className="space-y-6">
            {[
              'Reduce marking time by up to 90%',
              'Standardize grading across departments',
              'Provide instant, high-quality feedback'
            ].map(text => (
              <div key={text} className="flex items-center gap-4 text-white/70">
                <div className="w-6 h-6 rounded-full bg-accent/20 flex items-center justify-center text-accent">
                  <Globe size={14} />
                </div>
                <span className="text-sm">{text}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Right Panel */}
      <div className="flex-1 bg-bg flex items-center justify-center p-6 py-12">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="card w-full max-w-md"
        >
          <h1 className="text-3xl text-navy mb-2">Create account</h1>
          <p className="text-text-muted text-sm mb-8">Start your journey with MarkAI today.</p>

          {/* Role Tabs */}
          <div className="flex p-1 bg-bg rounded-lg mb-8">
            {(['STUDENT', 'LECTURER'] as const).map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => {
                  setUserType(r);
                  setError(null);
                }}
                className={cn(
                  "flex-1 py-2 text-xs font-bold rounded-md transition-all uppercase tracking-widest",
                  userType === r ? "bg-white text-navy shadow-sm" : "text-text-muted hover:text-text-mid"
                )}
              >
                {r}
              </button>
            ))}
          </div>

          {error && (
            <div className="mb-6 p-4 bg-red-50 border border-red-100 rounded-lg flex items-center gap-3 text-red-600 text-sm">
              <AlertCircle size={18} />
              {error}
            </div>
          )}

          <form onSubmit={handleRegister} className="space-y-5">
            <div>
              <label className="block text-xs font-bold text-navy uppercase tracking-widest mb-2">Full Name</label>
              <div className="relative">
                <User className="absolute left-4 top-1/2 -translate-y-1/2 text-text-muted" size={18} />
                <input 
                  type="text" 
                  required
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="John Doe"
                  autoComplete="name"
                  className="w-full pl-12 pr-4 py-3 bg-bg border border-border rounded-button focus:outline-none focus:ring-2 focus:ring-accent/50 transition-all"
                />
              </div>
            </div>

            {userType === 'LECTURER' && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
              >
                <label className="block text-xs font-bold text-navy uppercase tracking-widest mb-2">Lecturer Invite Code</label>
                <div className="relative">
                  <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-text-muted" size={18} />
                  <input 
                    type="text" 
                    required={userType === 'LECTURER'}
                    value={inviteCode}
                    onChange={(e) => setInviteCode(e.target.value)}
                    placeholder="Enter your invitation code"
                    className="w-full pl-12 pr-4 py-3 bg-bg border border-border rounded-button focus:outline-none focus:ring-2 focus:ring-accent/50 transition-all"
                  />
                </div>
              </motion.div>
            )}

            {userType === 'STUDENT' && (
              <div>
                <label className="block text-xs font-bold text-navy uppercase tracking-widest mb-2">Student ID</label>
                <div className="relative">
                  <IdCard className="absolute left-4 top-1/2 -translate-y-1/2 text-text-muted" size={18} />
                  <input 
                    type="text" 
                    required={userType === 'STUDENT'}
                    value={studentCode}
                    onChange={(e) => setStudentCode(e.target.value)}
                    placeholder="e.g. S2024-0042"
                    className="w-full pl-12 pr-4 py-3 bg-bg border border-border rounded-button focus:outline-none focus:ring-2 focus:ring-accent/50 transition-all"
                  />
                </div>
              </div>
            )}

            <div>
              <label className="block text-xs font-bold text-navy uppercase tracking-widest mb-2">Email Address</label>
              <div className="relative">
                <Mail className="absolute left-4 top-1/2 -translate-y-1/2 text-text-muted" size={18} />
                <input 
                  type="email" 
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@institution.edu"
                  autoComplete="email"
                  className="w-full pl-12 pr-4 py-3 bg-bg border border-border rounded-button focus:outline-none focus:ring-2 focus:ring-accent/50 transition-all"
                />
              </div>
            </div>

            {userType === 'LECTURER' && (
              <div>
                <label className="block text-xs font-bold text-navy uppercase tracking-widest mb-2">University / Institution</label>
                <div className="relative">
                  <GraduationCap className="absolute left-4 top-1/2 -translate-y-1/2 text-text-muted" size={18} />
                  <input 
                    type="text" 
                    required={userType === 'LECTURER'}
                    value={universityName}
                    onChange={(e) => setUniversityName(e.target.value)}
                    placeholder="University of Excellence"
                    className="w-full pl-12 pr-4 py-3 bg-bg border border-border rounded-button focus:outline-none focus:ring-2 focus:ring-accent/50 transition-all"
                  />
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-bold text-navy uppercase tracking-widest mb-2">Password</label>
                <input 
                  type="password" 
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  autoComplete="new-password"
                  className="w-full px-4 py-3 bg-bg border border-border rounded-button focus:outline-none focus:ring-2 focus:ring-accent/50 transition-all"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-navy uppercase tracking-widest mb-2">Confirm</label>
                <input 
                  type="password" 
                  required
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="••••••••"
                  autoComplete="new-password"
                  className="w-full px-4 py-3 bg-bg border border-border rounded-button focus:outline-none focus:ring-2 focus:ring-accent/50 transition-all"
                />
              </div>
            </div>

            <label className="flex items-start gap-3 cursor-pointer py-2">
              <input type="checkbox" required className="mt-1 w-4 h-4 rounded border-border text-navy focus:ring-navy" />
              <span className="text-xs text-text-mid leading-relaxed">
                I agree to the <a href="#" className="text-navy font-bold hover:underline">Terms of Service</a> and <a href="#" className="text-navy font-bold hover:underline">Privacy Policy</a>.
              </span>
            </label>

            <button type="submit" disabled={isRegistering} className="btn-primary w-full disabled:opacity-50 disabled:cursor-not-allowed">
              {isRegistering ? 'Creating account...' : 'Create account'}
            </button>
          </form>

          <p className="text-center text-sm text-text-mid mt-8">
            Already have an account? <Link to="/login" className="text-navy font-bold hover:underline">Sign in</Link>
          </p>
        </motion.div>
      </div>
    </div>
  );
};

export default RegisterPage;
