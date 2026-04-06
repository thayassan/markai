import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion } from 'motion/react';
import { Eye, EyeOff, Mail, Lock, Globe, AlertCircle } from 'lucide-react';
import { cn } from '@/src/lib/utils';
import { useAuth } from '../context/AuthContext';

const LoginPage = () => {
  const [userType, setUserType] = useState<'STUDENT' | 'LECTURER' | 'ADMIN'>('LECTURER');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const { login } = useAuth();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsLoggingIn(true);
    try {
      await login(email, password);
    } catch (err: any) {
      setError(err.message || 'Failed to sign in');
    } finally {
      setIsLoggingIn(false);
    }
  };

  // Helper to quickly fill credentials for demo
  const fillDemoCredentials = (r: typeof userType) => {
    setUserType(r);
    if (r === 'STUDENT') {
      setEmail('student@markai.demo');
      setPassword('Student@1234');
    } else if (r === 'LECTURER') {
      setEmail('lecturer@markai.demo');
      setPassword('Lecturer@1234');
    } else if (r === 'ADMIN') {
      setEmail('admin@markai.demo');
      setPassword('Admin@1234');
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
            "The most significant advancement in educational technology I've seen in a decade."
          </h2>
          <div className="grid grid-cols-3 gap-8">
            <div>
              <p className="text-accent text-2xl font-serif font-bold">98%</p>
              <p className="text-white/50 text-xs uppercase tracking-widest">Accuracy</p>
            </div>
            <div>
              <p className="text-gold text-2xl font-serif font-bold">15h+</p>
              <p className="text-white/50 text-xs uppercase tracking-widest">Saved/Week</p>
            </div>
            <div>
              <p className="text-accent text-2xl font-serif font-bold">40+</p>
              <p className="text-white/50 text-xs uppercase tracking-widest">Courses</p>
            </div>
          </div>
        </div>
      </div>

      {/* Right Panel */}
      <div className="flex-1 bg-bg flex items-center justify-center p-6">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="card w-full max-w-md"
        >
          <h1 className="text-3xl text-navy mb-2">Welcome back</h1>
          <p className="text-text-muted text-sm mb-8">Please enter your details to sign in.</p>

          <div className="flex flex-col sm:flex-row p-1 bg-bg rounded-lg mb-8 gap-1 sm:gap-0">
            {(['STUDENT', 'LECTURER', 'ADMIN'] as const).map((r) => (
              <button
                key={r}
                onClick={() => fillDemoCredentials(r)}
                className={cn(
                  "flex-1 py-2 text-xs font-bold rounded-md transition-all",
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

          <form onSubmit={handleLogin} className="space-y-6">
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

            <div>
              <label className="block text-xs font-bold text-navy uppercase tracking-widest mb-2">Password</label>
              <div className="relative">
                <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-text-muted" size={18} />
                <input 
                  type={showPassword ? "text" : "password"} 
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  autoComplete="current-password"
                  className="w-full pl-12 pr-12 py-3 bg-bg border border-border rounded-button focus:outline-none focus:ring-2 focus:ring-accent/50 transition-all"
                />
                <button 
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-text-muted hover:text-navy transition-colors"
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>

            <div className="flex items-center justify-between">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" className="w-4 h-4 rounded border-border text-navy focus:ring-navy" />
                <span className="text-xs text-text-mid">Remember me</span>
              </label>
              <a href="#" className="text-xs text-navy font-bold hover:underline">Forgot password?</a>
            </div>

            <button type="submit" disabled={isLoggingIn} className="btn-primary w-full disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.98]">
              {isLoggingIn ? 'Signing in...' : `Sign in as ${userType.toLowerCase().replace('_', ' ')}`}
            </button>

            <div className="relative py-4">
              <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-border"></div></div>
              <div className="relative flex justify-center text-xs uppercase tracking-widest"><span className="bg-white px-4 text-text-muted">Or continue with</span></div>
            </div>

            <button 
              type="button" 
              onClick={() => alert("Google login is not implemented in this demo. Please use the email login.")}
              className="w-full py-3 border border-border rounded-button flex items-center justify-center gap-3 hover:bg-bg transition-colors font-medium text-navy"
            >
              <Globe size={18} /> Google Account
            </button>
          </form>

          <p className="text-center text-sm text-text-mid mt-8">
            Don't have an account? <Link to="/register" className="text-navy font-bold hover:underline">Register here</Link>
          </p>
        </motion.div>
      </div>
    </div>
  );
};

export default LoginPage;
