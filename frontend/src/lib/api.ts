/// <reference types="vite/client" />
import { safeGetItem, safeRemoveItem } from './storage';

export class UnauthorizedError extends Error {
  constructor() {
    super('Unauthorized');
    this.name = 'UnauthorizedError';
  }
}

const BASE_URL = import.meta.env.VITE_API_URL || '';

export async function apiFetch(path: string, options: RequestInit = {}) {
  // Ensure we don't double up on slashes and handle absolute URLs
  const url = path.startsWith('http') ? path : `${BASE_URL}${path.startsWith('/') ? '' : '/'}${path}`;
  const token = safeGetItem('markai_token');
  
  const isFormData = options.body instanceof FormData;
  
  const headers: Record<string, string> = {
    ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
    ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
    ...((options.headers as any) || {}),
  };

  // Remove any explicitly-set undefined or 'undefined' Content-Type values
  if (isFormData || headers['Content-Type'] === 'undefined') {
    delete headers['Content-Type'];
  }

  try {
    const response = await fetch(url, {
      ...options,
      headers,
    });

    if (response.status === 401) {
      console.warn('API: Unauthorized (401), clearing session');
      safeRemoveItem('markai_user');
      safeRemoveItem('markai_token');
      // Trigger a page reload or a custom event to update AuthContext
      window.dispatchEvent(new Event('markai-unauthorized'));
      throw new UnauthorizedError();
    }

    return response;
  } catch (error) {
    if (error instanceof UnauthorizedError) throw error;
    console.error(`API Error (${url}):`, error);
    throw error;
  }
}
