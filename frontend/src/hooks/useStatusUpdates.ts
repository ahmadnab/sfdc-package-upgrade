// hooks/useStatusUpdates.ts - Hook for managing SSE/polling status updates
import { useRef, useCallback } from 'react';
import { API_URL, API_KEY } from '../utils/constants';

interface UseStatusUpdatesProps {
  sessionId: string;
  onStatusUpdate: (data: any) => void;
  onConnectionError: (error: string | null) => void;
  onConnectionStatusChange: (status: 'connecting' | 'connected' | 'disconnected' | 'error') => void;
}

export const useStatusUpdates = ({
  sessionId,
  onStatusUpdate,
  onConnectionError,
  onConnectionStatusChange
}: UseStatusUpdatesProps) => {
  const eventSourceRef = useRef<EventSource | null>(null);
  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const useSSERef = useRef(true);

  const stopStatusUpdates = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current);
      pollingIntervalRef.current = null;
    }
    onConnectionStatusChange('disconnected');
  }, [onConnectionStatusChange]);

  const startPolling = useCallback(() => {
    let errorCount = 0;
    onConnectionStatusChange('connecting');
    
    pollingIntervalRef.current = setInterval(async () => {
      try {
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
        };

        if (API_KEY) {
          headers['x-api-key'] = API_KEY;
        }

        const response = await fetch(`${API_URL}/api/status/${sessionId}`, {
          headers
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const data = await response.json();
        
        Object.values(data).forEach((update: any) => {
          onStatusUpdate(update);
        });
        
        errorCount = 0;
        onConnectionError(null);
        onConnectionStatusChange('connected');
      } catch (error) {
        errorCount++;
        console.error('Polling error:', error);
        
        if (errorCount > 3) {
          onConnectionError('Lost connection to server. Please refresh the page.');
          onConnectionStatusChange('error');
          stopStatusUpdates();
        }
      }
    }, 2000);
  }, [sessionId, onStatusUpdate, onConnectionError, onConnectionStatusChange, stopStatusUpdates]);

  const startStatusUpdates = useCallback(() => {
    onConnectionError(null);
    onConnectionStatusChange('connecting');
    
    if (useSSERef.current && typeof EventSource !== 'undefined') {
      try {
        const url = new URL(`${API_URL}/api/status-stream/${sessionId}`);
        if (API_KEY) {
          url.searchParams.append('api_key', API_KEY);
        }
        
        eventSourceRef.current = new EventSource(url.toString());
        
        eventSourceRef.current.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            onStatusUpdate(data);
          } catch (error) {
            console.error('Error parsing SSE message:', error);
          }
        };

        eventSourceRef.current.onerror = (error) => {
          console.error('SSE error:', error);
          onConnectionStatusChange('error');
          eventSourceRef.current?.close();
          useSSERef.current = false;
          startPolling();
        };

        eventSourceRef.current.onopen = () => {
          onConnectionError(null);
          onConnectionStatusChange('connected');
        };
      } catch (error) {
        useSSERef.current = false;
        startPolling();
      }
    } else {
      startPolling();
    }
  }, [sessionId, onStatusUpdate, onConnectionError, onConnectionStatusChange, startPolling]);

  return { startStatusUpdates, stopStatusUpdates };
};