import React, { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { DashboardLayout } from '@/src/components/DashboardLayout';
import { User, Bell, Shield, CreditCard, Camera, Save, CheckCircle2, Star, Send, Eye, EyeOff } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '@/src/lib/utils';
import { useAuth } from '../context/AuthContext';

const SettingsPage = () => {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState<'profile' | 'notifications' | 'security' | 'billing' | 'feedback'>((searchParams.get('tab') as any) || 'profile');
  const [isSaving, setIsSaving] = useState(false);
  const [showToast, setShowToast] = useState(false);
  const [notifications, setNotifications] = useState({
    marking: true,
    reports: true,
    performance: false
  });
  const [rating, setRating] = useState(0);
  const [feedbackText, setFeedbackText] = useState('');
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);

  React.useEffect(() => {
    const existingFeedback = JSON.parse(localStorage.getItem('userFeedback') || '[]');
    const userFeedback = existingFeedback.find((f: any) => f.userEmail === user?.email);
    if (userFeedback) {
      setRating(userFeedback.rating);
      setFeedbackText(userFeedback.quote);
    }
  }, [user]);

  const handleSave = () => {
    setIsSaving(true);
    setTimeout(() => {
      setIsSaving(false);
      setShowToast(true);
      setTimeout(() => setShowToast(false), 3000);
      console.log('Settings saved successfully!');
    }, 1000);
  };

  const handleUpgrade = () => console.log('Redirecting to subscription plans...');
  const handlePhotoUpload = () => console.log('Opening file picker for profile picture...');

  const getInitials = (name: string) => {
    return name.split(' ').map(n => n[0]).join('').toUpperCase();
  };

  const handleDeleteFeedback = () => {
    const existingFeedback = JSON.parse(localStorage.getItem('userFeedback') || '[]');
    const filteredFeedback = existingFeedback.filter((f: any) => f.userEmail !== user?.email);
    localStorage.setItem('userFeedback', JSON.stringify(filteredFeedback));
    
    setRating(0);
    setFeedbackText('');
    setShowToast(true);
    setTimeout(() => setShowToast(false), 3000);
  };

  const handleFeedbackSubmit = () => {
    const newFeedback = { name: user?.name || 'Anonymous', role: user?.role || 'User', inst: 'N/A', quote: feedbackText, rating, userEmail: user?.email };
    const existingFeedback = JSON.parse(localStorage.getItem('userFeedback') || '[]');
    const filteredFeedback = existingFeedback.filter((f: any) => f.userEmail !== user?.email);
    localStorage.setItem('userFeedback', JSON.stringify([newFeedback, ...filteredFeedback]));
    
    console.log('Feedback submitted:', { rating, feedbackText });
    setShowToast(true);
    setTimeout(() => setShowToast(false), 3000);
  };

  return (
    <DashboardLayout>
      <div className="mb-10">
        <h1 className="text-3xl text-navy mb-2">Settings</h1>
        <p className="text-text-muted">Manage your account preferences and subscription.</p>
      </div>

      <div className="flex flex-col lg:flex-row gap-8">
        <div className="lg:w-64 space-y-1">
          {[
            { id: 'profile', label: 'Profile', icon: User },
            { id: 'notifications', label: 'Notifications', icon: Bell },
            { id: 'security', label: 'Security', icon: Shield },
            { id: 'billing', label: 'Billing', icon: CreditCard },
            { id: 'feedback', label: 'Feedback', icon: Send },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => { setActiveTab(tab.id as any); setSearchParams({ tab: tab.id }); }}
              className={cn(
                "w-full flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-bold transition-all",
                activeTab === tab.id ? "bg-navy text-white shadow-md" : "text-text-muted hover:bg-white hover:text-navy"
              )}
            >
              <tab.icon size={18} />
              {tab.label}
            </button>
          ))}
        </div>

        <div className="flex-1">
          <div className="card p-8">
            {activeTab === 'profile' && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-8">
                <div className="flex items-center gap-8">
                  <div className="relative group">
                    <div className="w-24 h-24 rounded-full bg-navy flex items-center justify-center text-white text-3xl font-bold">
                      {user ? getInitials(user.name) : '??'}
                    </div>
                    <button 
                      onClick={handlePhotoUpload}
                      className="absolute inset-0 bg-navy/60 rounded-full opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white"
                    >
                      <Camera size={20} />
                    </button>
                  </div>
                  <div>
                    <h3 className="text-lg font-serif font-bold text-navy">Profile Picture</h3>
                    <p className="text-text-muted text-sm">JPG, GIF or PNG. Max size of 800K</p>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <label className="block text-xs font-bold text-navy uppercase tracking-widest mb-2">Full Name</label>
                    <input type="text" defaultValue={user?.name} className="w-full px-4 py-3 bg-bg border border-border rounded-button focus:outline-none focus:border-accent transition-colors" />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-navy uppercase tracking-widest mb-2">Email Address</label>
                    <input type="email" defaultValue={user?.email} className="w-full px-4 py-3 bg-bg border border-border rounded-button focus:outline-none focus:border-accent transition-colors" />
                  </div>
                  {user?.role === 'STUDENT' && (
                    <div>
                      <label className="block text-xs font-bold text-navy uppercase tracking-widest mb-2">Student ID</label>
                      <input 
                        type="text" 
                        defaultValue={user?.studentCode || ''} 
                        className="w-full px-4 py-3 bg-bg border border-border rounded-button focus:outline-none focus:border-accent transition-colors" 
                      />
                    </div>
                  )}
                </div>

                <div className="pt-6 border-t border-border flex justify-end">
                  <button 
                    onClick={handleSave} 
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
              </motion.div>
            )}

            {activeTab === 'notifications' && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
                <h3 className="text-lg font-serif font-bold text-navy mb-6">Email Notifications</h3>
                <div className="space-y-4">
                  {[
                    { id: 'marking', label: 'Marking Complete', desc: 'Notify me when a marking session finishes processing.' },
                    { id: 'reports', label: 'Student Reports Ready', desc: 'Notify me when PDF reports are generated and ready for download.' },
                    { id: 'performance', label: 'Class Performance Alerts', desc: 'Notify me if a class average falls below a certain threshold.' }
                  ].map((item) => (
                    <div key={item.id} className="flex items-center justify-between p-4 bg-bg rounded-lg">
                      <div>
                        <p className="text-sm font-bold text-navy">{item.label}</p>
                        <p className="text-xs text-text-muted">{item.desc}</p>
                      </div>
                      <button 
                        onClick={() => setNotifications(prev => ({ ...prev, [item.id]: !prev[item.id as keyof typeof prev] }))}
                        className={cn(
                          "w-12 h-6 rounded-full relative transition-colors",
                          notifications[item.id as keyof typeof notifications] ? "bg-accent" : "bg-border"
                        )}
                      >
                        <div className={cn(
                          "absolute top-1 w-4 h-4 bg-white rounded-full transition-all",
                          notifications[item.id as keyof typeof notifications] ? "left-7" : "left-1"
                        )}></div>
                      </button>
                    </div>
                  ))}
                </div>
              </motion.div>
            )}

            {activeTab === 'billing' && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-8">
                <div className="p-6 bg-navy rounded-xl text-white flex justify-between items-center">
                  <div>
                    <p className="text-xs font-bold uppercase tracking-widest opacity-60 mb-1">Current Plan</p>
                    <h3 className="text-2xl font-serif font-bold">
                      {user?.role === 'LECTURER' ? 'Lecturer Pro' : user?.role === 'SCHOOL_ADMIN' ? 'Institution Admin' : 'Student Free'}
                    </h3>
                  </div>
                  <div className="badge bg-accent text-navy">Active</div>
                </div>

                <div className="space-y-4">
                  <div className="flex justify-between items-center text-sm">
                    <span className="text-text-mid">
                      {user?.role === 'LECTURER' ? 'Papers marked this month' : 'Storage used'}
                    </span>
                    <span className="font-bold text-navy">
                      {user?.role === 'LECTURER' ? '842 / 2,000' : '1.2 GB / 5 GB'}
                    </span>
                  </div>
                  <div className="w-full h-2 bg-bg rounded-full overflow-hidden">
                    <div className="h-full bg-accent" style={{ width: user?.role === 'LECTURER' ? '42%' : '24%' }}></div>
                  </div>
                </div>

                <div className="pt-6 border-t border-border">
                  <button onClick={handleUpgrade} className="btn-accent w-full">Upgrade Plan</button>
                </div>
              </motion.div>
            )}

            {activeTab === 'security' && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
                <h3 className="text-lg font-serif font-bold text-navy mb-6">Security Settings</h3>
                <div className="space-y-6">
                  <div className="relative">
                    <label className="block text-xs font-bold text-navy uppercase tracking-widest mb-2">Current Password</label>
                    <input type={showCurrentPassword ? "text" : "password"} placeholder="••••••••" className="w-full px-4 py-3 bg-bg border border-border rounded-button focus:outline-none focus:border-accent transition-colors" />
                    <button type="button" onClick={() => setShowCurrentPassword(!showCurrentPassword)} className="absolute right-3 top-[38px] text-text-muted hover:text-navy">
                      {showCurrentPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                    </button>
                  </div>
                  <div className="relative">
                    <label className="block text-xs font-bold text-navy uppercase tracking-widest mb-2">New Password</label>
                    <input type={showNewPassword ? "text" : "password"} placeholder="••••••••" className="w-full px-4 py-3 bg-bg border border-border rounded-button focus:outline-none focus:border-accent transition-colors" />
                    <button type="button" onClick={() => setShowNewPassword(!showNewPassword)} className="absolute right-3 top-[38px] text-text-muted hover:text-navy">
                      {showNewPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                    </button>
                  </div>
                  <div className="pt-4">
                    <button onClick={handleSave} className="btn-primary">Update Password</button>
                  </div>
                </div>
              </motion.div>
            )}

            {activeTab === 'feedback' && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
                <h3 className="text-lg font-serif font-bold text-navy mb-6">Send us Feedback</h3>
                <div className="space-y-4">
                  <div>
                    <label className="block text-xs font-bold text-navy uppercase tracking-widest mb-2">Rating</label>
                    <div className="flex gap-2">
                      {[1, 2, 3, 4, 5].map((star) => (
                        <button key={star} onClick={() => setRating(star)} className={cn("p-2 rounded-full transition-colors", rating >= star ? "text-gold" : "text-border")}>
                          <Star size={32} fill={rating >= star ? "currentColor" : "none"} />
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-navy uppercase tracking-widest mb-2">Your Feedback</label>
                    <textarea 
                      value={feedbackText} 
                      onChange={(e) => setFeedbackText(e.target.value)}
                      placeholder="Tell us what you think..." 
                      className="w-full px-4 py-3 bg-bg border border-border rounded-button focus:outline-none focus:border-accent transition-colors h-32" 
                    />
                  </div>
                  <div className="pt-4 flex gap-4">
                    <button onClick={handleFeedbackSubmit} className="btn-primary flex items-center gap-2">
                      <Send size={18} /> {rating > 0 || feedbackText !== '' ? 'Update Feedback' : 'Submit Feedback'}
                    </button>
                    {(rating > 0 || feedbackText !== '') && (
                      <button onClick={handleDeleteFeedback} className="px-4 py-2 rounded-button bg-red-100 text-red-600 font-bold hover:bg-red-200 transition-colors">
                        Delete Feedback
                      </button>
                    )}
                  </div>
                </div>
              </motion.div>
            )}
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
            <span className="text-sm font-medium">Action completed successfully!</span>
          </motion.div>
        )}
      </AnimatePresence>
    </DashboardLayout>
  );
};

export default SettingsPage;
