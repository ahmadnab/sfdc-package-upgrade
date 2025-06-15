// components/BatchUpgradeTab.tsx
import React, { memo, useCallback, useMemo, useRef, useEffect } from 'react';
import { validatePackageId, formatDuration } from '../utils/constants';
import type { Org, BatchStatus, BatchProgress } from '../types';

interface BatchUpgradeTabProps {
  orgs: Org[];
  selectedOrgs: string[];
  setSelectedOrgs: (orgIds: string[]) => void;
  packageUrl: string;
  setPackageUrl: (url: string) => void;
  maxConcurrent: number;
  setMaxConcurrent: (value: number) => void;
  isUpgrading: boolean;
  loading: boolean;
  batchStatus: BatchStatus | null;
  batchProgress: BatchProgress | null;
  onUpgrade: () => Promise<void>;
}

export const BatchUpgradeTab: React.FC<BatchUpgradeTabProps> = memo(({
  orgs,
  selectedOrgs,
  setSelectedOrgs,
  packageUrl,
  setPackageUrl,
  maxConcurrent,
  setMaxConcurrent,
  isUpgrading,
  loading,
  batchStatus,
  batchProgress,
  onUpgrade
}) => {
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  const handlePackageUrlChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    
    // Clear existing timeout
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
    
    // Set new timeout for debounced update
    timeoutRef.current = setTimeout(() => {
      setPackageUrl(value.trim());
    }, 300);
  }, [setPackageUrl]);

  // Organization selection handlers
  const toggleOrgSelection = useCallback((orgId: string) => {
    setSelectedOrgs(
      selectedOrgs.includes(orgId)
        ? selectedOrgs.filter(id => id !== orgId)
        : [...selectedOrgs, orgId]
    );
  }, [selectedOrgs, setSelectedOrgs]);

  const selectAllOrgs = useCallback(() => {
    setSelectedOrgs(orgs.map(org => org.id));
  }, [orgs, setSelectedOrgs]);

  const deselectAllOrgs = useCallback(() => {
    setSelectedOrgs([]);
  }, [setSelectedOrgs]);

  // Validation
  const isValid = packageUrl && validatePackageId(packageUrl);
  const canUpgrade = !isUpgrading && selectedOrgs.length > 0 && packageUrl && 
                     isValid && !loading && selectedOrgs.length <= 50;

  // Memoized calculations
  const estimatedTime = useMemo(() => {
    const min = selectedOrgs.length * 3;
    const max = selectedOrgs.length * 5;
    return { min, max };
  }, [selectedOrgs.length]);

  return (
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
                  defaultValue={packageUrl}
                  onChange={handlePackageUrlChange}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="04tKb000000J8s9"
                  disabled={isUpgrading}
                  maxLength={15}
                />
                {packageUrl && !isValid && (
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
                  Estimated time: {estimatedTime.min}-{estimatedTime.max} minutes
                </p>
              </div>

              <button
                onClick={onUpgrade}
                disabled={!canUpgrade}
                className={`w-full py-2 px-4 rounded-md font-medium transition-colors ${
                  canUpgrade
                    ? 'bg-blue-600 text-white hover:bg-blue-700'
                    : 'bg-gray-300 text-gray-500 cursor-not-allowed'
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
              <li className="text-purple-600 font-medium">NEW: Verification codes can be entered for each org!</li>
            </ul>
          </div>
        </div>
      </div>

      {/* Batch Progress */}
      {batchProgress && (
        <BatchProgressDisplay progress={batchProgress} />
      )}

      {/* Batch Status */}
      {batchStatus && (
        <BatchStatusDisplay status={batchStatus} formatDuration={formatDuration} />
      )}
    </>
  );
});

// Sub-components
const BatchProgressDisplay: React.FC<{ progress: BatchProgress }> = ({ progress }) => (
  <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
    <h3 className="font-medium text-blue-900 mb-2">Batch Progress</h3>
    <div className="flex items-center justify-between mb-2">
      <span className="text-sm text-blue-700">
        {progress.orgName ? `Processing: ${progress.orgName}` : 'Processing batch...'}
      </span>
      <span className="text-sm font-medium text-blue-900">
        {progress.completed} of {progress.total} completed
      </span>
    </div>
    <div className="w-full bg-blue-200 rounded-full h-2 mb-2">
      <div 
        className="bg-blue-600 h-2 rounded-full transition-all duration-300"
        style={{ width: `${(progress.completed / progress.total) * 100}%` }}
      />
    </div>
    {progress.successCount !== undefined && progress.failureCount !== undefined && (
      <div className="text-sm text-blue-700 flex justify-between">
        <span className="text-green-600">✅ {progress.successCount} succeeded</span>
        {progress.failureCount > 0 && (
          <span className="text-red-600">❌ {progress.failureCount} failed</span>
        )}
        <span className="text-blue-600">{Math.round((progress.completed / progress.total) * 100)}% complete</span>
      </div>
    )}
  </div>
);

const BatchStatusDisplay: React.FC<{ 
  status: BatchStatus; 
  formatDuration: (seconds: number | null) => string;
}> = ({ status, formatDuration }) => (
  <div className={`rounded-lg p-4 mb-6 ${
    status.status === 'completed' 
      ? 'bg-green-50 border border-green-200' 
      : status.status === 'error'
      ? 'bg-red-50 border border-red-200'
      : 'bg-yellow-50 border border-yellow-200'
  }`}>
    <h3 className={`font-medium mb-2 ${
      status.status === 'completed' ? 'text-green-900' : 
      status.status === 'error' ? 'text-red-900' : 'text-yellow-900'
    }`}>
      Batch Status: {status.status}
    </h3>
    <p className={`text-sm ${
      status.status === 'completed' ? 'text-green-700' : 
      status.status === 'error' ? 'text-red-700' : 'text-yellow-700'
    }`}>
      {status.message}
    </p>
    {status.status === 'completed' && status.successCount !== undefined && (
      <div className="mt-2 text-sm space-y-1">
        <div className="flex justify-between">
          <span className="text-green-600">✅ Success: {status.successCount}</span>
          {status.failureCount && status.failureCount > 0 && (
            <span className="text-red-600">❌ Failed: {status.failureCount}</span>
          )}
        </div>
        {status.totalDuration && (
          <p className="text-gray-600">Total duration: {formatDuration(status.totalDuration)}</p>
        )}
      </div>
    )}
    {status.results && status.results.length > 0 && (
      <div className="mt-3 max-h-32 overflow-y-auto">
        <h4 className="text-sm font-medium mb-1">Results:</h4>
        <div className="space-y-1">
          {status.results.map((result, index) => (
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
);