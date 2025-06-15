// hooks/useApiCall.ts - Custom hook for API calls with retry logic
import { useState, useCallback } from 'react';
import { API_KEY, MAX_RETRIES, RETRY_DELAY } from '../utils/constants';

export const useApiCall = () => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const callApi = useCallback(async (
    url: string, 
    options: RequestInit = {},
    retries: number = MAX_RETRIES
  ): Promise<any> => {
    setError(null);
    
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(options.headers as Record<string, string> || {}),
    };

    if (API_KEY) {
      headers['x-api-key'] = API_KEY;
    }

    try {
      const response = await fetch(url, {
        ...options,
        headers,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
        throw new Error(errorData.error || `HTTP ${response.status}: ${response.statusText}`);
      }

      return await response.json();
    } catch (err) {
      const error = err as Error;
      
      // Retry logic for network errors
      if (retries > 0 && (error.message.includes('Failed to fetch') || error.message.includes('NetworkError'))) {
        await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
        return callApi(url, options, retries - 1);
      }
      
      throw error;
    }
  }, []);

  return { callApi, loading, error, setLoading, setError };
};