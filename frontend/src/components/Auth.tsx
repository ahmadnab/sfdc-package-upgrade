// frontend/src/components/Auth.tsx
import React, { useState, useCallback } from 'react';
import { useToast } from './Toast';

interface AuthProps {
  onAuthenticated: () => void;
}

export const Auth: React.FC<AuthProps> = ({ onAuthenticated }) => {
  const [passcode, setPasscode] = useState('');
  const [isChecking, setIsChecking] = useState(false);
  const [attempts, setAttempts] = useState(0);
  const { showToast } = useToast();

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!passcode.trim()) {
      showToast('Please enter a passcode', 'warning');
      return;
    }

    setIsChecking(true);
    
    // Simulate async check for better UX
    setTimeout(() => {
      if (passcode === 'Ec@12345') {
        sessionStorage.setItem('sf-upgrade-auth', 'authenticated');
        showToast('Authentication successful!', 'success');
        onAuthenticated();
      } else {
        setAttempts(prev => prev + 1);
        showToast(`Invalid passcode. ${3 - attempts > 0 ? `${3 - attempts} attempts remaining.` : 'Please refresh and try again.'}`, 'error');
        setPasscode('');
        
        if (attempts >= 2) {
          showToast('Too many failed attempts. Please refresh the page.', 'error');
        }
      }
      setIsChecking(false);
    }, 500);
  }, [passcode, attempts, onAuthenticated, showToast]);

  return (
    <div className="min-h-screen bg-gray-100 flex items-center justify-center p-4">
      <div className="max-w-md w-full">
        <div className="bg-white rounded-lg shadow-lg p-8">
          <div className="text-center mb-8">
            <h1 className="text-2xl font-bold text-gray-800 mb-2">
              Salesforce Package Upgrade Tool
            </h1>
            <p className="text-gray-600">Please enter your passcode to continue</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Passcode
              </label>
              <input
                type="password"
                value={passcode}
                onChange={(e) => setPasscode(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Enter passcode"
                disabled={isChecking || attempts >= 3}
                autoFocus
              />
            </div>

            <button
              type="submit"
              disabled={isChecking || attempts >= 3 || !passcode.trim()}
              className={`w-full py-2 px-4 rounded-md font-medium transition-colors ${
                isChecking || attempts >= 3 || !passcode.trim()
                  ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                  : 'bg-blue-600 text-white hover:bg-blue-700'
              }`}
            >
              {isChecking ? 'Checking...' : 'Access Tool'}
            </button>
          </form>

          <div className="mt-6 text-center">
            <p className="text-xs text-gray-500">
              This tool is for authorized users only. Unauthorized access is prohibited.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};