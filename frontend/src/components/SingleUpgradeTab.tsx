// components/SingleUpgradeTab.tsx
import React, { memo, useCallback, useRef, useEffect } from 'react';
import { validatePackageId } from '../utils/constants';
import type { Org } from '../types';

interface SingleUpgradeTabProps {
  orgs: Org[];
  selectedOrg: string;
  setSelectedOrg: (orgId: string) => void;
  packageUrl: string;
  setPackageUrl: (url: string) => void;
  isUpgrading: boolean;
  loading: boolean;
  onUpgrade: () => Promise<void>;
}

export const SingleUpgradeTab: React.FC<SingleUpgradeTabProps> = memo(({
  orgs,
  selectedOrg,
  setSelectedOrg,
  packageUrl,
  setPackageUrl,
  isUpgrading,
  loading,
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

  const isValid = packageUrl && validatePackageId(packageUrl);
  const canUpgrade = !isUpgrading && selectedOrg && packageUrl && isValid && !loading;

  return (
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

            <button
              onClick={onUpgrade}
              disabled={!canUpgrade}
              className={`w-full py-2 px-4 rounded-md font-medium transition-colors ${
                canUpgrade
                  ? 'bg-blue-600 text-white hover:bg-blue-700'
                  : 'bg-gray-300 text-gray-500 cursor-not-allowed'
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
            <li>If verification is required, you'll be prompted to enter a code</li>
            <li>Package ID must be exactly 15 characters starting with "04t"</li>
            <li>Each upgrade typically takes 2-5 minutes to complete</li>
            <li>Cloud Run has a 5-minute timeout limit per request</li>
            <li>Screenshots are captured automatically on errors for debugging</li>
            <li>You'll be asked to confirm package versions before proceeding</li>
            <li className="text-purple-600 font-medium">NEW: Email verification codes can now be entered directly!</li>
          </ul>
        </div>
      </div>
    </div>
  );
});