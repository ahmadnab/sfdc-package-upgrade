// components/HistoryTab.tsx
import React, { memo, useCallback } from 'react';
import { formatDate, formatDuration, getStatusColor, getStatusIcon } from '../utils/constants';
import type { HistoryEntry } from '../types';

interface HistoryTabProps {
  history: HistoryEntry[];
  historyTotal: number;
  loading: boolean;
  onRefresh: () => void;
  onLoadMore: () => void;
  onShowScreenshot: (screenshot: string) => void;
}

export const HistoryTab: React.FC<HistoryTabProps> = memo(({
  history,
  historyTotal,
  loading,
  onRefresh,
  onLoadMore,
  onShowScreenshot
}) => {
  const handleScreenshotClick = useCallback((screenshot: string | null | undefined) => {
    if (screenshot) {
      onShowScreenshot(screenshot);
    }
  }, [onShowScreenshot]);

  const truncateError = useCallback((error: string | null, maxLength: number = 50) => {
    if (!error) return '';
    return error.length > maxLength ? `${error.substring(0, maxLength)}...` : error;
  }, []);

  const canLoadMore = history && history.length > 0 && history.length < historyTotal && !loading;

  return (
    <div className="bg-white rounded-lg shadow-md p-6">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-xl font-semibold">Upgrade History ({historyTotal} total)</h2>
        <button
          onClick={onRefresh}
          className="text-sm text-blue-600 hover:text-blue-800"
          disabled={loading}
        >
          {loading ? 'Loading...' : 'Refresh'}
        </button>
      </div>
      
      {!history || history.length === 0 ? (
        <EmptyState loading={loading} />
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
                {history.map((entry) => (
                  <HistoryRow 
                    key={entry.id} 
                    entry={entry} 
                    onScreenshotClick={handleScreenshotClick}
                    truncateError={truncateError}
                  />
                ))}
              </tbody>
            </table>
          </div>
          
          {/* Load More Button */}
          {canLoadMore && (
            <div className="mt-4 text-center">
              <button
                onClick={onLoadMore}
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
  );
});

// Sub-components
const EmptyState: React.FC<{ loading: boolean }> = ({ loading }) => (
  <div className="text-center py-8">
    <p className="text-gray-500">No upgrade history available</p>
    {loading && <p className="text-blue-500 mt-2">Loading...</p>}
  </div>
);

const HistoryRow: React.FC<{
  entry: HistoryEntry;
  onScreenshotClick: (screenshot: string | null | undefined) => void;
  truncateError: (error: string | null, maxLength?: number) => string;
}> = memo(({ entry, onScreenshotClick, truncateError }) => (
  <tr className="hover:bg-gray-50">
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
            {truncateError(entry.error)}
          </p>
          <div className="mt-1">
            {entry.screenshot ? (
              <button
                onClick={() => onScreenshotClick(entry.screenshot)}
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
));