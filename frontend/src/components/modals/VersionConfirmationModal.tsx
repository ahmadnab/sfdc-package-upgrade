// components/modals/VersionConfirmationModal.tsx
import React from 'react';
import type { VersionConfirmationUpdate, Org } from '../../types';

interface VersionConfirmationModalProps {
  confirmation: VersionConfirmationUpdate;
  orgs: Org[];
  onConfirm: (upgradeId: string, confirmed: boolean) => void;
}

export const VersionConfirmationModal: React.FC<VersionConfirmationModalProps> = ({ 
  confirmation, 
  orgs,
  onConfirm 
}) => {
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
            onClick={() => onConfirm(confirmation.upgradeId, false)}
            className="px-6 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 font-medium"
          >
            ❌ Cancel Upgrade
          </button>
          
          <button
            onClick={() => onConfirm(confirmation.upgradeId, true)}
            className="px-6 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 font-medium"
          >
            ✅ Confirm & Proceed
          </button>
        </div>
      </div>
    </div>
  );
};