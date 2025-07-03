// frontend/src/App.tsx - Main application component with improved organization
import React, { useState, useEffect, useCallback } from 'react';
import { Auth } from './components/Auth';
import { SingleUpgradeTab } from './components/SingleUpgradeTab';
import { BatchUpgradeTab } from './components/BatchUpgradeTab';
import { HistoryTab } from './components/HistoryTab';
import { OrgManagementTab } from './components/OrgManagementTab';
import { StatusPanel } from './components/StatusPanel';
import { VersionConfirmationModal } from './components/modals/VersionConfirmationModal';
import { VerificationCodeModal } from './components/modals/VerificationCodeModal';
import { ScreenshotModal } from './components/modals/ScreenshotModal';
import { ConnectionStatus } from './components/ConnectionStatus';
import { Toast, ToastProvider, useToast } from './components/Toast';
import { useApiCall } from './hooks/useApiCall';
import { useStatusUpdates } from './hooks/useStatusUpdates';
import { 
  API_URL, 
  API_KEY,
  validatePackageId,
  getConnectionStatusColor,
  getConnectionStatusIcon
} from './utils/constants';
import type {
  Org,
  StatusUpdate,
  VersionConfirmationUpdate,
  VerificationCodeUpdate,
  BatchStatus,
  BatchProgress,
  HistoryEntry,
  TabType
} from './types';

// Separate the main app logic into its own component
const AppContent: React.FC = () => {
  // Check authentication
  const [isAuthenticated, setIsAuthenticated] = useState(() => {
    return sessionStorage.getItem('sf-upgrade-auth') === 'authenticated';
  });

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
  const [activeTab, setActiveTab] = useState<TabType>('orgs');
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [historyTotal, setHistoryTotal] = useState<number>(0);
  const [historyOffset, setHistoryOffset] = useState<number>(0);
  const [sessionId] = useState<string>(`session-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<'connecting' | 'connected' | 'disconnected' | 'error'>('connecting');
  const [showScreenshot, setShowScreenshot] = useState<string | null>(null);
  const [versionConfirmations, setVersionConfirmations] = useState<Record<string, VersionConfirmationUpdate>>({});
  const [verificationCodes, setVerificationCodes] = useState<Record<string, VerificationCodeUpdate>>({});

  // Custom hooks - now safely inside ToastProvider
  const { showToast } = useToast();
  const { callApi, loading, setLoading, setError: setApiError } = useApiCall();
  const { startStatusUpdates, stopStatusUpdates } = useStatusUpdates({
    sessionId,
    onStatusUpdate: handleStatusUpdate,
    onConnectionError: setConnectionError,
    onConnectionStatusChange: setConnectionStatus
  });

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
      showToast('Failed to connect to backend', 'error');
    } finally {
      setLoading(false);
    }
  }, [callApi, setLoading, showToast]);

  const fetchHistory = useCallback(async (offset: number = 0, limit: number = 50) => {
    try {
      const data = await callApi(`${API_URL}/api/history?offset=${offset}&limit=${limit}`);
      
      let upgrades: HistoryEntry[] = [];
      let total: number = 0;
      
      if (Array.isArray(data)) {
        upgrades = data;
        total = data.length;
      } else if (data && Array.isArray(data.upgrades)) {
        upgrades = data.upgrades;
        total = data.total || upgrades.length;
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
      if (offset === 0) {
        setHistory([]);
        setHistoryTotal(0);
        setHistoryOffset(0);
      }
    }
  }, [callApi]);

  // Status update handling
  function handleStatusUpdate(data: StatusUpdate | VersionConfirmationUpdate | VerificationCodeUpdate | BatchStatus | BatchProgress | { type: string }) {
    try {
      if (data.type === 'version-confirmation-required') {
        setVersionConfirmations(prev => ({
          ...prev,
          [(data as VersionConfirmationUpdate).upgradeId]: data as VersionConfirmationUpdate
        }));
        return;
      }

      if (data.type === 'verification-code-required') {
        setVerificationCodes(prev => ({
          ...prev,
          [(data as VerificationCodeUpdate).upgradeId]: data as VerificationCodeUpdate
        }));
        return;
      }

      if (data.type === 'status') {
        const statusData = data as StatusUpdate;
        setStatus(prev => ({
          ...prev,
          [statusData.orgId]: statusData
        }));
        
        if (statusData.status === 'completed' || statusData.status === 'error') {
          if (!statusData.batchId) {
            setIsUpgrading(false);
            setTimeout(() => {
              stopStatusUpdates();
            }, 2000);
          }
          setTimeout(() => fetchHistory(0), 1000);
        }
      } else if (data.type === 'batch-status') {
        setBatchStatus(data as BatchStatus);
        if ((data as BatchStatus).status === 'completed' || (data as BatchStatus).status === 'error') {
          setIsUpgrading(false);
          setBatchProgress(null);
          stopStatusUpdates();
          setTimeout(() => fetchHistory(0), 1000);
        }
      } else if (data.type === 'batch-progress') {
        setBatchProgress(data as BatchProgress);
      }
    } catch (error) {
      console.error('Error handling status update:', error);
    }
  }

  // Confirmation and verification handlers
  const handleVersionConfirmation = useCallback(async (upgradeId: string, confirmed: boolean) => {
    try {
      await callApi(`${API_URL}/api/confirm-upgrade`, {
        method: 'POST',
        body: JSON.stringify({
          sessionId,
          upgradeId,
          confirmed
        }),
      });
      
      setVersionConfirmations(prev => {
        const updated = { ...prev };
        delete updated[upgradeId];
        return updated;
      });
      
    } catch (error) {
      console.error('Error sending confirmation:', error);
      showToast(`Failed to send confirmation: ${error instanceof Error ? error.message : 'Unknown error'}`, 'error');
    }
  }, [callApi, sessionId, showToast]);

  const handleVerificationCode = useCallback(async (upgradeId: string, verificationCode: string) => {
    try {
      await callApi(`${API_URL}/api/submit-verification`, {
        method: 'POST',
        body: JSON.stringify({
          sessionId,
          upgradeId,
          verificationCode
        }),
      });
      
      setVerificationCodes(prev => {
        const updated = { ...prev };
        delete updated[upgradeId];
        return updated;
      });
      
    } catch (error) {
      console.error('Error sending verification code:', error);
      showToast(`Failed to send verification code: ${error instanceof Error ? error.message : 'Unknown error'}`, 'error');
    }
  }, [callApi, sessionId, showToast]);

  // Org management handlers
  const handleAddOrg = useCallback(async (orgData: Omit<Org, 'id'>) => {
    try {
      const response = await callApi(`${API_URL}/api/orgs`, {
        method: 'POST',
        body: JSON.stringify(orgData),
      });
      
      // Refresh orgs list
      await fetchOrgs();
      return response;
    } catch (error) {
      throw error;
    }
  }, [callApi, fetchOrgs]);

  const handleEditOrg = useCallback(async (orgId: string, orgData: Omit<Org, 'id'>) => {
    try {
      const response = await callApi(`${API_URL}/api/orgs/${orgId}`, {
        method: 'PUT',
        body: JSON.stringify(orgData),
      });
      
      // Refresh orgs list
      await fetchOrgs();
      return response;
    } catch (error) {
      throw error;
    }
  }, [callApi, fetchOrgs]);

  const handleDeleteOrg = useCallback(async (orgId: string) => {
    try {
      const response = await callApi(`${API_URL}/api/orgs/${orgId}`, {
        method: 'DELETE',
      });
      
      // Refresh orgs list
      await fetchOrgs();
      
      // Clear selection if deleted org was selected
      if (selectedOrg === orgId) {
        setSelectedOrg('');
      }
      if (selectedOrgs.includes(orgId)) {
        setSelectedOrgs(selectedOrgs.filter(id => id !== orgId));
      }
      
      return response;
    } catch (error) {
      throw error;
    }
  }, [callApi, fetchOrgs, selectedOrg, selectedOrgs]);

  // Upgrade handlers
  const handleSingleUpgrade = useCallback(async (): Promise<void> => {
    if (!selectedOrg) {
      showToast('Please select an organization', 'warning');
      return;
    }

    if (!packageUrl) {
      showToast('Please enter a package ID', 'warning');
      return;
    }

    if (!validatePackageId(packageUrl)) {
      showToast('Invalid package ID format. It should be 15 characters starting with "04t"', 'error');
      return;
    }

    setIsUpgrading(true);
    setStatus({});
    setVersionConfirmations({});
    setVerificationCodes({});
    setApiError(null);
    startStatusUpdates();
    
    try {
      await callApi(`${API_URL}/api/upgrade`, {
        method: 'POST',
        body: JSON.stringify({
          orgId: selectedOrg,
          packageUrl,
          sessionId
        }),
      });
      showToast('Upgrade process started successfully', 'success');
    } catch (error) {
      console.error('Error starting upgrade:', error);
      setIsUpgrading(false);
      stopStatusUpdates();
      showToast(`Failed to start upgrade: ${error instanceof Error ? error.message : 'Unknown error'}`, 'error');
    }
  }, [selectedOrg, packageUrl, sessionId, callApi, startStatusUpdates, stopStatusUpdates, setApiError, showToast]);

  const handleBatchUpgrade = useCallback(async (): Promise<void> => {
    if (selectedOrgs.length === 0) {
      showToast('Please select at least one organization', 'warning');
      return;
    }

    if (!packageUrl) {
      showToast('Please enter a package ID', 'warning');
      return;
    }

    if (!validatePackageId(packageUrl)) {
      showToast('Invalid package ID format. It should be 15 characters starting with "04t"', 'error');
      return;
    }

    if (selectedOrgs.length > 50) {
      showToast('Maximum 50 organizations allowed per batch', 'error');
      return;
    }

    const confirmMessage = `Are you sure you want to upgrade ${selectedOrgs.length} organization(s)? This process cannot be stopped once started.`;
    if (!window.confirm(confirmMessage)) {
      return;
    }

    setIsUpgrading(true);
    setStatus({});
    setVersionConfirmations({});
    setVerificationCodes({});
    setBatchStatus(null);
    setBatchProgress(null);
    setApiError(null);
    startStatusUpdates();
    
    try {
      await callApi(`${API_URL}/api/upgrade-batch`, {
        method: 'POST',
        body: JSON.stringify({
          orgIds: selectedOrgs,
          packageUrl,
          maxConcurrent,
          sessionId
        }),
      });
      showToast('Batch upgrade process started successfully', 'success');
    } catch (error) {
      console.error('Error starting batch upgrade:', error);
      setIsUpgrading(false);
      stopStatusUpdates();
      showToast(`Failed to start batch upgrade: ${error instanceof Error ? error.message : 'Unknown error'}`, 'error');
    }
  }, [selectedOrgs, packageUrl, maxConcurrent, sessionId, callApi, startStatusUpdates, stopStatusUpdates, setApiError, showToast]);

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

  // Show auth screen if not authenticated
  if (!isAuthenticated) {
    return <Auth onAuthenticated={() => setIsAuthenticated(true)} />;
  }

  return (
    <div className="min-h-screen bg-gray-100 p-8">
      <div className="max-w-6xl mx-auto">
        <div className="flex justify-between items-center mb-8">
          <h1 className="text-3xl font-bold text-gray-800">
            Salesforce Package Upgrade Automation
          </h1>
          
          <div className="flex items-center space-x-4">
            <span className={`text-sm font-medium ${getConnectionStatusColor(connectionStatus)}`}>
              {getConnectionStatusIcon(connectionStatus)} {connectionStatus}
            </span>
            <button
              onClick={() => {
                sessionStorage.removeItem('sf-upgrade-auth');
                setIsAuthenticated(false);
              }}
              className="text-sm text-gray-600 hover:text-gray-800"
            >
              Logout
            </button>
          </div>
        </div>

        <ConnectionStatus error={connectionError} loading={loading && orgs.length === 0} />

        {/* Tab Navigation */}
        <div className="flex space-x-1 mb-6">
          <button
            onClick={() => setActiveTab('orgs')}
            className={`px-4 py-2 rounded-t-lg font-medium transition-colors ${
              activeTab === 'orgs'
                ? 'bg-white text-blue-600 border-b-2 border-blue-600'
                : 'bg-gray-200 text-gray-600 hover:bg-gray-300'
            }`}
          >
            Organizations ({orgs.length})
          </button>
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

        {/* Tab Content */}
        {activeTab === 'orgs' && (
          <OrgManagementTab
            orgs={orgs}
            loading={loading}
            onAddOrg={handleAddOrg}
            onEditOrg={handleEditOrg}
            onDeleteOrg={handleDeleteOrg}
            onRefresh={fetchOrgs}
          />
        )}

        {activeTab === 'single' && (
          <SingleUpgradeTab
            orgs={orgs}
            selectedOrg={selectedOrg}
            setSelectedOrg={setSelectedOrg}
            packageUrl={packageUrl}
            setPackageUrl={setPackageUrl}
            isUpgrading={isUpgrading}
            loading={loading}
            onUpgrade={handleSingleUpgrade}
          />
        )}

        {activeTab === 'batch' && (
          <BatchUpgradeTab
            orgs={orgs}
            selectedOrgs={selectedOrgs}
            setSelectedOrgs={setSelectedOrgs}
            packageUrl={packageUrl}
            setPackageUrl={setPackageUrl}
            maxConcurrent={maxConcurrent}
            setMaxConcurrent={setMaxConcurrent}
            isUpgrading={isUpgrading}
            loading={loading}
            batchStatus={batchStatus}
            batchProgress={batchProgress}
            onUpgrade={handleBatchUpgrade}
          />
        )}

        {activeTab === 'history' && (
          <HistoryTab
            history={history}
            historyTotal={historyTotal}
            loading={loading}
            onRefresh={() => fetchHistory(0)}
            onLoadMore={() => {
              if (history && history.length < historyTotal && !loading) {
                fetchHistory(historyOffset);
              }
            }}
            onShowScreenshot={setShowScreenshot}
          />
        )}

        {/* Status Panel */}
        {(activeTab === 'single' || activeTab === 'batch') && Object.keys(status).length > 0 && (
          <StatusPanel
            status={status}
            orgs={orgs}
            onShowScreenshot={setShowScreenshot}
          />
        )}

        {/* Footer */}
        <div className="mt-8 p-4 bg-gray-50 rounded-lg">
          <div className="flex justify-between items-center text-sm text-gray-600">
            <div>
              <strong>Backend:</strong> {API_URL}
              {API_KEY && <span className="ml-2 text-green-600">🔐 Authenticated</span>}
            </div>
            <div className="flex items-center space-x-4">
              <span>Version: 1.0.3</span>
            </div>
          </div>
        </div>

        {/* Modals */}
        {Object.values(versionConfirmations).map((confirmation) => (
          <VersionConfirmationModal 
            key={confirmation.upgradeId} 
            confirmation={confirmation}
            orgs={orgs}
            onConfirm={handleVersionConfirmation}
          />
        ))}

        {Object.values(verificationCodes).map((verification) => (
          <VerificationCodeModal 
            key={verification.upgradeId} 
            verification={verification}
            orgs={orgs}
            onSubmit={handleVerificationCode}
          />
        ))}

        {showScreenshot && (
          <ScreenshotModal
            screenshot={showScreenshot} 
            onClose={() => setShowScreenshot(null)} 
          />
        )}
      </div>
      <Toast />
    </div>
  );
};

// Main App component that provides the Toast context
const App: React.FC = () => {
  return (
    <ToastProvider>
      <AppContent />
    </ToastProvider>
  );
};

export default App;