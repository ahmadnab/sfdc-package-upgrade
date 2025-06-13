import React, { useState, useEffect, useRef, useCallback } from 'react';

// Configuration
const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:8080';
const API_KEY = process.env.REACT_APP_API_KEY || '';
const MAX_RETRIES = 3;
const RETRY_DELAY = 1000;

interface Org {
  id: string;
  name: string;
  url: string;
  username: string;
}

interface StatusUpdate {
  type: 'status';
  orgId: string;
  upgradeId?: string;
  batchId?: string;
  status: 'starting' | 'navigating' | 'logging-in' | 'logged-in' | 'verification-required' | 
          'navigating-package' | 'extracting-version-info' | 'awaiting-confirmation' | 'user-confirmed' |
          'finding-upgrade-button' | 'upgrading' | 'completed' | 'error';
  message: string;
  screenshot?: string;
  timestamp?: number;
}

interface VersionConfirmationUpdate {
  type: 'version-confirmation-required';
  orgId: string;
  upgradeId: string;
  batchId?: string;
  status: 'awaiting-confirmation';
  message: string;
  versionInfo: {
    installedVersion: string;
    newVersion: string;
    headerMessage: string;
    fullText: string;
  };
}

interface BatchStatus {
  type: 'batch-status';
  batchId: string;
  status: 'started' | 'completed' | 'error';
  totalOrgs?: number;
  successCount?: number;
  failureCount?: number;
  message: string;
  results?: Array<{
    orgId: string;
    orgName: string;
    status: string;
    error?: string;
    duration?: number;
  }>;
  startTime?: string;
  endTime?: string;
  totalDuration?: number;
}

interface BatchProgress {
  type: 'batch-progress';
  batchId: string;
  orgId?: string;
  orgName?: string;
  status?: string;
  completed: number;
  total: number;
  successCount?: number;
  failureCount?: number;
  percentComplete?: number;
}

interface HistoryEntry {
  id: string;
  batchId: string | null;
  orgId: string;
  orgName: string;
  packageUrl: string;
  startTime: string;
  endTime: string | null;
  duration: number | null;
  status: 'in-progress' | 'success' | 'failed' | 'timeout';
  error: string | null;
  screenshot?: string | null;
  retries?: number;
}

interface HistoryResponse {
  upgrades: HistoryEntry[];
  total: number;
  limit: number;
  offset: number;
}

type TabType = 'single' | 'batch' | 'history';

// Custom hook for API calls with retry logic
const useApiCall = () => {
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

const App: React.FC = () => {
  // State variables
  const [orgs, setOrgs] = useState<Org[]>([]);
  const [selectedOrg, setSelectedOrg] = useState<string>('');
  const [selectedOrgs, setSelectedOrgs] = useState<string[]>([]);
  const [packageUrl, setPackageUrl] = useState<string>('');
  const [maxConcurrent, setMaxConcurrent] = useState<number>(1);
  const [status, setStatus] = useState<Record<string, StatusUpdate>>({});
  const [batchStatus, setBatchStatus] = useState<BatchStatus | null>(null);
  const [batchProgress, setBatchProgress] = useState<BatchProgress | null>(null);
  const [isUpgrading, setIsUpgrading] = useState<boolean>(false);
  const [activeTab, setActiveTab] = useState<TabType>('single');
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [historyTotal, setHistoryTotal] = useState<number>(0);
  const [historyOffset, setHistoryOffset] = useState<number>(0);
  const [sessionId] = useState<string>(`session-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`);
  const [useSSE, setUseSSE] = useState<boolean>(true);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<'connecting' | 'connected' | 'disconnected' | 'error'>('connecting');
  const [showScreenshot, setShowScreenshot] = useState<string | null>(null);
  const [lastHeartbeat, setLastHeartbeat] = useState<number>(Date.now());
  const [activeBrowserCount] = useState<number>(0);
  const [versionConfirmations, setVersionConfirmations] = useState<Record<string, VersionConfirmationUpdate>>({});

  // Refs
  const eventSourceRef = useRef<EventSource | null>(null);
  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Custom hook
  const { callApi, loading, error: apiError, setLoading, setError: setApiError } = useApiCall();

  // Screenshot validation utility
  const validateScreenshot = useCallback((screenshot: string): { isValid: boolean; error?: string } => {
    if (!screenshot) return { isValid: false, error: 'Empty screenshot' };
    
    if (!screenshot.startsWith('data:image/')) {
      return { isValid: false, error: 'Not a data URL' };
    }
    
    if (!screenshot.includes('base64,')) {
      return { isValid: false, error: 'Not base64 encoded' };
    }
    
    // Extract base64 part
    const base64Part = screenshot.split('base64,')[1];
    if (!base64Part) {
      return { isValid: false, error: 'No base64 data' };
    }
    
    // Check for valid base64 characters
    const base64Regex = /^[A-Za-z0-9+/]*={0,2}$/;
    if (!base64Regex.test(base64Part)) {
      return { isValid: false, error: 'Invalid base64 characters' };
    }
    
    // Check length (should be divisible by 4)
    if (base64Part.length % 4 !== 0) {
      return { isValid: false, error: 'Invalid base64 length' };
    }
    
    return { isValid: true };
  }, []);

  // Clean screenshot data
  const cleanScreenshot = useCallback((screenshot: string): string => {
    if (!screenshot) return '';
    
    // Remove any whitespace or line breaks
    let cleaned = screenshot.replace(/\s/g, '');
    
    // Ensure proper data URL format
    if (cleaned.startsWith('data:image/') && cleaned.includes('base64,')) {
      const [header, base64Data] = cleaned.split('base64,');
      // Clean the base64 part
      const cleanBase64 = base64Data.replace(/[^A-Za-z0-9+/=]/g, '');
      cleaned = `${header}base64,${cleanBase64}`;
    }
    
    return cleaned;
  }, []);

  // Fetch functions
  const fetchOrgs = useCallback(async () => {
    try {
      setLoading(true);
      setConnectionStatus('connecting');
      const data = await callApi(`${API_URL}/api/orgs`);
      setOrgs(data);
      setConnectionError(null);
      setConnectionStatus('connected');
    } catch (error) {
      console.error('Error fetching orgs:', error);
      setConnectionError('Failed to connect to backend. Please check if the server is running.');
      setConnectionStatus('error');
    } finally {
      setLoading(false);
    }
  }, [callApi, setLoading]);

  const fetchHistory = useCallback(async (offset: number = 0, limit: number = 50) => {
    try {
      const data: HistoryResponse = await callApi(`${API_URL}/api/history?offset=${offset}&limit=${limit}`);
      
      // Handle both paginated response and direct array response for backward compatibility
      let upgrades: HistoryEntry[] = [];
      let total: number = 0;
      
      if (Array.isArray(data)) {
        // Direct array response (old format)
        upgrades = data;
        total = data.length;
      } else if (data && Array.isArray(data.upgrades)) {
        // Paginated response (new format)
        upgrades = data.upgrades;
        total = data.total || upgrades.length;
      } else {
        // Fallback
        upgrades = [];
        total = 0;
      }
      
      if (offset === 0) {
        setHistory(upgrades);
      } else {
        setHistory(prev => [...prev, ...upgrades]);
      }
      setHistoryTotal(total);
      setHistoryOffset(offset + upgrades.length);
    } catch (error) {
      console.error('Error fetching history:', error);
      // Set empty state on error
      if (offset === 0) {
        setHistory([]);
        setHistoryTotal(0);
        setHistoryOffset(0);
      }
      // Don't show error for history, it's not critical
    }
  }, [callApi]);

  const loadMoreHistory = useCallback(() => {
    if (history && history.length < historyTotal && !loading) {
      fetchHistory(historyOffset);
    }
  }, [history, historyTotal, loading, fetchHistory, historyOffset]);

  // Validation function
  const validatePackageId = useCallback((packageId: string): boolean => {
    return packageId.length === 15 && /^04t[a-zA-Z0-9]{12}$/.test(packageId);
  }, []);

  // Connection management - Define stopStatusUpdates first to avoid circular dependencies
  const stopStatusUpdates = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current);
      pollingIntervalRef.current = null;
    }
    setConnectionStatus('disconnected');
  }, []);

  // Status update handling
  const handleStatusUpdate = useCallback((data: any) => {
    try {
      // Update heartbeat timestamp
      if (data.type === 'heartbeat' || data.timestamp) {
        setLastHeartbeat(Date.now());
      }

      if (data.type === 'connected') {
        setConnectionStatus('connected');
        return;
      }

      if (data.type === 'version-confirmation-required') {
        setVersionConfirmations(prev => ({
          ...prev,
          [data.upgradeId]: data
        }));
        return;
      }

      if (data.type === 'status') {
        let cleanedScreenshot: string | undefined = data.screenshot;
        // Clean and validate screenshot if present
        if (data.screenshot) {
          cleanedScreenshot = cleanScreenshot(data.screenshot);
          const validation = validateScreenshot(cleanedScreenshot);
          if (!validation.isValid) {
            // Don't use invalid screenshot
            cleanedScreenshot = undefined;
          }
        }
        setStatus(prev => {
          const prevStatus = prev[data.orgId] || {};
          const mergedStatus = {
            ...data,
            screenshot: data.screenshot !== undefined ? cleanedScreenshot : prevStatus.screenshot
          };
          return {
            ...prev,
            [data.orgId]: mergedStatus
          };
        });
        
        if (data.status === 'completed' || data.status === 'error') {
          if (!data.batchId) {
            setIsUpgrading(false);
            // Delay closing SSE to allow screenshot event to arrive
            setTimeout(() => {
              stopStatusUpdates();
            }, 2000); // 2 seconds
          }
          // Refresh history after a short delay
          setTimeout(() => fetchHistory(0), 1000);
        }
      } else if (data.type === 'batch-status') {
        setBatchStatus(data);
        if (data.status === 'completed' || data.status === 'error') {
          setIsUpgrading(false);
          setBatchProgress(null);
          stopStatusUpdates();
          // Refresh history after completion
          setTimeout(() => fetchHistory(0), 1000);
        }
      } else if (data.type === 'batch-progress') {
        setBatchProgress(data);
      } else if (data.type === 'screenshot') {
        // Handle separate screenshot data with validation
        let cleanedScreenshot: string | undefined = undefined;
        if (data.screenshot) {
          cleanedScreenshot = cleanScreenshot(data.screenshot);
          const validation = validateScreenshot(cleanedScreenshot);
          if (!validation.isValid) {
            cleanedScreenshot = undefined;
          }
        }
        if (cleanedScreenshot && data.orgId) {
          setStatus(prev => {
            const prevStatus = prev[data.orgId] || {};
            const newStatus: StatusUpdate = {
              type: 'status',
              orgId: data.orgId,
              screenshot: cleanedScreenshot,
              status: prevStatus.status || data.status || 'error',
              message: prevStatus.message || data.message || 'Screenshot received',
              upgradeId: prevStatus.upgradeId || data.upgradeId,
              batchId: prevStatus.batchId || data.batchId
            };
            return {
              ...prev,
              [data.orgId]: newStatus
            };
          });
        }
      }
    } catch (error) {
      console.error('Error handling status update:', error);
    }
  }, [fetchHistory, cleanScreenshot, validateScreenshot, stopStatusUpdates]);

  // Connection management
  const startPolling = useCallback(() => {
    let errorCount = 0;
    setConnectionStatus('connecting');
    
    pollingIntervalRef.current = setInterval(async () => {
      try {
        const data = await callApi(`${API_URL}/api/status/${sessionId}`);
        
        Object.values(data).forEach((update: any) => {
          handleStatusUpdate(update);
        });
        
        errorCount = 0; // Reset error count on success
        setConnectionError(null);
        setConnectionStatus('connected');
      } catch (error) {
        errorCount++;
        console.error('Polling error:', error);
        
        if (errorCount > 3) {
          setConnectionError('Lost connection to server. Please refresh the page.');
          setConnectionStatus('error');
          stopStatusUpdates();
        }
      }
    }, 2000); // Slightly slower polling to reduce server load
  }, [callApi, sessionId, handleStatusUpdate, stopStatusUpdates]);

  const startStatusUpdates = useCallback(() => {
    setConnectionError(null);
    setConnectionStatus('connecting');
    
    if (useSSE && typeof EventSource !== 'undefined') {
      try {
        const url = new URL(`${API_URL}/api/status-stream/${sessionId}`);
        if (API_KEY) {
          url.searchParams.append('api_key', API_KEY);
        }
        
        eventSourceRef.current = new EventSource(url.toString());
        
        eventSourceRef.current.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            handleStatusUpdate(data);
          } catch (error) {
            console.error('Error parsing SSE message:', error);
          }
        };

        eventSourceRef.current.onerror = (error) => {
          setConnectionStatus('error');
          eventSourceRef.current?.close();
          setUseSSE(false);
          startPolling();
        };

        eventSourceRef.current.onopen = () => {
          setConnectionError(null);
          setConnectionStatus('connected');
        };
      } catch (error) {
        setUseSSE(false);
        startPolling();
      }
    } else {
      startPolling();
    }
  }, [useSSE, sessionId, handleStatusUpdate, startPolling]);

  // Version confirmation handling
  const handleVersionConfirmation = useCallback(async (upgradeId: string, confirmed: boolean) => {
    try {
      await callApi(`${API_URL}/api/confirm-upgrade`, {
        method: 'POST',
        body: JSON.stringify({
          sessionId: sessionId,
          upgradeId: upgradeId,
          confirmed: confirmed
        }),
      });
      
      // Remove from confirmations list
      setVersionConfirmations(prev => {
        const updated = { ...prev };
        delete updated[upgradeId];
        return updated;
      });
      
    } catch (error) {
      console.error('Error sending confirmation:', error);
      alert(`Failed to send confirmation: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }, [callApi, sessionId]);

  const handleSingleUpgrade = useCallback(async (): Promise<void> => {
    // Validation
    if (!selectedOrg) {
      alert('Please select an organization');
      return;
    }

    if (!packageUrl) {
      alert('Please enter a package ID');
      return;
    }

    if (!validatePackageId(packageUrl)) {
      alert('Invalid package ID format. It should be 15 characters starting with "04t" (e.g., 04tKb000000J8s9)');
      return;
    }

    setIsUpgrading(true);
    setStatus({});
    setVersionConfirmations({});
    setApiError(null);
    startStatusUpdates();
    
    try {
      await callApi(`${API_URL}/api/upgrade`, {
        method: 'POST',
        body: JSON.stringify({
          orgId: selectedOrg,
          packageUrl: packageUrl,
          sessionId: sessionId
        }),
      });
    } catch (error) {
      console.error('Error starting upgrade:', error);
      setIsUpgrading(false);
      stopStatusUpdates();
      alert(`Failed to start upgrade: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }, [selectedOrg, packageUrl, validatePackageId, sessionId, callApi, startStatusUpdates, stopStatusUpdates, setApiError]);

  const handleBatchUpgrade = useCallback(async (): Promise<void> => {
    // Validation
    if (selectedOrgs.length === 0) {
      alert('Please select at least one organization');
      return;
    }

    if (!packageUrl) {
      alert('Please enter a package ID');
      return;
    }

    if (!validatePackageId(packageUrl)) {
      alert('Invalid package ID format. It should be 15 characters starting with "04t" (e.g., 04tKb000000J8s9)');
      return;
    }

    if (selectedOrgs.length > 50) {
      alert('Maximum 50 organizations allowed per batch');
      return;
    }

    const confirmMessage = `Are you sure you want to upgrade ${selectedOrgs.length} organization(s)? This process cannot be stopped once started.`;
    if (!window.confirm(confirmMessage)) {
      return;
    }

    setIsUpgrading(true);
    setStatus({});
    setVersionConfirmations({});
    setBatchStatus(null);
    setBatchProgress(null);
    setApiError(null);
    startStatusUpdates();
    
    try {
      await callApi(`${API_URL}/api/upgrade-batch`, {
        method: 'POST',
        body: JSON.stringify({
          orgIds: selectedOrgs,
          packageUrl: packageUrl,
          maxConcurrent: maxConcurrent,
          sessionId: sessionId
        }),
      });
    } catch (error) {
      console.error('Error starting batch upgrade:', error);
      setIsUpgrading(false);
      stopStatusUpdates();
      alert(`Failed to start batch upgrade: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }, [selectedOrgs, packageUrl, validatePackageId, maxConcurrent, sessionId, callApi, startStatusUpdates, stopStatusUpdates, setApiError]);

  // Organization selection handlers
  const toggleOrgSelection = useCallback((orgId: string) => {
    setSelectedOrgs(prev => {
      if (prev.includes(orgId)) {
        return prev.filter(id => id !== orgId);
      } else {
        return [...prev, orgId];
      }
    });
  }, []);

  const selectAllOrgs = useCallback(() => {
    setSelectedOrgs(orgs.map(org => org.id));
  }, [orgs]);

  const deselectAllOrgs = useCallback(() => {
    setSelectedOrgs([]);
  }, []);

  // Utility functions
  const getStatusColor = useCallback((status: string): string => {
    switch (status) {
      case 'completed':
      case 'success': return 'text-green-600';
      case 'error':
      case 'failed': return 'text-red-600';
      case 'upgrading': return 'text-blue-600';
      case 'timeout': return 'text-orange-600';
      case 'verification-required': return 'text-purple-600';
      case 'awaiting-confirmation': return 'text-yellow-600';
      case 'user-confirmed': return 'text-green-600';
      case 'extracting-version-info': return 'text-blue-600';
      case 'in-progress': return 'text-yellow-600';
      default: return 'text-gray-600';
    }
  }, []);

  const getStatusIcon = useCallback((status: string): string => {
    switch (status) {
      case 'completed':
      case 'success': return '✅';
      case 'error':
      case 'failed': return '❌';
      case 'upgrading': return '🔄';
      case 'timeout': return '⚠️';
      case 'verification-required': return '🔐';
      case 'awaiting-confirmation': return '❓';
      case 'user-confirmed': return '👍';
      case 'extracting-version-info': return '📋';
      case 'in-progress': return '⏳';
      default: return '⏳';
    }
  }, []);

  const formatDuration = useCallback((seconds: number | null): string => {
    if (!seconds) return '-';
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}m ${secs}s`;
  }, []);

  const formatDate = useCallback((dateString: string): string => {
    try {
      return new Date(dateString).toLocaleString();
    } catch {
      return dateString;
    }
  }, []);

  const getConnectionStatusColor = useCallback((): string => {
    switch (connectionStatus) {
      case 'connected': return 'text-green-600';
      case 'connecting': return 'text-yellow-600';
      case 'disconnected': return 'text-gray-600';
      case 'error': return 'text-red-600';
      default: return 'text-gray-600';
    }
  }, [connectionStatus]);

  const getConnectionStatusIcon = useCallback((): string => {
    switch (connectionStatus) {
      case 'connected': return '🟢';
      case 'connecting': return '🟡';
      case 'disconnected': return '⚪';
      case 'error': return '🔴';
      default: return '⚪';
    }
  }, [connectionStatus]);

  // Effects
  useEffect(() => {
    fetchOrgs();
    fetchHistory();
  }, [fetchOrgs, fetchHistory]);

  useEffect(() => {
    return () => {
      stopStatusUpdates();
    };
  }, [stopStatusUpdates]);

  useEffect(() => {
    const checkConnection = setInterval(() => {
      if (isUpgrading && Date.now() - lastHeartbeat > 60000) {
        setConnectionStatus('error');
        setConnectionError('Connection lost - no heartbeat received');
      }
    }, 30000);

    return () => clearInterval(checkConnection);
  }, [isUpgrading, lastHeartbeat]);

  // Component definitions
  const ErrorAlert = ({ message }: { message: string }) => (
    <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded relative mb-4">
      <strong className="font-bold">Error: </strong>
      <span className="block sm:inline">{message}</span>
    </div>
  );

  const ConnectionStatus = () => {
    if (connectionError) {
      return <ErrorAlert message={connectionError} />;
    }
    
    if (loading && orgs.length === 0) {
      return (
        <div className="bg-blue-50 border border-blue-200 text-blue-700 px-4 py-3 rounded relative mb-4">
          <span className="block sm:inline">Connecting to backend...</span>
        </div>
      );
    }
    
    return null;
  };

  const VersionConfirmationModal = ({ confirmation }: { confirmation: VersionConfirmationUpdate }) => {
    const org = orgs.find(o => o.id === confirmation.orgId);
    
    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-lg max-w-2xl w-full overflow-hidden" onClick={(e) => e.stopPropagation()}>
          <div className="flex justify-between items-center p-6 border-b bg-blue-50">
            <h3 className="text-xl font-semibold text-blue-900">Package Version Confirmation</h3>
            <span className="text-sm text-blue-600">
              {org?.name || confirmation.orgId}
            </span>
          </div>
          
          <div className="p-6">
            <div className="mb-4">
              <p className="text-gray-700 mb-4">{confirmation.versionInfo.headerMessage}</p>
            </div>
            
            <div className="bg-gray-50 rounded-lg p-4 mb-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="bg-orange-50 border border-orange-200 rounded-lg p-3">
                  <h4 className="font-semibold text-orange-900 mb-2">Currently Installed</h4>
                  <p className="text-lg font-mono text-orange-800">
                    {confirmation.versionInfo.installedVersion}
                  </p>
                </div>
                
                <div className="bg-green-50 border border-green-200 rounded-lg p-3">
                  <h4 className="font-semibold text-green-900 mb-2">New Version</h4>
                  <p className="text-lg font-mono text-green-800">
                    {confirmation.versionInfo.newVersion}
                  </p>
                </div>
              </div>
            </div>
            
            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-6">
              <h4 className="font-semibold text-yellow-900 mb-2">⚠️ Important</h4>
              <ul className="list-disc list-inside text-sm text-yellow-800 space-y-1">
                <li>Please verify this is the correct package version you want to install</li>
                <li>The upgrade process will preserve existing data</li>
                <li>This action cannot be easily undone</li>
                <li>Make sure you have tested this version in a sandbox environment</li>
              </ul>
            </div>
            
            <div className="text-xs text-gray-500 mb-6 p-3 bg-gray-50 rounded">
              <strong>Full upgrade message:</strong><br />
              {confirmation.versionInfo.fullText}
            </div>
          </div>
          
          <div className="flex justify-between items-center p-6 border-t bg-gray-50">
            <button
              onClick={() => handleVersionConfirmation(confirmation.upgradeId, false)}
              className="px-6 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 font-medium"
            >
              ❌ Cancel Upgrade
            </button>
            
            <button
              onClick={() => handleVersionConfirmation(confirmation.upgradeId, true)}
              className="px-6 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 font-medium"
            >
              ✅ Confirm & Proceed
            </button>
          </div>
        </div>
      </div>
    );
  };

  const ScreenshotModal = ({ screenshot, onClose }: { screenshot: string; onClose: () => void }) => {
    const validation = validateScreenshot(screenshot);
    
    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4" onClick={onClose}>
        <div
          className="bg-white rounded-lg w-full max-w-md sm:max-w-lg md:max-w-2xl max-h-[80vh] overflow-auto shadow-lg"
          style={{ boxSizing: 'border-box' }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex justify-between items-center p-4 border-b">
            <h3 className="text-lg font-semibold">Error Screenshot</h3>
            <button
              onClick={onClose}
              className="text-gray-500 hover:text-gray-700 text-2xl leading-none"
            >
              ×
            </button>
          </div>
          <div className="p-4 overflow-auto" style={{ maxHeight: '60vh' }}>
            {!validation.isValid ? (
              <div className="text-center py-8">
                <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4">
                  ❌ Invalid Screenshot Data
                </div>
                <p className="text-gray-600 mb-4">
                  The screenshot data received is not in a valid format.
                </p>
              </div>
            ) : (
              <div>
                <div className="overflow-auto" style={{ maxWidth: '100%', maxHeight: '50vh' }}>
                  <img 
                    src={screenshot} 
                    alt="Error screenshot" 
                    className="max-w-full h-auto border border-gray-300 rounded block"
                    style={{ maxWidth: '100%', maxHeight: '40vh', objectFit: 'contain' }}
                    onError={(e) => {
                      console.error('Image load error:', e);
                      (e.target as HTMLImageElement).style.display = 'none';
                      const errorDiv = document.createElement('div');
                      errorDiv.className = 'text-center py-8';
                      errorDiv.innerHTML = `
                        <div class="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4">
                          ❌ Failed to display screenshot
                        </div>
                        <p class="text-gray-600">Screenshot data validation passed but image failed to load.</p>
                      `;
                      (e.target as HTMLImageElement).parentNode?.appendChild(errorDiv);
                    }}
                  />
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-gray-100 p-8">
      <div className="max-w-6xl mx-auto">
        <div className="flex justify-between items-center mb-8">
          <h1 className="text-3xl font-bold text-gray-800">
            Salesforce Package Upgrade Automation
          </h1>
          
          {/* Connection Status Indicator */}
          <div className="flex items-center space-x-2">
            <span className={`text-sm font-medium ${getConnectionStatusColor()}`}>
              {getConnectionStatusIcon()} {connectionStatus}
            </span>
            {isUpgrading && (
              <span className="text-xs text-gray-500">
                (Session: {sessionId.split('-')[1]})
              </span>
            )}
          </div>
        </div>

        <ConnectionStatus />
        {apiError && <ErrorAlert message={apiError} />}

        {/* Tab Navigation */}
        <div className="flex space-x-1 mb-6">
          <button
            onClick={() => setActiveTab('single')}
            className={`px-4 py-2 rounded-t-lg font-medium transition-colors ${
              activeTab === 'single'
                ? 'bg-white text-blue-600 border-b-2 border-blue-600'
                : 'bg-gray-200 text-gray-600 hover:bg-gray-300'
            }`}
          >
            Single Upgrade
          </button>
          <button
            onClick={() => setActiveTab('batch')}
            className={`px-4 py-2 rounded-t-lg font-medium transition-colors ${
              activeTab === 'batch'
                ? 'bg-white text-blue-600 border-b-2 border-blue-600'
                : 'bg-gray-200 text-gray-600 hover:bg-gray-300'
            }`}
          >
            Batch Upgrade ({selectedOrgs.length} selected)
          </button>
          <button
            onClick={() => setActiveTab('history')}
            className={`px-4 py-2 rounded-t-lg font-medium transition-colors ${
              activeTab === 'history'
                ? 'bg-white text-blue-600 border-b-2 border-blue-600'
                : 'bg-gray-200 text-gray-600 hover:bg-gray-300'
            }`}
          >
            History ({historyTotal})
          </button>
        </div>

        {/* Single Upgrade Tab */}
        {activeTab === 'single' && (
          <div className="flex flex-col lg:flex-row gap-6 mb-6">
            <div className="lg:w-1/2">
              <div className="bg-white rounded-lg shadow-md p-6 h-full">
                <h2 className="text-xl font-semibold mb-4">Single Org Upgrade</h2>
                
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Select Organization
                    </label>
                    <select
                      value={selectedOrg}
                      onChange={(e) => setSelectedOrg(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                      disabled={isUpgrading || loading}
                    >
                      <option value="">-- Select an Org --</option>
                      {orgs.map(org => (
                        <option key={org.id} value={org.id}>
                          {org.name} ({org.url.replace('https://', '').replace('.lightning.force.com/', '')})
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Package ID (e.g., 04tKb000000J8s9)
                    </label>
                    <input
                      type="text"
                      value={packageUrl}
                      onChange={(e) => setPackageUrl(e.target.value.trim())}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="04tKb000000J8s9"
                      disabled={isUpgrading}
                      maxLength={15}
                    />
                    {packageUrl && !validatePackageId(packageUrl) && (
                      <p className="text-red-600 text-sm mt-1">
                        Invalid format. Package ID must be 15 characters starting with "04t"
                      </p>
                    )}
                  </div>

                  <button
                    onClick={handleSingleUpgrade}
                    disabled={isUpgrading || !selectedOrg || !packageUrl || !validatePackageId(packageUrl) || loading}
                    className={`w-full py-2 px-4 rounded-md font-medium transition-colors ${
                      isUpgrading || !selectedOrg || !packageUrl || !validatePackageId(packageUrl) || loading
                        ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                        : 'bg-blue-600 text-white hover:bg-blue-700'
                    }`}
                  >
                    {isUpgrading ? 'Upgrading...' : 'Start Upgrade'}
                  </button>
                </div>
              </div>
            </div>
            
            <div className="lg:w-1/2">
              <div className="bg-gray-50 rounded-lg shadow-md p-6">
                <h3 className="font-semibold text-gray-800 mb-3">Important Notes</h3>
                <ul className="list-disc list-inside space-y-1 text-sm text-gray-600">
                  <li>Make sure your org credentials are configured in the backend</li>
                  <li>The automation runs in headless mode on Cloud Run</li>
                  <li>If additional verification is required, the upgrade will fail and need manual intervention</li>
                  <li>Package ID must be exactly 15 characters starting with "04t"</li>
                  <li>Each upgrade typically takes 2-5 minutes to complete</li>
                  <li>Cloud Run has a 5-minute timeout limit per request</li>
                  <li>Screenshots are captured automatically on errors for debugging</li>
                  <li>You'll be asked to confirm package versions before proceeding</li>
                </ul>
              </div>
            </div>
          </div>
        )}

        {/* Batch Upgrade Tab */}
        {activeTab === 'batch' && (
          <>
            <div className="flex flex-col lg:flex-row gap-6 mb-6">
              <div className="lg:w-1/2">
                <div className="bg-white rounded-lg shadow-md p-6 h-full">
                  <h2 className="text-xl font-semibold mb-4">Batch Upgrade</h2>
                  
                  <div className="space-y-4">
                    <div>
                      <div className="flex justify-between items-center mb-2">
                        <label className="block text-sm font-medium text-gray-700">
                          Select Organizations ({selectedOrgs.length} selected)
                        </label>
                        <div className="space-x-2">
                          <button
                            onClick={selectAllOrgs}
                            className="text-sm text-blue-600 hover:text-blue-800"
                            disabled={isUpgrading || loading}
                          >
                            Select All
                          </button>
                          <button
                            onClick={deselectAllOrgs}
                            className="text-sm text-blue-600 hover:text-blue-800"
                            disabled={isUpgrading}
                          >
                            Deselect All
                          </button>
                        </div>
                      </div>
                      <div className="border border-gray-300 rounded-md p-3 max-h-48 overflow-y-auto">
                        {orgs.length === 0 ? (
                          <p className="text-gray-500 text-center">No organizations available</p>
                        ) : (
                          orgs.map(org => (
                            <label key={org.id} className="flex items-center p-2 hover:bg-gray-50 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={selectedOrgs.includes(org.id)}
                                onChange={() => toggleOrgSelection(org.id)}
                                disabled={isUpgrading}
                                className="mr-3"
                              />
                              <span className="text-sm">
                                {org.name} ({org.url.replace('https://', '').replace('.lightning.force.com/', '')})
                              </span>
                            </label>
                          ))
                        )}
                      </div>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Package ID (e.g., 04tKb000000J8s9)
                      </label>
                      <input
                        type="text"
                        value={packageUrl}
                        onChange={(e) => setPackageUrl(e.target.value.trim())}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                        placeholder="04tKb000000J8s9"
                        disabled={isUpgrading}
                        maxLength={15}
                      />
                      {packageUrl && !validatePackageId(packageUrl) && (
                        <p className="text-red-600 text-sm mt-1">
                          Invalid format. Package ID must be 15 characters starting with "04t"
                        </p>
                      )}
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Processing Mode
                      </label>
                      <select
                        value={maxConcurrent}
                        onChange={(e) => setMaxConcurrent(Number(e.target.value))}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                        disabled={isUpgrading}
                      >
                        <option value={1}>Sequential (Recommended for stability)</option>
                        <option value={2}>2 Concurrent</option>
                        <option value={3}>3 Concurrent</option>
                        <option value={4}>4 Concurrent (Maximum)</option>
                      </select>
                      <p className="text-xs text-gray-500 mt-1">
                        Higher concurrency speeds up processing but uses more resources
                      </p>
                    </div>

                    <div className="bg-yellow-50 border border-yellow-200 rounded p-3">
                      <p className="text-sm text-yellow-800">
                        <strong>Batch Limits:</strong> Maximum 50 organizations per batch. 
                        Estimated time: {selectedOrgs.length * 3}-{selectedOrgs.length * 5} minutes
                      </p>
                    </div>

                    <button
                      onClick={handleBatchUpgrade}
                      disabled={isUpgrading || selectedOrgs.length === 0 || !packageUrl || !validatePackageId(packageUrl) || loading || selectedOrgs.length > 50}
                      className={`w-full py-2 px-4 rounded-md font-medium transition-colors ${
                        isUpgrading || selectedOrgs.length === 0 || !packageUrl || !validatePackageId(packageUrl) || loading || selectedOrgs.length > 50
                          ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                          : 'bg-blue-600 text-white hover:bg-blue-700'
                      }`}
                    >
                      {isUpgrading ? `Processing ${selectedOrgs.length} orgs...` : `Start Batch Upgrade (${selectedOrgs.length} orgs)`}
                    </button>
                  </div>
                </div>
              </div>
              
              <div className="lg:w-1/2">
                <div className="bg-gray-50 rounded-lg shadow-md p-6">
                  <h3 className="font-semibold text-gray-800 mb-3">Batch Upgrade Notes</h3>
                  <ul className="list-disc list-inside space-y-1 text-sm text-gray-600">
                    <li>Batch upgrades can process up to 4 orgs concurrently</li>
                    <li>Higher concurrency speeds up processing but uses more resources</li>
                    <li>Each org will take 2-5 minutes to process</li>
                    <li>You cannot stop a batch once started</li>
                    <li>Failed orgs won't affect others in the batch</li>
                    <li>Check the history tab for detailed results</li>
                    <li>Screenshots are captured for failed upgrades</li>
                    <li>Maximum 50 organizations per batch for resource management</li>
                    <li>Version confirmation will be required for each org</li>
                  </ul>
                </div>
              </div>
            </div>

            {/* Batch Progress */}
            {batchProgress && (
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
                <h3 className="font-medium text-blue-900 mb-2">Batch Progress</h3>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm text-blue-700">
                    {batchProgress.orgName ? `Processing: ${batchProgress.orgName}` : 'Processing batch...'}
                  </span>
                  <span className="text-sm font-medium text-blue-900">
                    {batchProgress.completed} of {batchProgress.total} completed
                  </span>
                </div>
                <div className="w-full bg-blue-200 rounded-full h-2 mb-2">
                  <div 
                    className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                    style={{ width: `${(batchProgress.completed / batchProgress.total) * 100}%` }}
                  />
                </div>
                {batchProgress.successCount !== undefined && batchProgress.failureCount !== undefined && (
                  <div className="text-sm text-blue-700 flex justify-between">
                    <span className="text-green-600">✅ {batchProgress.successCount} succeeded</span>
                    {batchProgress.failureCount > 0 && (
                      <span className="text-red-600">❌ {batchProgress.failureCount} failed</span>
                    )}
                    <span className="text-blue-600">{Math.round((batchProgress.completed / batchProgress.total) * 100)}% complete</span>
                  </div>
                )}
              </div>
            )}

            {/* Batch Status */}
            {batchStatus && (
              <div className={`rounded-lg p-4 mb-6 ${
                batchStatus.status === 'completed' 
                  ? 'bg-green-50 border border-green-200' 
                  : batchStatus.status === 'error'
                  ? 'bg-red-50 border border-red-200'
                  : 'bg-yellow-50 border border-yellow-200'
              }`}>
                <h3 className={`font-medium mb-2 ${
                  batchStatus.status === 'completed' ? 'text-green-900' : 
                  batchStatus.status === 'error' ? 'text-red-900' : 'text-yellow-900'
                }`}>
                  Batch Status: {batchStatus.status}
                </h3>
                <p className={`text-sm ${
                  batchStatus.status === 'completed' ? 'text-green-700' : 
                  batchStatus.status === 'error' ? 'text-red-700' : 'text-yellow-700'
                }`}>
                  {batchStatus.message}
                </p>
                {batchStatus.status === 'completed' && batchStatus.successCount !== undefined && (
                  <div className="mt-2 text-sm space-y-1">
                    <div className="flex justify-between">
                      <span className="text-green-600">✅ Success: {batchStatus.successCount}</span>
                      {batchStatus.failureCount && batchStatus.failureCount > 0 && (
                        <span className="text-red-600">❌ Failed: {batchStatus.failureCount}</span>
                      )}
                    </div>
                    {batchStatus.totalDuration && (
                      <p className="text-gray-600">Total duration: {formatDuration(batchStatus.totalDuration)}</p>
                    )}
                  </div>
                )}
                {batchStatus.results && batchStatus.results.length > 0 && (
                  <div className="mt-3 max-h-32 overflow-y-auto">
                    <h4 className="text-sm font-medium mb-1">Results:</h4>
                    <div className="space-y-1">
                      {batchStatus.results.map((result, index) => (
                        <div key={index} className="text-xs flex justify-between items-center">
                          <span>{result.orgName}</span>
                          <span className={`${result.status === 'success' ? 'text-green-600' : 'text-red-600'}`}>
                            {result.status === 'success' ? '✅' : '❌'} {result.duration ? formatDuration(result.duration) : ''}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </>
        )}

        {/* History Tab */}
        {activeTab === 'history' && (
          <div className="bg-white rounded-lg shadow-md p-6">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-semibold">Upgrade History ({historyTotal} total)</h2>
              <button
                onClick={() => fetchHistory(0)}
                className="text-sm text-blue-600 hover:text-blue-800"
                disabled={loading}
              >
                {loading ? 'Loading...' : 'Refresh'}
              </button>
            </div>
            
            {!history || history.length === 0 ? (
              <div className="text-center py-8">
                <p className="text-gray-500">No upgrade history available</p>
                {loading && <p className="text-blue-500 mt-2">Loading...</p>}
              </div>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          Time
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          Org
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          Package ID
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          Duration
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          Status
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          Type
                        </th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                      {history && history.map((entry) => (
                        <tr key={entry.id} className="hover:bg-gray-50">
                          <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-900">
                            {formatDate(entry.startTime)}
                          </td>
                          <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-900">
                            <div>
                              <div className="font-medium">{entry.orgName}</div>
                              <div className="text-xs text-gray-500">{entry.orgId}</div>
                            </div>
                          </td>
                          <td className="px-4 py-4 text-sm text-gray-900 max-w-xs">
                            <span className="font-mono text-xs">{entry.packageUrl}</span>
                          </td>
                          <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-900">
                            {formatDuration(entry.duration)}
                            {entry.retries && entry.retries > 0 && (
                              <div className="text-xs text-orange-600">
                                {entry.retries} retries
                              </div>
                            )}
                          </td>
                          <td className="px-4 py-4 whitespace-nowrap">
                            <span className={`inline-flex items-center text-sm font-medium ${getStatusColor(entry.status)}`}>
                              {getStatusIcon(entry.status)} {entry.status}
                            </span>
                            {entry.error && (
                              <div className="mt-1">
                                <p className="text-xs text-red-600" title={entry.error}>
                                  {entry.error.length > 50 ? `${entry.error.substring(0, 50)}...` : entry.error}
                                </p>
                                <div className="mt-1">
                                  {entry.screenshot ? (
                                    <button
                                      onClick={() => setShowScreenshot(entry.screenshot || '')}
                                      className="text-xs text-blue-600 hover:text-blue-800 underline"
                                    >
                                      📷 View Screenshot
                                    </button>
                                  ) : (
                                    <span className="text-xs text-gray-500">No screenshot</span>
                                  )}
                                </div>
                              </div>
                            )}
                          </td>
                          <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-500">
                            <span className={`px-2 py-1 text-xs rounded-full ${
                              entry.batchId ? 'bg-purple-100 text-purple-800' : 'bg-gray-100 text-gray-800'
                            }`}>
                              {entry.batchId ? 'Batch' : 'Single'}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                
                {/* Load More Button */}
                {history && history.length > 0 && history.length < historyTotal && (
                  <div className="mt-4 text-center">
                    <button
                      onClick={loadMoreHistory}
                      className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:bg-gray-300"
                      disabled={loading}
                    >
                      {loading ? 'Loading...' : `Load More (${Math.max(0, historyTotal - history.length)} remaining)`}
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* Status Panel - Show for both single and batch */}
        {(activeTab === 'single' || activeTab === 'batch') && Object.keys(status).length > 0 && (
          <div className="bg-white rounded-lg shadow-md p-6 mt-6">
            <h2 className="text-xl font-semibold mb-4">Automation Status</h2>
            
            <div className="space-y-3">
              {Object.entries(status).map(([orgId, orgStatus]) => {
                const org = orgs.find(o => o.id === orgId);
                return (
                  <div key={orgId} className="border border-gray-200 rounded-lg p-4">
                    <div className="flex items-center justify-between mb-2">
                      <h3 className="font-medium">{org?.name || orgId}</h3>
                      <span className={`text-sm font-medium ${getStatusColor(orgStatus.status)}`}>
                        {getStatusIcon(orgStatus.status)} {orgStatus.status}
                      </span>
                    </div>
                    <p className="text-sm text-gray-600">{orgStatus.message}</p>
                    {orgStatus.status === 'awaiting-confirmation' && (
                      <p className="text-xs text-yellow-600 mt-2">
                        ❓ Please review and confirm the package version information in the popup
                      </p>
                    )}
                    {orgStatus.status === 'verification-required' && (
                      <p className="text-xs text-purple-600 mt-2">
                        ⚠️ Manual action required: Please complete verification in the browser window
                      </p>
                    )}
                    {orgStatus.status === 'error' && (
                      <div className="mt-2">
                        {orgStatus.screenshot ? (
                          <button
                            onClick={() => setShowScreenshot(orgStatus.screenshot || '')}
                            className="text-xs text-blue-600 hover:text-blue-800 underline"
                          >
                            📷 View Error Screenshot
                          </button>
                        ) : (
                          <p className="text-xs text-gray-500">
                            (No screenshot available)
                          </p>
                        )}
                      </div>
                    )}
                    {orgStatus.timestamp && (
                      <p className="text-xs text-gray-400 mt-2">
                        Last updated: {new Date(orgStatus.timestamp).toLocaleTimeString()}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Footer with API URL and Version */}
        <div className="mt-8 p-4 bg-gray-50 rounded-lg">
          <div className="flex justify-between items-center text-sm text-gray-600">
            <div>
              <strong>Backend:</strong> {API_URL}
              {API_KEY && <span className="ml-2 text-green-600">🔐 Authenticated</span>}
            </div>
            <div className="flex items-center space-x-4">
              <span>Connection: {useSSE ? 'Server-Sent Events' : 'Polling'}</span>
              <span>Active Browsers: {activeBrowserCount || 0}</span>
              <span>Version: 1.0.1</span>
            </div>
          </div>
        </div>

        {/* Version Confirmation Modals */}
        {Object.values(versionConfirmations).map((confirmation) => (
          <VersionConfirmationModal 
            key={confirmation.upgradeId} 
            confirmation={confirmation} 
          />
        ))}

        {/* Screenshot Modal */}
        {showScreenshot && (
          <ScreenshotModal
            screenshot={showScreenshot} 
            onClose={() => setShowScreenshot(null)} 
          />
        )}
      </div>
    </div>
  );
};

export default App;