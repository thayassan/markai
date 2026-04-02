import React, { createContext, useContext, useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

type Role = 'STUDENT' | 'LECTURER' | 'SCHOOL_ADMIN';

interface User {
  id: string;
  email: string;
  name: string;
  role: Role;
  studentCode?: string | null;
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
    console.log('AuthContext: Initializing...');
    const timeoutId = setTimeout(() => {
      if (isLoading) {
        console.warn('AuthContext: Initialization timed out, forcing isLoading to false');
        setIsLoading(false);
      }
    }, 5000);

    try {
      const storedUser = localStorage.getItem('markai_user');
      if (storedUser && storedUser !== 'undefined') {
        const parsedUser = JSON.parse(storedUser);
        console.log('AuthContext: Restored user from localStorage:', parsedUser);
        setUser(parsedUser);
      } else {
        console.log('AuthContext: No user found in localStorage');
      }
    } catch (e) {
      console.error('AuthContext: Error reading from localStorage:', e);
      localStorage.removeItem('markai_user');
    }
    setIsLoading(false);
    clearTimeout(timeoutId);
  }, []);

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
      try {
        localStorage.setItem('markai_user', JSON.stringify(loggedInUser));
        if (token) {
          localStorage.setItem('markai_token', token);
        }
      } catch (e) {
        console.error('AuthContext: Error writing to localStorage:', e);
      }
      
      if (loggedInUser.role === 'STUDENT') {
        navigate('/dashboard');
      } else if (loggedInUser.role === 'LECTURER') {
        navigate('/lecturer/dashboard');
      } else if (loggedInUser.role === 'SCHOOL_ADMIN') {
        navigate('/admin/dashboard');
      } else {
        navigate('/');
      }
    } catch (error) {
      console.error('Login error:', error);
      throw error;
    }
  };

  const logout = () => {
    setUser(null);
    try {
      localStorage.removeItem('markai_user');
      localStorage.removeItem('markai_token');
    } catch (e) {
      console.error('Error removing from localStorage:', e);
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
