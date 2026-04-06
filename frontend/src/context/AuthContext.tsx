import React, { createContext, useContext, useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { safeGetItem, safeSetItem, safeRemoveItem } from '../lib/storage';
import { apiFetch } from '../lib/api';

type Role = 'STUDENT' | 'LECTURER' | 'ADMIN';

interface User {
  id: string;
  email: string;
  fullName: string;
  userType: Role;
  studentCode?: string | null;
  avatarUrl?: string | null;
  phoneNumber?: string | null;
  location?: string | null;
  bio?: string | null;
  verified?: boolean;
  proPlan?: boolean;
  department?: string | null;
  role?: string | null;
  twoFactorAuth?: boolean;
  emailAlerts?: boolean;
}

interface AuthContextType {
  user: User | null;
  login: (email: string, password?: string) => Promise<void>;
  logout: () => void;
  isLoading: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    const verifySession = async () => {
      console.log('AuthContext: Initializing and verifying session...');
      
      const storedUser = safeGetItem('markai_user');
      const token = safeGetItem('markai_token');

      if (!storedUser || !token || storedUser === 'undefined') {
        console.log('AuthContext: No session found, finishing initialization');
        setUser(null);
        setIsLoading(false);
        return;
      }

      try {
        // Try to verify token with backend
        const response = await apiFetch('/api/auth/me');

        if (response.ok) {
          const userData = await response.json();
          console.log('AuthContext: Session verified successfully:', userData);
          setUser(userData);
        } else if (response.status === 401) {
          console.warn('AuthContext: Session expired or invalid, clearing local storage');
          safeRemoveItem('markai_user');
          safeRemoveItem('markai_token');
          setUser(null);
        } else {
          // Other error (e.g. server down), but we have a cached user
          // For now, let's keep the cached user but log the error
          console.error('AuthContext: Backend verification failed with status:', response.status);
          const parsedUser = JSON.parse(storedUser);
          setUser(parsedUser);
        }
      } catch (e) {
        console.error('AuthContext: Error during session verification:', e);
        // If network error, we can still fall back to localStorage if we want,
        // or just logout if we want to be strict. Let's fall back for better UX during dev.
        try {
          const parsedUser = JSON.parse(storedUser);
          setUser(parsedUser);
        } catch (parseErr) {
          setUser(null);
        }
      } finally {
        setIsLoading(false);
      }
    };

    const handleUnauthorized = () => {
      console.warn('AuthContext: Unauthorized event received, logging out');
      setUser(null);
      if (window.location.pathname !== '/login') {
        navigate('/login', { replace: true });
      }
    };

    window.addEventListener('markai-unauthorized', handleUnauthorized);
    verifySession();

    return () => {
      window.removeEventListener('markai-unauthorized', handleUnauthorized);
    };
  }, [navigate]);

  const login = async (email: string, password?: string) => {
    console.log('AuthContext: Attempting login for:', email);
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });

      if (!response.ok) {
        const error = await response.json();
        console.error('AuthContext: Login failed:', error);
        throw new Error(error.error || 'Login failed');
      }

      const data = await response.json();
      const loggedInUser: User = data.user;
      const token = data.token;
      
      console.log('AuthContext: Login successful:', loggedInUser);
      
      setUser(loggedInUser);
      safeSetItem('markai_user', JSON.stringify(loggedInUser));
      if (token) {
        safeSetItem('markai_token', token);
      }
      
      const targetPath = loggedInUser.userType === 'STUDENT' ? '/dashboard' : 
                         loggedInUser.userType === 'LECTURER' ? '/lecturer/dashboard' : 
                         loggedInUser.userType === 'ADMIN' ? '/admin/dashboard' : '/';
      
      if (window.location.pathname !== targetPath) {
        navigate(targetPath, { replace: true });
      }

    } catch (error) {
      console.error('Login error:', error);
      throw error;
    }
  };

  const logout = () => {
    setUser(null);
    safeRemoveItem('markai_user');
    safeRemoveItem('markai_token');
    
    if (window.location.pathname !== '/') {
      navigate('/', { replace: true });
    }
  };

  return (
    <AuthContext.Provider value={{ user, login, logout, isLoading }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
