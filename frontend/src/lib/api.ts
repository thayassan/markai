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

export const apiUploadAndPoll = async (
  path: string,
  formData: FormData,
  onProgress?: (status: string) => void
): Promise<any> => {
  const startRes = await apiFetch(path, {
    method: 'POST',
    body: formData
  });
  const startData = await startRes.json();

  if (!startRes.ok) {
    throw new Error(startData.error || 'Upload failed to start');
  }

  const { jobId } = startData;
  onProgress?.('PENDING');

  // Poll every 2 seconds, max 90 seconds total (covers worst case backoff)
  const maxAttempts = 45;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    await new Promise(resolve => setTimeout(resolve, 2000));

    const statusRes = await apiFetch(`/api/upload/status/${jobId}`);
    const statusData = await statusRes.json();

    onProgress?.(statusData.status);

    if (statusData.status === 'COMPLETE') {
      return statusData;
    }

    if (statusData.status === 'ERROR') {
      const err: any = new Error(statusData.error || 'Processing failed');
      err.allowManualEntry = true;
      throw err;
    }
    // status is PENDING or PROCESSING — keep polling
  }

  throw new Error('Processing timed out. Please try again or type the answer manually.');
};
