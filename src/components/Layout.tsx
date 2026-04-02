import React, { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import { Menu, X } from 'lucide-react';
import { cn } from '@/src/lib/utils';
import { useAuth } from '../context/AuthContext';

export const Navbar = () => {
  const { user, logout } = useAuth();
  const location = useLocation();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const role = user?.role || 'STUDENT';
  const dashboardPath = user ? (role === 'STUDENT' ? '/dashboard' : role === 'LECTURER' ? '/lecturer/dashboard' : '/admin/dashboard') : '/register';

  const navItems = [
    { label: 'Home', path: '/' },
    { label: 'Dashboard', path: role === 'STUDENT' ? '/dashboard' : role === 'LECTURER' ? '/lecturer/dashboard' : '/admin/dashboard' },
    ...(role !== 'SCHOOL_ADMIN' ? [{ label: role === 'STUDENT' ? 'My Papers' : 'Sessions', path: role === 'STUDENT' ? '/papers' : '/lecturer/sessions' }] : []),
    { label: 'Progress', path: '/progress' },
    { label: 'Profile', path: '/profile' },
    { label: 'Settings', path: '/settings' },
  ];

  return (
    <>
      <motion.nav 
        initial={{ y: -100 }}
        animate={{ y: 0 }}
        className="fixed top-0 left-0 right-0 z-50 bg-surface/80 backdrop-blur-md border-b border-border"
      >
        <div className="max-w-7xl mx-auto px-6 h-20 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-3">
            <div className="w-10 h-10 bg-navy rounded-sm flex items-center justify-center">
              <span className="text-white font-serif font-bold text-2xl">M</span>
            </div>
            <span className="font-serif font-bold text-2xl text-navy">MarkAI</span>
          </Link>

          <div className="flex items-center gap-4 sm:gap-8">
            {user && (
              <div className="hidden md:flex items-center gap-8">
                {navItems.map((item) => {
                  const isActive = location.pathname === item.path;
                  return (
                    <Link 
                      key={item.label} 
                      to={item.path} 
                      className={cn(
                        "transition-colors font-medium",
                        isActive ? "text-accent" : "text-text-mid hover:text-accent"
                      )}
                    >
                      {item.label}
                    </Link>
                  );
                })}
              </div>
            )}

            <div className="flex items-center gap-2 sm:gap-4">
              {!user ? (
                <>
                  <Link to="/login" className="text-navy font-medium px-2 sm:px-4 py-2 hover:opacity-70 transition-opacity text-sm sm:text-base">
                    Sign in
                  </Link>
                  <Link to="/register" className="btn-primary text-sm sm:text-base px-4 py-2 sm:px-6 sm:py-3">
                    <span className="hidden sm:inline">Get started free</span>
                    <span className="sm:hidden">Get started</span>
                  </Link>
                </>
              ) : (
                <div className="flex items-center gap-2 sm:gap-4">
                  <button 
                    onClick={() => logout()}
                    className="hidden md:block text-navy font-medium px-2 sm:px-4 py-2 hover:text-red transition-colors text-sm sm:text-base"
                  >
                    Logout
                  </button>
                  <button 
                    className="md:hidden p-2 text-navy hover:bg-black/5 rounded-lg transition-colors"
                    onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
                  >
                    {isMobileMenuOpen ? <X size={24} /> : <Menu size={24} />}
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </motion.nav>

      {/* Mobile Menu */}
      <AnimatePresence>
        {isMobileMenuOpen && user && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="fixed top-20 left-0 right-0 z-40 bg-surface border-b border-border shadow-xl md:hidden"
          >
            <div className="p-4 flex flex-col gap-2">
              {navItems.map((item) => {
                const isActive = location.pathname === item.path;
                return (
                  <Link
                    key={item.label}
                    to={item.path}
                    onClick={() => setIsMobileMenuOpen(false)}
                    className={cn(
                      "px-4 py-3 rounded-lg font-medium transition-colors",
                      isActive ? "bg-accent/10 text-accent" : "text-text-mid hover:bg-black/5 hover:text-navy"
                    )}
                  >
                    {item.label}
                  </Link>
                );
              })}
              <div className="h-px bg-border my-2" />
              <button
                onClick={() => {
                  logout();
                  setIsMobileMenuOpen(false);
                }}
                className="px-4 py-3 text-left text-red font-medium hover:bg-red/5 rounded-lg transition-colors"
              >
                Logout
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
};

export const Footer = () => {
  return (
    <footer className="bg-navy text-white pt-20 pb-10">
      <div className="max-w-7xl mx-auto px-6 grid grid-cols-1 md:grid-cols-4 gap-12">
        <div className="col-span-1 md:col-span-1">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-8 h-8 bg-white rounded-sm flex items-center justify-center">
              <span className="text-navy font-serif font-bold text-xl">M</span>
            </div>
            <span className="font-serif font-bold text-xl">MarkAI</span>
          </div>
          <p className="text-gray-300 text-sm leading-relaxed">
            Empowering educators with AI-driven precision. Mark papers in minutes, not hours.
          </p>
        </div>
        
        <div>
          <h4 className="font-serif font-bold mb-6 text-white">Product</h4>
          <ul className="space-y-4 text-sm text-gray-300">
            <li><a href="#features" className="hover:text-white transition-colors">Features</a></li>
            <li><a href="#" className="hover:text-white transition-colors">Pricing</a></li>
            <li><a href="#" className="hover:text-white transition-colors">AI Marking</a></li>
          </ul>
        </div>

        <div>
          <h4 className="font-serif font-bold mb-6 text-white">Support</h4>
          <ul className="space-y-4 text-sm text-gray-300">
            <li><a href="#" className="hover:text-white transition-colors">Help Center</a></li>
            <li><a href="#" className="hover:text-white transition-colors">API Docs</a></li>
            <li><a href="#" className="hover:text-white transition-colors">Contact</a></li>
          </ul>
        </div>

        <div>
          <h4 className="font-serif font-bold mb-6 text-white">Company</h4>
          <ul className="space-y-4 text-sm text-gray-300">
            <li><a href="#" className="hover:text-white transition-colors">About Us</a></li>
            <li><a href="#" className="hover:text-white transition-colors">Careers</a></li>
            <li><a href="#" className="hover:text-white transition-colors">Privacy</a></li>
          </ul>
        </div>
      </div>
      
      <div className="max-w-7xl mx-auto px-6 mt-20 pt-8 border-t border-white/10 flex flex-col md:flex-row justify-between items-center gap-4 text-xs text-gray-300 uppercase tracking-widest">
        <p>© 2026 MarkAI Technologies. All rights reserved.</p>
        <div className="flex gap-8">
          <a href="#" className="hover:text-white transition-colors">Terms of Service</a>
          <a href="#" className="hover:text-white transition-colors">Privacy Policy</a>
        </div>
      </div>
    </footer>
  );
};
