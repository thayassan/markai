import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';
import { AnimatePresence } from 'framer-motion';
import PageTransition from './components/PageTransition';
import NavigationProgress from './components/NavigationProgress';
import LandingPage from './pages/LandingPage';
import LoginPage from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';
import StudentDashboard from './pages/StudentDashboard';
import LecturerDashboard from './pages/LecturerDashboard';
import NewSessionPage from './pages/NewSessionPage';
import SessionResultsPage from './pages/SessionResultsPage';
import LecturerResultDetail from './pages/LecturerResultDetail';
import AdminDashboard from './pages/AdminDashboard';
import SettingsPage from './pages/SettingsPage';
import LecturerSessionsPage from './pages/LecturerSessionsPage';
import StudentResultDetail from './pages/StudentResultDetail';
import ProgressPage from './pages/ProgressPage';
import FeaturesPage from './pages/FeaturesPage';
import PricingPage from './pages/PricingPage';
import AboutPage from './pages/AboutPage';
import PrivacyPage from './pages/PrivacyPage';
import TermsPage from './pages/TermsPage';
import CareersPage from './pages/CareersPage';
import DocsPage from './pages/DocsPage';
import ModerationPage from './pages/ModerationPage';
import { NotFoundPage } from './pages/ErrorPages';
import { ErrorBoundary } from './components/ErrorBoundary';
import { AuthProvider, useAuth } from './context/AuthContext';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

const AppRoutes = () => {
  const { user, isLoading } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const navigateRef = React.useRef(navigate);

  React.useEffect(() => {
    navigateRef.current = navigate;
  }, [navigate]);

  React.useEffect(() => {
    console.log('[AppRoutes] State update:', { 
      path: window.location.pathname,
      userEmail: user?.email, 
      userType: user?.userType,
      isLoading 
    });
  }, [user, isLoading]);

  const userEmail = user?.email;
  const publicPaths = ['/', '/login', '/register', '/features', '/pricing', '/about', '/privacy', '/terms', '/careers', '/docs'];
  React.useEffect(() => {
    const isPublic = publicPaths.includes(window.location.pathname) || window.location.pathname.startsWith('/moderate');
    if (!isLoading && !userEmail && !isPublic) {
      navigateRef.current('/login', { replace: true });
    }
  }, [isLoading, userEmail]);

  if (isLoading) {
    console.log('[AppRoutes] Authentication is initializing, showing spinner...');
    return (
      <div className="min-h-screen flex items-center justify-center bg-bg">
        <div className="flex flex-col items-center gap-4">
          <div className="w-10 h-10 border-4 border-navy border-t-transparent rounded-full animate-spin"></div>
          <p className="text-navy font-medium animate-pulse text-sm">Verifying session...</p>
        </div>
      </div>
    );
  }

  return (
    <AnimatePresence mode="wait">
      <Routes location={location} key={location.pathname}>
        <Route path="/" element={<PageTransition><LandingPage /></PageTransition>} />
        <Route path="/login" element={
          user ? <Navigate to="/" replace /> : <PageTransition><LoginPage /></PageTransition>
        } />
        <Route path="/register" element={
          user ? <Navigate to="/" replace /> : <PageTransition><RegisterPage /></PageTransition>
        } />
        
        {/* Public Pages */}
        <Route path="/features" element={<PageTransition><FeaturesPage /></PageTransition>} />
        <Route path="/pricing" element={<PageTransition><PricingPage /></PageTransition>} />
        <Route path="/about" element={<PageTransition><AboutPage /></PageTransition>} />
        <Route path="/privacy" element={<PageTransition><PrivacyPage /></PageTransition>} />
        <Route path="/terms" element={<PageTransition><TermsPage /></PageTransition>} />
        <Route path="/careers" element={<PageTransition><CareersPage /></PageTransition>} />
        <Route path="/docs" element={<PageTransition><DocsPage /></PageTransition>} />
        <Route path="/moderate/:token" element={<PageTransition><ModerationPage /></PageTransition>} />
        
        {/* Student Routes */}
        <Route path="/dashboard" element={
          !user ? <Navigate to="/login" replace /> :
          user.userType === 'STUDENT' ? <PageTransition><StudentDashboard /></PageTransition> :
          user.userType === 'LECTURER' ? <Navigate to="/lecturer/dashboard" replace /> :
          <Navigate to="/admin/dashboard" replace />
        } />
        
        {/* Lecturer Routes */}
        <Route path="/lecturer/dashboard" element={
          !user ? <Navigate to="/login" replace /> :
          user.userType === 'LECTURER' ? <PageTransition><LecturerDashboard /></PageTransition> :
          user.userType === 'STUDENT' ? <Navigate to="/dashboard" replace /> :
          <Navigate to="/admin/dashboard" replace />
        } />
        <Route path="/lecturer/sessions" element={
          !user ? <Navigate to="/login" replace /> :
          user.userType === 'LECTURER' ? <PageTransition><LecturerSessionsPage /></PageTransition> :
          <Navigate to="/404" replace />
        } />
        <Route path="/lecturer/sessions/new" element={
          !user ? <Navigate to="/login" replace /> :
          user.userType === 'LECTURER' ? <PageTransition><NewSessionPage /></PageTransition> :
          <Navigate to="/404" replace />
        } />
        <Route path="/lecturer/sessions/:id" element={
          !user ? <Navigate to="/login" replace /> :
          user.userType === 'LECTURER' ? <PageTransition><SessionResultsPage /></PageTransition> :
          <Navigate to="/404" replace />
        } />
        <Route path="/lecturer/sessions/:id/students/:studentId" element={
          !user ? <Navigate to="/login" replace /> :
          user.userType === 'LECTURER' ? <PageTransition><LecturerResultDetail /></PageTransition> :
          <Navigate to="/404" replace />
        } />
        
        {/* Admin Routes */}
        <Route path="/admin/dashboard" element={
          !user ? <Navigate to="/login" replace /> :
          (user.userType === 'ADMIN' || user.userType === 'SCHOOL_ADMIN') ? <PageTransition><AdminDashboard /></PageTransition> :
          user.userType === 'STUDENT' ? <Navigate to="/dashboard" replace /> :
          <Navigate to="/lecturer/dashboard" replace />
        } />
        
        <Route path="/student/results/:id" element={
          !user ? <Navigate to="/login" replace /> :
          user.userType === 'STUDENT' ? <PageTransition><StudentResultDetail /></PageTransition> :
          <Navigate to="/404" replace />
        } />
        
        {/* Shared Routes */}
        <Route path="/progress" element={user ? <PageTransition><ProgressPage /></PageTransition> : <Navigate to="/login" replace />} />
        <Route path="/settings" element={user ? <PageTransition><SettingsPage /></PageTransition> : <Navigate to="/login" replace />} />
        
        {/* 404 */}
        <Route path="/404" element={<PageTransition><NotFoundPage /></PageTransition>} />
        <Route path="*" element={<Navigate to="/404" replace />} />
      </Routes>
    </AnimatePresence>
  );
};

export default function App() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <Router>
          <AuthProvider>
            <NavigationProgress />
            <AppRoutes />
          </AuthProvider>
        </Router>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}
