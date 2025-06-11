import React, { useState, useEffect, useRef, useCallback } from 'react';

// Configuration
const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:5001';
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
          'navigating-package' | 'finding-upgrade-button' | 'upgrading' | 'completed' | 'error';
  message: string;
}

interface BatchStatus {
  type: 'batch-status';
  batchId: string;
  status: 'started' | 'completed';
  totalOrgs?: number;
  successCount?: number;
  failureCount?: number;
  message: string;
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
    
    const headers: HeadersInit = {
      'Content-Type': 'application/json',
      ...options.headers,
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
      if (retries > 0 && error.message.includes('Failed to fetch')) {
        console.log(`Retrying API call... (${retries} retries left)`);
        await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
        return callApi(url, options, retries - 1);
      }
      
      throw error;
    }
  }, []);

  return { callApi, loading, error, setLoading, setError };
};

const App: React.FC = () => {
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
  const [sessionId] = useState<string>(`session-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`);
  const eventSourceRef = useRef<EventSource | null>(null);
  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const [useSSE, setUseSSE] = useState<boolean>(true);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const { callApi, loading, error: apiError, setLoading, setError: setApiError } = useApiCall();

  // Fetch orgs on mount
  useEffect(() => {
    fetchOrgs();
    fetchHistory();
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopStatusUpdates();
    };
  }, []);

  const fetchOrgs = async () => {
    try {
      setLoading(true);
      const data = await callApi(`${API_URL}/api/orgs`);
      setOrgs(data);
      setConnectionError(null);
    } catch (error) {
      console.error('Error fetching orgs:', error);
      setConnectionError('Failed to connect to backend. Please check if the server is running.');
    } finally {
      setLoading(false);
    }
  };

  const fetchHistory = async () => {
    try {
      const data = await callApi(`${API_URL}/api/history`);
      setHistory(data);
    } catch (error) {
      console.error('Error fetching history:', error);
      // Don't show error for history, it's not critical
    }
  };

  const validatePackageId = (packageId: string): boolean => {
    return packageId.length === 15 && /^04t[a-zA-Z0-9]{12}$/.test(packageId);
  };

  const startStatusUpdates = () => {
    setConnectionError(null);
    
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
          console.log('SSE error, falling back to polling');
          eventSourceRef.current?.close();
          setUseSSE(false);
          startPolling();
        };

        eventSourceRef.current.onopen = () => {
          console.log('SSE connection established');
          setConnectionError(null);
        };
      } catch (error) {
        console.log('SSE not supported, using polling');
        setUseSSE(false);
        startPolling();
      }
    } else {
      startPolling();
    }
  };

  const startPolling = () => {
    let errorCount = 0;
    
    pollingIntervalRef.current = setInterval(async () => {
      try {
        const data = await callApi(`${API_URL}/api/status/${sessionId}`);
        
        Object.values(data).forEach((update: any) => {
          handleStatusUpdate(update);
        });
        
        errorCount = 0; // Reset error count on success
        setConnectionError(null);
      } catch (error) {
        errorCount++;
        console.error('Polling error:', error);
        
        if (errorCount > 3) {
          setConnectionError('Lost connection to server. Please refresh the page.');
          stopStatusUpdates();
        }
      }
    }, 1000);
  };

  const stopStatusUpdates = () => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current);
      pollingIntervalRef.current = null;
    }
  };

  const handleStatusUpdate = (data: any) => {
    try {
      if (data.type === 'status') {
        setStatus(prev => ({
          ...prev,
          [data.orgId]: data
        }));
        
        if (data.status === 'completed' || data.status === 'error') {
          if (!data.batchId) {
            setIsUpgrading(false);
            stopStatusUpdates();
          }
          setTimeout(fetchHistory, 1000);
        }
      } else if (data.type === 'batch-status') {
        setBatchStatus(data);
        if (data.status === 'completed') {
          setIsUpgrading(false);
          setBatchProgress(null);
          stopStatusUpdates();
        }
      } else if (data.type === 'batch-progress') {
        setBatchProgress(data);
      }
    } catch (error) {
      console.error('Error handling status update:', error);
    }
  };

  const handleSingleUpgrade = async (): Promise<void> => {
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
  };

  const handleBatchUpgrade = async (): Promise<void> => {
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

    const confirmMessage = `Are you sure you want to upgrade ${selectedOrgs.length} organization(s)? This process cannot be stopped once started.`;
    if (!window.confirm(confirmMessage)) {
      return;
    }

    setIsUpgrading(true);
    setStatus({});
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
  };

  const toggleOrgSelection = (orgId: string) => {
    setSelectedOrgs(prev => {
      if (prev.includes(orgId)) {
        return prev.filter(id => id !== orgId);
      } else {
        return [...prev, orgId];
      }
    });
  };

  const selectAllOrgs = () => {
    setSelectedOrgs(orgs.map(org => org.id));
  };

  const deselectAllOrgs = () => {
    setSelectedOrgs([]);
  };

  const getStatusColor = (status: string): string => {
    switch (status) {
      case 'completed':
      case 'success': return 'text-green-600';
      case 'error':
      case 'failed': return 'text-red-600';
      case 'upgrading': return 'text-blue-600';
      case 'timeout': return 'text-orange-600';
      case 'verification-required': return 'text-purple-600';
      default: return 'text-yellow-600';
    }
  };

  const getStatusIcon = (status: string): string => {
    switch (status) {
      case 'completed':
      case 'success': return '✅';
      case 'error':
      case 'failed': return '❌';
      case 'upgrading': return '🔄';
      case 'timeout': return '⚠️';
      case 'verification-required': return '🔐';
      default: return '⏳';
    }
  };

  const formatDuration = (seconds: number | null): string => {
    if (!seconds) return '-';
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}m ${secs}s`;
  };

  const formatDate = (dateString: string): string => {
    try {
      return new Date(dateString).toLocaleString();
    } catch {
      return dateString;
    }
  };

  // Error display component
  const ErrorAlert = ({ message }: { message: string }) => (
    <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded relative mb-4">
      <strong className="font-bold">Error: </strong>
      <span className="block sm:inline">{message}</span>
    </div>
  );

  // Connection status component
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

  return (
    <div className="min-h-screen bg-gray-100 p-8">
      <div className="max-w-6xl mx-auto">
        <h1 className="text-3xl font-bold text-gray-800 mb-8">
          Salesforce Package Upgrade Automation
        </h1>

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
            Batch Upgrade
          </button>
          <button
            onClick={() => setActiveTab('history')}
            className={`px-4 py-2 rounded-t-lg font-medium transition-colors ${
              activeTab === 'history'
                ? 'bg-white text-blue-600 border-b-2 border-blue-600'
                : 'bg-gray-200 text-gray-600 hover:bg-gray-300'
            }`}
          >
            History
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
                        Concurrent Upgrades
                      </label>
                      <select
                        value={maxConcurrent}
                        onChange={(e) => setMaxConcurrent(Number(e.target.value))}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                        disabled={isUpgrading}
                      >
                        <option value={1}>1 (Sequential - Recommended for Cloud Run)</option>
                        <option value={2}>2 (Use only with higher memory allocation)</option>
                      </select>
                      <p className="text-xs text-gray-500 mt-1">
                        Cloud Run free tier works best with sequential processing
                      </p>
                    </div>

                    <button
                      onClick={handleBatchUpgrade}
                      disabled={isUpgrading || selectedOrgs.length === 0 || !packageUrl || !validatePackageId(packageUrl) || loading}
                      className={`w-full py-2 px-4 rounded-md font-medium transition-colors ${
                        isUpgrading || selectedOrgs.length === 0 || !packageUrl || !validatePackageId(packageUrl) || loading
                          ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                          : 'bg-blue-600 text-white hover:bg-blue-700'
                      }`}
                    >
                      {isUpgrading ? `Upgrading ${selectedOrgs.length} orgs...` : `Start Batch Upgrade (${selectedOrgs.length} orgs)`}
                    </button>
                  </div>
                </div>
              </div>
              
              <div className="lg:w-1/2">
                <div className="bg-gray-50 rounded-lg shadow-md p-6">
                  <h3 className="font-semibold text-gray-800 mb-3">Important Notes</h3>
                  <ul className="list-disc list-inside space-y-1 text-sm text-gray-600">
                    <li>Batch upgrades process orgs sequentially by default</li>
                    <li>Higher concurrency speeds up processing but uses more resources</li>
                    <li>Each org will take 2-5 minutes to process</li>
                    <li>You cannot stop a batch once started</li>
                    <li>Failed orgs won't affect others in the batch</li>
                    <li>Check the history tab for detailed results</li>
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
                    Processing {maxConcurrent > 1 ? `up to ${maxConcurrent} orgs in parallel` : 'sequentially'}
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
                  <div className="text-sm text-blue-700">
                    <span className="text-green-600">✅ {batchProgress.successCount} succeeded</span>
                    {batchProgress.failureCount > 0 && (
                      <span className="ml-4 text-red-600">❌ {batchProgress.failureCount} failed</span>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Batch Status */}
            {batchStatus && (
              <div className={`rounded-lg p-4 mb-6 ${
                batchStatus.status === 'completed' 
                  ? 'bg-green-50 border border-green-200' 
                  : 'bg-yellow-50 border border-yellow-200'
              }`}>
                <h3 className={`font-medium mb-2 ${
                  batchStatus.status === 'completed' ? 'text-green-900' : 'text-yellow-900'
                }`}>
                  Batch Status
                </h3>
                <p className={`text-sm ${
                  batchStatus.status === 'completed' ? 'text-green-700' : 'text-yellow-700'
                }`}>
                  {batchStatus.message}
                </p>
                {batchStatus.status === 'completed' && batchStatus.successCount !== undefined && (
                  <div className="mt-2 text-sm">
                    <span className="text-green-600">✅ Success: {batchStatus.successCount}</span>
                    {batchStatus.failureCount! > 0 && (
                      <span className="ml-4 text-red-600">❌ Failed: {batchStatus.failureCount}</span>
                    )}
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
              <h2 className="text-xl font-semibold">Upgrade History</h2>
              <button
                onClick={fetchHistory}
                className="text-sm text-blue-600 hover:text-blue-800"
                disabled={loading}
              >
                {loading ? 'Loading...' : 'Refresh'}
              </button>
            </div>
            
            {history.length === 0 ? (
              <p className="text-gray-500">No upgrade history available</p>
            ) : (
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
                    {history.map((entry) => (
                      <tr key={entry.id} className="hover:bg-gray-50">
                        <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-900">
                          {formatDate(entry.startTime)}
                        </td>
                        <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-900">
                          {entry.orgName}
                        </td>
                        <td className="px-4 py-4 text-sm text-gray-900 max-w-xs truncate" title={entry.packageUrl}>
                          {entry.packageUrl}
                        </td>
                        <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-900">
                          {formatDuration(entry.duration)}
                        </td>
                        <td className="px-4 py-4 whitespace-nowrap">
                          <span className={`inline-flex items-center text-sm font-medium ${getStatusColor(entry.status)}`}>
                            {getStatusIcon(entry.status)} {entry.status}
                          </span>
                          {entry.error && (
                            <p className="text-xs text-red-600 mt-1" title={entry.error}>
                              {entry.error.substring(0, 50)}...
                            </p>
                          )}
                        </td>
                        <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-500">
                          {entry.batchId ? 'Batch' : 'Single'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* Status Panel - Show for both single and batch */}
        {(activeTab === 'single' || activeTab === 'batch') && (
          <div className="bg-white rounded-lg shadow-md p-6">
            <h2 className="text-xl font-semibold mb-4">Automation Status</h2>
            
            {Object.keys(status).length === 0 ? (
              <p className="text-gray-500">No upgrades in progress</p>
            ) : (
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
                      {orgStatus.status === 'verification-required' && (
                        <p className="text-xs text-purple-600 mt-2">
                          ⚠️ Manual action required: Please complete verification in the browser window
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {API_URL !== 'http://localhost:5001' && (
          <div className="mt-6 p-3 bg-green-50 border border-green-200 rounded">
            <p className="text-green-800 text-xs">
              <strong>Connected to:</strong> {API_URL}
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

export default App;