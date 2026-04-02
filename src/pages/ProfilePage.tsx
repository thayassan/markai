import React, { useState } from 'react';
import { DashboardLayout } from '@/src/components/DashboardLayout';
import { User, Mail, Phone, MapPin, Camera, Save, Shield, Bell, CheckCircle2 } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useAuth } from '../context/AuthContext';

const ProfilePage = () => {
  const { user } = useAuth();
  const [isSaving, setIsSaving] = useState(false);
  const [showToast, setShowToast] = useState(false);

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    setTimeout(() => {
      setIsSaving(false);
      setShowToast(true);
      setTimeout(() => setShowToast(false), 3000);
    }, 1000);
  };

  const getInitials = (name: string) => {
    return name.split(' ').map(n => n[0]).join('').toUpperCase();
  };

  return (
    <DashboardLayout>
      <div className="mb-10">
        <h1 className="text-3xl text-navy mb-2">My Profile</h1>
        <p className="text-text-muted">Manage your personal information and account settings.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-1 space-y-8">
          <div className="card text-center p-10">
            <div className="relative inline-block group mb-6">
              <div className="w-32 h-32 rounded-full bg-navy flex items-center justify-center text-white text-4xl font-bold border-4 border-white shadow-xl">
                {user ? getInitials(user.name) : '??'}
              </div>
              <button 
                onClick={() => console.log('Opening camera/file picker for profile picture...')}
                className="absolute bottom-0 right-0 w-10 h-10 bg-accent text-white rounded-full flex items-center justify-center border-4 border-white shadow-lg hover:scale-110 transition-transform"
              >
                <Camera size={18} />
              </button>
            </div>
            <h2 className="text-2xl font-serif font-bold text-navy mb-1">{user?.name || 'User Name'}</h2>
            <p className="text-text-muted text-sm mb-6 uppercase tracking-widest font-bold">
              {user?.role === 'LECTURER' ? 'Senior Lecturer • Science' : 
               user?.role === 'STUDENT' ? 'Student • Year 13' : 
               'School Administrator'}
            </p>
            <div className="flex justify-center gap-3">
              <div className="badge bg-navy/10 text-navy">Verified</div>
              <div className="badge bg-accent-pale text-accent">Pro Plan</div>
            </div>
          </div>

          <div className="card p-8">
            <h3 className="text-sm font-bold text-navy uppercase tracking-widest mb-6">Account Status</h3>
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Shield size={18} className="text-text-muted" />
                  <span className="text-sm font-medium text-navy">Two-Factor Auth</span>
                </div>
                <button 
                  onClick={() => console.log('Toggling 2FA...')}
                  className="w-10 h-5 bg-accent rounded-full relative"
                >
                  <div className="absolute top-1 left-6 w-3 h-3 bg-white rounded-full"></div>
                </button>
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Bell size={18} className="text-text-muted" />
                  <span className="text-sm font-medium text-navy">Email Alerts</span>
                </div>
                <button 
                  onClick={() => console.log('Toggling email alerts...')}
                  className="w-10 h-5 bg-accent rounded-full relative"
                >
                  <div className="absolute top-1 left-6 w-3 h-3 bg-white rounded-full"></div>
                </button>
              </div>
            </div>
          </div>
        </div>

        <div className="lg:col-span-2">
          <div className="card p-10">
            <h3 className="text-xl font-serif font-bold text-navy mb-8">Personal Information</h3>
            <form onSubmit={handleSave} className="space-y-8">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                <div>
                  <label className="block text-xs font-bold text-navy uppercase tracking-widest mb-3">Full Name</label>
                  <div className="relative">
                    <User className="absolute left-4 top-1/2 -translate-y-1/2 text-text-muted" size={18} />
                    <input 
                      type="text" 
                      defaultValue={user?.name} 
                      className="w-full pl-12 pr-4 py-3 bg-bg border border-border rounded-button focus:outline-none focus:border-accent transition-colors" 
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-bold text-navy uppercase tracking-widest mb-3">Email Address</label>
                  <div className="relative">
                    <Mail className="absolute left-4 top-1/2 -translate-y-1/2 text-text-muted" size={18} />
                    <input 
                      type="email" 
                      defaultValue={user?.email} 
                      className="w-full pl-12 pr-4 py-3 bg-bg border border-border rounded-button focus:outline-none focus:border-accent transition-colors" 
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-bold text-navy uppercase tracking-widest mb-3">Phone Number</label>
                  <div className="relative">
                    <Phone className="absolute left-4 top-1/2 -translate-y-1/2 text-text-muted" size={18} />
                    <input 
                      type="tel" 
                      defaultValue={user?.role === 'LECTURER' ? '+234 803 123 4567' : '+234 803 987 6543'} 
                      className="w-full pl-12 pr-4 py-3 bg-bg border border-border rounded-button focus:outline-none focus:border-accent transition-colors" 
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-bold text-navy uppercase tracking-widest mb-3">Location</label>
                  <div className="relative">
                    <MapPin className="absolute left-4 top-1/2 -translate-y-1/2 text-text-muted" size={18} />
                    <input 
                      type="text" 
                      defaultValue="Lagos, Nigeria" 
                      className="w-full pl-12 pr-4 py-3 bg-bg border border-border rounded-button focus:outline-none focus:border-accent transition-colors" 
                    />
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-navy uppercase tracking-widest mb-3">Bio</label>
                <textarea 
                  rows={4} 
                  defaultValue={user?.role === 'LECTURER' ? "Senior lecturer in the Science department with over 15 years of experience in academic assessment and curriculum development." : "Final year IB student focused on Biology and Chemistry. Aspiring medical student."}
                  className="w-full p-4 bg-bg border border-border rounded-button focus:outline-none focus:border-accent transition-colors resize-none"
                ></textarea>
              </div>

              <div className="pt-6 border-t border-border flex justify-end">
                <button 
                  type="submit" 
                  disabled={isSaving}
                  className="btn-primary flex items-center gap-2 disabled:opacity-50"
                >
                  {isSaving ? (
                    <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                  ) : (
                    <Save size={18} />
                  )}
                  {isSaving ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>

      <AnimatePresence>
        {showToast && (
          <motion.div 
            initial={{ opacity: 0, y: 50 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 50 }}
            className="fixed bottom-8 right-8 z-[100] bg-navy text-white px-6 py-3 rounded-button shadow-2xl flex items-center gap-3 border border-white/10"
          >
            <CheckCircle2 size={18} className="text-accent" />
            <span className="text-sm font-medium">Profile updated successfully!</span>
          </motion.div>
        )}
      </AnimatePresence>
    </DashboardLayout>
  );
};

export default ProfilePage;
