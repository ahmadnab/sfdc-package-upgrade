// components/modals/VerificationCodeModal.tsx
import React, { useState, useCallback } from 'react';
import type { VerificationCodeUpdate, Org } from '../../types';

interface VerificationCodeModalProps {
  verification: VerificationCodeUpdate;
  orgs: Org[];
  onSubmit: (upgradeId: string, verificationCode: string) => void;
}

export const VerificationCodeModal: React.FC<VerificationCodeModalProps> = ({ 
  verification, 
  orgs,
  onSubmit 
}) => {
  const [verificationCode, setVerificationCode] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const org = orgs.find(o => o.id === verification.orgId);
  
  const handleSubmit = useCallback(async () => {
    if (!/^\d{6}$/.test(verificationCode)) {
      alert('Please enter a valid 6-digit verification code');
      return;
    }
    
    setIsSubmitting(true);
    try {
      await onSubmit(verification.upgradeId, verificationCode);
    } finally {
      setIsSubmitting(false);
    }
  }, [verificationCode, verification.upgradeId, onSubmit]);

  const handleCodeChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value.replace(/\D/g, '').slice(0, 6);
    setVerificationCode(value);
  }, []);

  const handleKeyPress = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && verificationCode.length === 6) {
      handleSubmit();
    }
  }, [verificationCode, handleSubmit]);
  
  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg max-w-2xl w-full overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex justify-between items-center p-6 border-b bg-purple-50">
          <h3 className="text-xl font-semibold text-purple-900">Verification Code Required</h3>
          <span className="text-sm text-purple-600">
            {org?.name || verification.orgId}
          </span>
        </div>
        
        <div className="p-6">
          <div className="mb-6">
            <p className="text-gray-700 mb-4">
              Salesforce has sent a verification code to your email address. 
              Please check your email and enter the 6-digit code below.
            </p>
            
            {verification.screenshot && (
              <div className="mb-4">
                <p className="text-sm text-gray-600 mb-2">Screenshot of verification page:</p>
                <div className="border border-gray-300 rounded-lg overflow-hidden">
                  <img 
                    src={verification.screenshot} 
                    alt="Verification page" 
                    className="max-w-full h-auto"
                    style={{ maxHeight: '300px', objectFit: 'contain' }}
                  />
                </div>
              </div>
            )}
          </div>
          
          <div className="mb-6">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Enter 6-digit verification code:
            </label>
            <input
              type="text"
              value={verificationCode}
              onChange={handleCodeChange}
              onKeyPress={handleKeyPress}
              placeholder="123456"
              className="w-full px-4 py-3 text-center text-2xl font-mono border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
              maxLength={6}
              disabled={isSubmitting}
              autoFocus
            />
            <p className="text-xs text-gray-500 mt-2">
              The code should be 6 digits sent to your registered email
            </p>
          </div>
          
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-6">
            <h4 className="font-semibold text-yellow-900 mb-2">⏱️ Time Sensitive</h4>
            <p className="text-sm text-yellow-800">
              You have 2 minutes to enter the verification code before the process times out.
              If you don't receive the code, check your spam folder or contact your Salesforce admin.
            </p>
          </div>
          
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <h4 className="font-semibold text-blue-900 mb-2">💡 Tips</h4>
            <ul className="list-disc list-inside text-sm text-blue-800 space-y-1">
              <li>Check your email inbox and spam folder</li>
              <li>The code is usually sent from Salesforce within seconds</li>
              <li>If you don't receive the code, you may need to configure your org's verification settings</li>
              <li>The code expires after a few minutes, so enter it promptly</li>
            </ul>
          </div>
        </div>
        
        <div className="flex justify-end items-center p-6 border-t bg-gray-50">
          <div className="flex items-center space-x-4">
            {verificationCode.length < 6 && (
              <span className="text-sm text-gray-500">
                {6 - verificationCode.length} digits remaining
              </span>
            )}
            <button
              onClick={handleSubmit}
              disabled={verificationCode.length !== 6 || isSubmitting}
              className={`px-6 py-2 rounded-lg font-medium ${
                verificationCode.length === 6 && !isSubmitting
                  ? 'bg-purple-600 text-white hover:bg-purple-700'
                  : 'bg-gray-300 text-gray-500 cursor-not-allowed'
              }`}
            >
              {isSubmitting ? 'Submitting...' : 'Submit Code'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};