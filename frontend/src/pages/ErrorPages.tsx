import React from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'motion/react';
import { ArrowLeft, AlertTriangle } from 'lucide-react';

export const NotFoundPage = () => {
  return (
    <div className="min-h-screen bg-navy flex items-center justify-center p-6 text-center relative overflow-hidden">
      <div className="absolute inset-0 opacity-10 pointer-events-none" 
        style={{ backgroundImage: 'radial-gradient(circle at 2px 2px, white 1px, transparent 0)', backgroundSize: '40px 40px' }}>
      </div>
      
      <motion.div 
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        className="relative z-10"
      >
        <h1 className="text-[180px] font-serif font-bold text-white/10 leading-none mb-[-40px]">404</h1>
        <h2 className="text-4xl text-white font-serif mb-6">Page not found</h2>
        <p className="text-navy-light text-lg mb-10 max-w-md mx-auto">
          The page you are looking for doesn't exist or has been moved to another department.
        </p>
        <Link to="/" className="btn-accent inline-flex items-center gap-2">
          <ArrowLeft size={18} /> Back to Home
        </Link>
      </motion.div>
    </div>
  );
};

export const ErrorBoundary = ({ error, reset }: { error: Error, reset: () => void }) => {
  return (
    <div className="min-h-screen bg-bg flex items-center justify-center p-6 text-center">
      <div className="card max-w-md">
        <div className="w-16 h-16 bg-red-pale text-red rounded-full flex items-center justify-center mx-auto mb-6">
          <AlertTriangle size={32} />
        </div>
        <h2 className="text-2xl text-navy font-serif mb-4">Something went wrong</h2>
        <p className="text-text-mid text-sm mb-8 leading-relaxed">
          An unexpected error occurred. Our team has been notified.
          <br/>
          <span className="text-xs text-text-muted mt-2 block italic">"{error.message}"</span>
        </p>
        <button onClick={reset} className="btn-primary w-full">
          Try again
        </button>
      </div>
    </div>
  );
};
