// components/StatusPanel.tsx
import React from 'react';
import { getStatusColor, getStatusIcon } from '../utils/constants';
import type { StatusUpdate, Org } from '../types';

interface StatusPanelProps {
  status: Record<string, StatusUpdate>;
  orgs: Org[];
  onShowScreenshot: (screenshot: string) => void;
}

export const StatusPanel: React.FC<StatusPanelProps> = ({ status, orgs, onShowScreenshot }) => {
  return (
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
                <p className="text-xs text-purple-600 mt-2 font-medium">
                  🔐 Check your email for a verification code and enter it in the popup
                </p>
              )}
              
              {orgStatus.status === 'entering-verification' && (
                <p className="text-xs text-purple-600 mt-2">
                  🔑 Entering verification code...
                </p>
              )}
              
              {orgStatus.status === 'verification-completed' && (
                <p className="text-xs text-green-600 mt-2">
                  ✅ Verification completed successfully!
                </p>
              )}
              
              {orgStatus.status === 'error' && (
                <div className="mt-2">
                  {orgStatus.screenshot ? (
                    <button
                      onClick={() => onShowScreenshot(orgStatus.screenshot || '')}
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
  );
};