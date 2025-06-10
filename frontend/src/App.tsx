import React, { useState, useEffect, useRef } from 'react';

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

const App: React.FC = () => {
  const [orgs, setOrgs] = useState<Org[]>([]);
  const [selectedOrg, setSelectedOrg] = useState<string>('');
  const [selectedOrgs, setSelectedOrgs] = useState<string[]>([]);
  const [packageUrl, setPackageUrl] = useState<string>('');
  const [maxConcurrent, setMaxConcurrent] = useState<number>(2);
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
  const [packageIdError, setPackageIdError] = useState<string>("");

  const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:5001';
  useEffect(() => {
    // Fetch orgs
    fetch(`${API_URL}/api/orgs`)
      .then(res => res.json())
      .then((data: Org[]) => setOrgs(data))
      .catch(err => console.error('Error fetching orgs:', err));

    // Fetch history
    fetchHistory();

    return () => {
      // Cleanup
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
      }
    };
  }, []);

  const fetchHistory = async () => {
    try {
      const response = await fetch(`${API_URL}/api/history`);
      const data = await response.json();
      setHistory(data);
    } catch (error) {
      console.error('Error fetching history:', error);
    }
  };

  const startStatusUpdates = () => {
    // Try SSE first
    if (useSSE && typeof EventSource !== 'undefined') {
      try {
        eventSourceRef.current = new EventSource(`${API_URL}/api/status-stream/${sessionId}`);

        eventSourceRef.current.onmessage = (event) => {
          const data = JSON.parse(event.data);
          handleStatusUpdate(data);
        };

        eventSourceRef.current.onerror = (error) => {
          console.log('SSE error, falling back to polling');
          eventSourceRef.current?.close();
          setUseSSE(false);
          startPolling();
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
    // Poll for status updates every second
    pollingIntervalRef.current = setInterval(async () => {
      try {
        const response = await fetch(`${API_URL}/api/status/${sessionId}`);
        const statuses = await response.json();
        
        Object.values(statuses).forEach((update: any) => {
          handleStatusUpdate(update);
        });
      } catch (error) {
        console.error('Polling error:', error);
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
  };

  const handleSingleUpgrade = async (): Promise<void> => {
    if (!selectedOrg || !packageUrl) {
      alert('Please select an org and enter a package ID');
      return;
    }

    // Basic validation for package ID format
    if (packageUrl.length !== 15 || !packageUrl.match(/^04t[a-zA-Z0-9]{12}$/)) {
      alert('Invalid package ID format. It should be 15 characters starting with "04t" (e.g., 04tKb000000J8s9)');
      return;
    }

    setIsUpgrading(true);
    setStatus({});
    startStatusUpdates();
    
    try {
      const response = await fetch(`${API_URL}/api/upgrade`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          orgId: selectedOrg,
          packageUrl: packageUrl,
          sessionId: sessionId
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to start upgrade');
      }
    } catch (error) {
      console.error('Error starting upgrade:', error);
      setIsUpgrading(false);
      stopStatusUpdates();
      alert('Failed to start upgrade process');
    }
  };

  const handleBatchUpgrade = async (): Promise<void> => {
    if (selectedOrgs.length === 0 || !packageUrl) {
      alert('Please select at least one org and enter a package ID');
      return;
    }

    // Basic validation for package ID format
    if (packageUrl.length !== 15 || !packageUrl.match(/^04t[a-zA-Z0-9]{12}$/)) {
      alert('Invalid package ID format. It should be 15 characters starting with "04t" (e.g., 04tKb000000J8s9)');
      return;
    }

    setIsUpgrading(true);
    setStatus({});
    setBatchStatus(null);
    setBatchProgress(null);
    startStatusUpdates();
    
    try {
      const response = await fetch(`${API_URL}/api/upgrade-batch`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          orgIds: selectedOrgs,
          packageUrl: packageUrl,
          maxConcurrent: maxConcurrent,
          sessionId: sessionId
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to start batch upgrade');
      }
    } catch (error) {
      console.error('Error starting batch upgrade:', error);
      setIsUpgrading(false);
      stopStatusUpdates();
      alert('Failed to start batch upgrade process');
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
    return new Date(dateString).toLocaleString();
  };

  return (
    <div className="min-h-screen bg-gray-100 p-8">
      <div className="max-w-6xl mx-auto">
        <h1 className="text-3xl font-bold text-gray-800 mb-8">
          Salesforce Package Upgrade Utility
        </h1>

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
          <>
            <div className="bg-white rounded-lg shadow-md p-6 mb-6">
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
                    disabled={isUpgrading}
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
                    maxLength={15}
                    onChange={(e) => {
                      const value = e.target.value.trim();
                      setPackageUrl(value);
                      if (value.length > 0 && value.length < 15) {
                        setPackageIdError('Invalid Package ID');
                      } else {
                        setPackageIdError('');
                      }
                    }}
                    className={`w-full px-3 py-2 border ${packageIdError ? 'border-red-500' : 'border-gray-300'} rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500`}
                    placeholder="04tKb000000J8s9"
                    disabled={isUpgrading}
                  />
                  {packageIdError && (
                    <p className="text-xs text-red-600 mt-1">{packageIdError}</p>
                  )}
                </div>

                <button
                  onClick={handleSingleUpgrade}
                  disabled={isUpgrading || !selectedOrg || !packageUrl}
                  className={`w-full py-2 px-4 rounded-md font-medium transition-colors ${
                    isUpgrading || !selectedOrg || !packageUrl
                      ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                      : 'bg-blue-600 text-white hover:bg-blue-700'
                  }`}
                >
                  {isUpgrading ? 'Upgrading...' : 'Start Upgrade'}
                </button>
              </div>
            </div>
          </>
        )}

        {/* Batch Upgrade Tab */}
        {activeTab === 'batch' && (
          <>
            <div className="bg-white rounded-lg shadow-md p-6 mb-6">
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
                        disabled={isUpgrading}
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
                    {orgs.map(org => (
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
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Package ID (e.g., 04tKb000000J8s9)
                  </label>
                  <input
                    type="text"
                    value={packageUrl}
                    maxLength={15}
                    onChange={(e) => {
                      const value = e.target.value.trim();
                      setPackageUrl(value);
                      if (value.length > 0 && value.length < 15) {
                        setPackageIdError('Invalid Package ID');
                      } else {
                        setPackageIdError('');
                      }
                    }}
                    className={`w-full px-3 py-2 border ${packageIdError ? 'border-red-500' : 'border-gray-300'} rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500`}
                    placeholder="04tKb000000J8s9"
                    disabled={isUpgrading}
                  />
                  {packageIdError && (
                    <p className="text-xs text-red-600 mt-1">{packageIdError}</p>
                  )}
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Concurrent Upgrades (1-4 recommended)
                  </label>
                  <select
                    value={maxConcurrent}
                    onChange={(e) => setMaxConcurrent(Number(e.target.value))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    disabled={isUpgrading}
                  >
                    <option value={1}>1 (Sequential)</option>
                    <option value={2}>2 (Recommended)</option>
                    <option value={3}>3</option>
                    <option value={4}>4 (Maximum)</option>
                  </select>
                  <p className="text-xs text-gray-500 mt-1">
                    Higher values speed up processing but use more system resources
                  </p>
                </div>

                <button
                  onClick={handleBatchUpgrade}
                  disabled={isUpgrading || selectedOrgs.length === 0 || !packageUrl}
                  className={`w-full py-2 px-4 rounded-md font-medium transition-colors ${
                    isUpgrading || selectedOrgs.length === 0 || !packageUrl
                      ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                      : 'bg-blue-600 text-white hover:bg-blue-700'
                  }`}
                >
                  {isUpgrading ? `Upgrading ${selectedOrgs.length} orgs...` : `Start Batch Upgrade (${selectedOrgs.length} orgs)`}
                </button>
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
              >
                Refresh
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
            <h2 className="text-xl font-semibold mb-4">Status Log</h2>
            
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
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        <div className="mt-6 text-sm text-gray-600">
          <p className="font-medium mb-2">Notes:</p>
          <ul className="list-disc list-inside space-y-1">
            <li>If you received an AWS URL with the mail, make sure it's added to SFDC before you trigger upgrade.</li>
            <li>Make sure your org credentials are configured in Google Cloud environment variables</li>
            <li>Package ID should be the 15-character ID from the Salesforce package URL</li>
            <li>Batch upgrades can process multiple orgs in parallel (configurable 1-4)</li>
            <li>Higher concurrency speeds up processing but uses more system resources</li>
          </ul>
        </div>
      </div>
    </div>
  );
};

export default App;
