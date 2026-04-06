import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
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

  React.useEffect(() => {
    console.log('[AppRoutes] State update:', { 
      path: window.location.pathname,
      userEmail: user?.email, 
      userType: user?.userType,
      isLoading 
    });
  }, [user, isLoading]);

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
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/login" element={
        user ? <Navigate to="/" replace /> : <LoginPage />
      } />
      <Route path="/register" element={
        user ? <Navigate to="/" replace /> : <RegisterPage />
      } />
      
      {/* Student Routes */}
      <Route path="/dashboard" element={
        !user ? <Navigate to="/login" replace /> :
        user.userType === 'STUDENT' ? <StudentDashboard /> :
        user.userType === 'LECTURER' ? <Navigate to="/lecturer/dashboard" replace /> :
        <Navigate to="/admin/dashboard" replace />
      } />
      
      {/* Lecturer Routes */}
      <Route path="/lecturer/dashboard" element={
        !user ? <Navigate to="/login" replace /> :
        user.userType === 'LECTURER' ? <LecturerDashboard /> :
        user.userType === 'STUDENT' ? <Navigate to="/dashboard" replace /> :
        <Navigate to="/admin/dashboard" replace />
      } />
      <Route path="/lecturer/sessions" element={
        !user ? <Navigate to="/login" replace /> :
        user.userType === 'LECTURER' ? <LecturerSessionsPage /> :
        <Navigate to="/404" replace />
      } />
      <Route path="/lecturer/sessions/new" element={
        !user ? <Navigate to="/login" replace /> :
        user.userType === 'LECTURER' ? <NewSessionPage /> :
        <Navigate to="/404" replace />
      } />
      <Route path="/lecturer/sessions/:id" element={
        !user ? <Navigate to="/login" replace /> :
        user.userType === 'LECTURER' ? <SessionResultsPage /> :
        <Navigate to="/404" replace />
      } />
      <Route path="/lecturer/sessions/:id/students/:studentId" element={
        !user ? <Navigate to="/login" replace /> :
        user.userType === 'LECTURER' ? <LecturerResultDetail /> :
        <Navigate to="/404" replace />
      } />
      
      {/* Admin Routes */}
      <Route path="/admin/dashboard" element={
        !user ? <Navigate to="/login" replace /> :
        user.userType === 'ADMIN' ? <AdminDashboard /> :
        user.userType === 'STUDENT' ? <Navigate to="/dashboard" replace /> :
        <Navigate to="/lecturer/dashboard" replace />
      } />
      
      <Route path="/student/results/:id" element={
        !user ? <Navigate to="/login" replace /> :
        user.userType === 'STUDENT' ? <StudentResultDetail /> :
        <Navigate to="/404" replace />
      } />
      
      {/* Shared Routes */}
      <Route path="/progress" element={user ? <ProgressPage /> : <Navigate to="/login" replace />} />
      <Route path="/settings" element={user ? <SettingsPage /> : <Navigate to="/login" replace />} />
      
      {/* 404 */}
      <Route path="/404" element={<NotFoundPage />} />
      <Route path="*" element={<Navigate to="/404" replace />} />
    </Routes>
  );
};

export default function App() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <Router>
          <AuthProvider>
            <AppRoutes />
          </AuthProvider>
        </Router>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}
