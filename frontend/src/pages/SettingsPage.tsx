import React, { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { DashboardLayout } from '@/src/components/DashboardLayout';
import { User, Bell, Shield, CreditCard, Camera, Save, CheckCircle2, Star, Send, Eye, EyeOff } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '@/src/lib/utils';
import { useAuth } from '../context/AuthContext';
import { apiFetch } from '../lib/api';

const SettingsPage = () => {
  const { user, login } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState<'profile' | 'notifications' | 'security' | 'billing' | 'feedback'>((searchParams.get('tab') as any) || 'profile');
  const [isSaving, setIsSaving] = useState(false);
  const [showToast, setShowToast] = useState(false);
  const [toastMessage, setToastMessage] = useState('Action completed successfully!');
  
  // Profile States
  const [profileData, setProfileData] = useState({
    fullName: user?.fullName || '',
    email: user?.email || '',
    phoneNumber: user?.phoneNumber || '',
    location: user?.location || '',
    bio: user?.bio || '',
    department: user?.department || '',
    role: user?.role || ''
  });

  // Settings States
  const [twoFactorAuth, setTwoFactorAuth] = useState<boolean>(user?.twoFactorAuth ?? false);
  const [emailAlerts, setEmailAlerts] = useState<boolean>(user?.emailAlerts ?? true);
  
  // Security States
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);

  // Feedback States
  const [rating, setRating] = useState(0);
  const [feedbackText, setFeedbackText] = useState('');


  React.useEffect(() => {
    const fetchUserData = async () => {
      try {
        const res = await apiFetch('/api/auth/me');
        if (res.ok) {
          const data = await res.json();
          setProfileData({
            fullName: data.fullName,
            email: data.email,
            phoneNumber: data.phoneNumber || '',
            location: data.location || '',
            bio: data.bio || '',
            department: data.department || '',
            role: data.role || ''
          });
          setTwoFactorAuth(data.twoFactorAuth);
          setEmailAlerts(data.emailAlerts);
        }
      } catch (err) {
        console.error('Failed to fetch user data in SettingsPage:', err);
      }
    };
    fetchUserData();
  }, []);

  const showSuccess = (msg: string) => {
    setToastMessage(msg);
    setShowToast(true);
    setTimeout(() => setShowToast(false), 3000);
  };

  const handleSaveProfile = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setIsSaving(true);
    try {
      const res = await apiFetch('/api/profile', {
        method: 'PUT',
        body: JSON.stringify(profileData)
      });
      const result = await res.json();
      if (res.ok) {
        showSuccess('Saved successfully!');
      } else {
        alert(result.error || 'Failed to update profile');
      }
    } catch (err: any) {
      if (err.name !== 'UnauthorizedError') {
        alert(err.message || 'An error occurred while saving');
      }
    } finally {
      setIsSaving(false);
    }
  };

  const handleUpdateSettings = async (updates: any) => {
    try {
      await apiFetch('/api/auth/settings', {
        method: 'PATCH',
        body: JSON.stringify(updates)
      });
      showSuccess('Settings updated!');
    } catch (err) {
      console.error(err);
    }
  };

  const handlePasswordChange = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    try {
      const res = await apiFetch('/api/auth/change-password', {
        method: 'PATCH',
        body: JSON.stringify({ currentPassword, newPassword })
      });
      if (res.ok) {
        showSuccess('Password changed successfully!');
        setCurrentPassword('');
        setNewPassword('');
      } else {
        const err = await res.json();
        alert(err.error || 'Failed to change password');
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsSaving(false);
    }
  };

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files?.[0]) return;
    const file = e.target.files[0];
    const formData = new FormData();
    formData.append('file', file);

    setIsSaving(true);
    try {
      const res = await apiFetch('/api/auth/avatar', {
        method: 'POST',
        // Note: fetch will automatically set Content-Type to multipart/form-data with boundary
        // when body is FormData. apiFetch should not override it with application/json.
        headers: { 'Content-Type': undefined as any },
        body: formData
      });
      if (res.ok) {
        showSuccess('Profile picture updated!');
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsSaving(false);
    }
  };

  const handleUpgrade = async () => {
    setIsSaving(true);
    try {
      const res = await apiFetch('/api/billing/upgrade', {
        method: 'POST'
      });
      if (res.ok) {
        showSuccess('Upgraded to Pro Plan!');
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsSaving(false);
    }
  };

  const handleFeedbackSubmit = async () => {
    setIsSaving(true);
    try {
      const res = await apiFetch('/api/feedback', {
        method: 'POST',
        body: JSON.stringify({ rating, quote: feedbackText })
      });
      if (res.ok) {
        showSuccess('Feedback submitted. Thank you!');
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsSaving(false);
    }
  };

  const getInitials = (name: string) => {
    return (name || '').split(' ').map(n => n[0]).join('').toUpperCase();
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
                    <div className="w-24 h-24 rounded-full bg-navy flex items-center justify-center text-white text-3xl font-bold overflow-hidden border-4 border-white shadow-lg">
                      {user?.avatarUrl ? (
                        <img src={user.avatarUrl} alt={user.fullName} className="w-full h-full object-cover" />
                      ) : (
                        user ? getInitials(user.fullName) : '??'
                      )}
                    </div>
                    <label className="absolute inset-0 bg-navy/60 rounded-full opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white cursor-pointer">
                      <Camera size={20} />
                      <input type="file" className="hidden" accept="image/*" onChange={handleAvatarUpload} />
                    </label>
                  </div>
                  <div>
                    <h3 className="text-lg font-serif font-bold text-navy">Profile Picture</h3>
                    <p className="text-text-muted text-sm pb-2">JPG, GIF or PNG. Max size of 800K</p>
                    <div className="flex gap-2">
                       {user?.verified && <div className="badge bg-navy/10 text-navy flex items-center gap-1"><CheckCircle2 size={12} /> Verified</div>}
                       {user?.proPlan && <div className="badge bg-accent-pale text-accent flex items-center gap-1"><Star size={12} fill="currentColor" /> Pro Plan</div>}
                    </div>
                  </div>
                </div>

                <form onSubmit={handleSaveProfile} className="space-y-6">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                      <label className="block text-xs font-bold text-navy uppercase tracking-widest mb-2">Full Name</label>
                      <input 
                        type="text" 
                        value={profileData.fullName} 
                        onChange={e => setProfileData(p => ({ ...p, fullName: e.target.value }))}
                        className="w-full px-4 py-3 bg-bg border border-border rounded-button focus:outline-none focus:border-accent transition-colors" 
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-navy uppercase tracking-widest mb-2">Email Address</label>
                      <input 
                        type="email" 
                        value={profileData.email} 
                        onChange={e => setProfileData(p => ({ ...p, email: e.target.value }))}
                        className="w-full px-4 py-3 bg-bg border border-border rounded-button focus:outline-none focus:border-accent transition-colors" 
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-navy uppercase tracking-widest mb-2">Phone Number</label>
                      <input 
                        type="tel" 
                        value={profileData.phoneNumber} 
                        onChange={e => setProfileData(p => ({ ...p, phoneNumber: e.target.value }))}
                        placeholder="+234 803 123 4567"
                        className="w-full px-4 py-3 bg-bg border border-border rounded-button focus:outline-none focus:border-accent transition-colors" 
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-navy uppercase tracking-widest mb-2">Location</label>
                      <input 
                        type="text" 
                        value={profileData.location} 
                        onChange={e => setProfileData(p => ({ ...p, location: e.target.value }))}
                        placeholder="Lagos, Nigeria"
                        className="w-full px-4 py-3 bg-bg border border-border rounded-button focus:outline-none focus:border-accent transition-colors" 
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-navy uppercase tracking-widest mb-2">Role / Title</label>
                      <input 
                        type="text" 
                        value={profileData.role} 
                        onChange={e => setProfileData(p => ({ ...p, role: e.target.value }))}
                        placeholder="e.g. Senior Lecturer"
                        className="w-full px-4 py-3 bg-bg border border-border rounded-button focus:outline-none focus:border-accent transition-colors" 
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-navy uppercase tracking-widest mb-2">Department</label>
                      <input 
                        type="text" 
                        value={profileData.department} 
                        onChange={e => setProfileData(p => ({ ...p, department: e.target.value }))}
                        placeholder="e.g. Science"
                        className="w-full px-4 py-3 bg-bg border border-border rounded-button focus:outline-none focus:border-accent transition-colors" 
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-navy uppercase tracking-widest mb-2">Bio</label>
                    <textarea 
                      value={profileData.bio} 
                      onChange={e => setProfileData(p => ({ ...p, bio: e.target.value }))}
                      rows={4}
                      className="w-full px-4 py-3 bg-bg border border-border rounded-button focus:outline-none focus:border-accent transition-colors resize-none" 
                    />
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
              </motion.div>
            )}

            {activeTab === 'notifications' && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
                <h3 className="text-lg font-serif font-bold text-navy mb-6">Email Notifications</h3>
                <div className="space-y-4">
                  {[
                    { id: 'emailAlerts', label: 'Email Alerts', desc: 'Receive notifications about your papers and sessions via email.', state: emailAlerts, setter: setEmailAlerts },
                    { id: 'marketing', label: 'Marking Complete', desc: 'Notify me when a marking session finishes processing.' },
                    { id: 'reports', label: 'Student Reports Ready', desc: 'Notify me when PDF reports are generated and ready for download.' },
                    { id: 'performance', label: 'Class Performance Alerts', desc: 'Notify me if a class average falls below a certain threshold.' }
                  ].map((item) => (
                    <div key={item.id} className="flex items-center justify-between p-4 bg-bg rounded-lg">
                      <div>
                        <p className="text-sm font-bold text-navy">{item.label}</p>
                        <p className="text-xs text-text-muted">{item.desc}</p>
                      </div>
                      <button 
                        onClick={() => {
                          if (item.id === 'emailAlerts') {
                            const newState = !emailAlerts;
                            setEmailAlerts(newState);
                            handleUpdateSettings({ emailAlerts: newState });
                          }
                        }}
                        className={cn(
                          "w-12 h-6 rounded-full relative transition-colors",
                          (item.id === 'emailAlerts' ? emailAlerts : true) ? "bg-accent" : "bg-border"
                        )}
                      >
                        <div className={cn(
                          "absolute top-1 w-4 h-4 bg-white rounded-full transition-all",
                          (item.id === 'emailAlerts' ? emailAlerts : true) ? "left-7" : "left-1"
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
                      {user?.userType === 'LECTURER' ? 'Lecturer Pro' : user?.userType === 'ADMIN' ? 'Institution Admin' : 'Student Free'}
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
                      {user?.userType === 'LECTURER' ? '842 / 2,000' : '1.2 GB / 5 GB'}
                    </span>
                  </div>
                  <div className="w-full h-2 bg-bg rounded-full overflow-hidden">
                    <div className="h-full bg-accent" style={{ width: user?.userType === 'LECTURER' ? '42%' : '24%' }}></div>
                  </div>
                </div>

                <div className="pt-6 border-t border-border">
                  <button onClick={handleUpgrade} disabled={isSaving || user?.proPlan} className="btn-accent w-full disabled:opacity-50">
                    {user?.proPlan ? 'Already on Pro Plan' : 'Upgrade Plan'}
                  </button>
                </div>
              </motion.div>
            )}

            {activeTab === 'security' && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
                <h3 className="text-lg font-serif font-bold text-navy mb-6">Security Settings</h3>
                <form onSubmit={handlePasswordChange} className="space-y-6">
                  <div className="relative">
                    <label className="block text-xs font-bold text-navy uppercase tracking-widest mb-2">Current Password</label>
                    <input 
                      type={showCurrentPassword ? "text" : "password"} 
                      value={currentPassword}
                      onChange={e => setCurrentPassword(e.target.value)}
                      placeholder="••••••••" 
                      autoComplete="current-password"
                      className="w-full px-4 py-3 bg-bg border border-border rounded-button focus:outline-none focus:border-accent transition-colors" 
                      required
                    />
                    <button type="button" onClick={() => setShowCurrentPassword(!showCurrentPassword)} className="absolute right-3 top-[38px] text-text-muted hover:text-navy">
                      {showCurrentPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                    </button>
                  </div>
                  <div className="relative">
                    <label className="block text-xs font-bold text-navy uppercase tracking-widest mb-2">New Password</label>
                    <input 
                      type={showNewPassword ? "text" : "password"} 
                      value={newPassword}
                      onChange={e => setNewPassword(e.target.value)}
                      placeholder="••••••••" 
                      autoComplete="new-password"
                      className="w-full px-4 py-3 bg-bg border border-border rounded-button focus:outline-none focus:border-accent transition-colors" 
                      required
                    />
                    <button type="button" onClick={() => setShowNewPassword(!showNewPassword)} className="absolute right-3 top-[38px] text-text-muted hover:text-navy">
                      {showNewPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                    </button>
                  </div>
                  <div className="pt-4">
                    <button type="submit" disabled={isSaving} className="btn-primary disabled:opacity-50">
                      {isSaving ? 'Updating...' : 'Update Password'}
                    </button>
                  </div>
                </form>

                <div className="h-px bg-border my-8" />

                <div className="flex items-center justify-between p-4 bg-bg rounded-lg">
                  <div>
                    <p className="text-sm font-bold text-navy">Two-Factor Authentication</p>
                    <p className="text-xs text-text-muted">Add an extra layer of security to your account.</p>
                  </div>
                  <button 
                    onClick={() => {
                      const newState = !twoFactorAuth;
                      setTwoFactorAuth(newState);
                      handleUpdateSettings({ twoFactorAuth: newState });
                    }}
                    className={cn(
                      "w-12 h-6 rounded-full relative transition-colors",
                      twoFactorAuth ? "bg-accent" : "bg-border"
                    )}
                  >
                    <div className={cn(
                      "absolute top-1 w-4 h-4 bg-white rounded-full transition-all",
                      twoFactorAuth ? "left-7" : "left-1"
                    )}></div>
                  </button>
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
                    <button onClick={handleFeedbackSubmit} disabled={isSaving || !rating} className="btn-primary flex items-center gap-2 disabled:opacity-50">
                      <Send size={18} /> {isSaving ? 'Submitting...' : 'Submit Feedback'}
                    </button>
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
            <span className="text-sm font-medium">{toastMessage}</span>
          </motion.div>
        )}
      </AnimatePresence>
    </DashboardLayout>
  );
};

export default SettingsPage;
