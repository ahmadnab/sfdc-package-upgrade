// frontend/src/components/modals/OrgModal.tsx
import React, { useState, useCallback, useEffect } from 'react';
import type { Org } from '../../types';

interface OrgModalProps {
  org: Org | null;
  onSave: (org: Omit<Org, 'id'>) => void;
  onClose: () => void;
}

export const OrgModal: React.FC<OrgModalProps> = ({ org, onSave, onClose }) => {
  const [formData, setFormData] = useState({
    name: '',
    url: '',
    username: '',
    password: ''
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    if (org) {
      setFormData({
        name: org.name,
        url: org.url,
        username: org.username,
        password: '' // Don't populate password for security
      });
    }
  }, [org]);

  const validateUrl = (url: string): boolean => {
    try {
      const urlObj = new URL(url);
      return urlObj.protocol === 'https:' && 
             (url.includes('.salesforce.com') || url.includes('.force.com'));
    } catch {
      return false;
    }
  };

  const validateForm = useCallback((): boolean => {
    const newErrors: Record<string, string> = {};

    if (!formData.name.trim()) {
      newErrors.name = 'Organization name is required';
    } else if (formData.name.length < 3) {
      newErrors.name = 'Organization name must be at least 3 characters';
    }

    if (!formData.url.trim()) {
      newErrors.url = 'URL is required';
    } else if (!validateUrl(formData.url)) {
      newErrors.url = 'Invalid Salesforce URL. Must be HTTPS and contain salesforce.com or force.com';
    }

    if (!formData.username.trim()) {
      newErrors.username = 'Username is required';
    } else if (!formData.username.includes('@')) {
      newErrors.username = 'Username must be a valid email address';
    }

    // Password is required only for new orgs
    if (!org && !formData.password.trim()) {
      newErrors.password = 'Password is required';
    } else if (formData.password && formData.password.length < 8) {
      newErrors.password = 'Password must be at least 8 characters';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }, [formData, org]);

  const handleSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    
    if (validateForm()) {
      // If editing and no password provided, exclude it from the update
      const dataToSave = org && !formData.password 
        ? { name: formData.name, url: formData.url, username: formData.username }
        : formData;
      
      onSave(dataToSave as Omit<Org, 'id'>);
    }
  }, [formData, org, validateForm, onSave]);

  const handleChange = useCallback((field: keyof typeof formData, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    // Clear error when user starts typing
    if (errors[field]) {
      setErrors(prev => ({ ...prev, [field]: '' }));
    }
  }, [errors]);

  const formatUrl = useCallback((url: string): string => {
    let formatted = url.trim();
    
    // Add https:// if missing
    if (formatted && !formatted.startsWith('http')) {
      formatted = 'https://' + formatted;
    }
    
    // Ensure it ends with proper Salesforce domain
    if (formatted && !formatted.includes('.salesforce.com') && !formatted.includes('.force.com')) {
      if (formatted.includes('.my')) {
        formatted = formatted.replace('.my', '.my.salesforce.com');
      } else {
        formatted = formatted + '.my.salesforce.com';
      }
    }
    
    return formatted;
  }, []);

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg max-w-2xl w-full overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex justify-between items-center p-6 border-b bg-gray-50">
          <h3 className="text-xl font-semibold text-gray-900">
            {org ? 'Edit Organization' : 'Add New Organization'}
          </h3>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-2xl leading-none"
          >
            ×
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6">
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Organization Name <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={formData.name}
                onChange={(e) => handleChange('name', e.target.value)}
                className={`w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                  errors.name ? 'border-red-500' : 'border-gray-300'
                }`}
                placeholder="e.g., Production Org"
              />
              {errors.name && (
                <p className="text-red-500 text-sm mt-1">{errors.name}</p>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Salesforce URL <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={formData.url}
                onChange={(e) => handleChange('url', e.target.value)}
                onBlur={(e) => handleChange('url', formatUrl(e.target.value))}
                className={`w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                  errors.url ? 'border-red-500' : 'border-gray-300'
                }`}
                placeholder="https://mydomain.my.salesforce.com"
              />
              {errors.url && (
                <p className="text-red-500 text-sm mt-1">{errors.url}</p>
              )}
              <p className="text-xs text-gray-500 mt-1">
                Enter your Salesforce instance URL (e.g., https://mydomain.my.salesforce.com)
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Username (Email) <span className="text-red-500">*</span>
              </label>
              <input
                type="email"
                value={formData.username}
                onChange={(e) => handleChange('username', e.target.value)}
                className={`w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                  errors.username ? 'border-red-500' : 'border-gray-300'
                }`}
                placeholder="admin@company.com"
              />
              {errors.username && (
                <p className="text-red-500 text-sm mt-1">{errors.username}</p>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Password {!org && <span className="text-red-500">*</span>}
              </label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={formData.password}
                  onChange={(e) => handleChange('password', e.target.value)}
                  className={`w-full px-3 py-2 pr-10 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                    errors.password ? 'border-red-500' : 'border-gray-300'
                  }`}
                  placeholder={org ? 'Leave blank to keep current password' : 'Enter password'}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute inset-y-0 right-0 pr-3 flex items-center text-gray-400 hover:text-gray-600"
                >
                  {showPassword ? '👁️' : '👁️‍🗨️'}
                </button>
              </div>
              {errors.password && (
                <p className="text-red-500 text-sm mt-1">{errors.password}</p>
              )}
              {org && (
                <p className="text-xs text-gray-500 mt-1">
                  Leave blank to keep the current password
                </p>
              )}
            </div>
          </div>

          <div className="mt-6 p-4 bg-yellow-50 rounded-lg">
            <h4 className="font-semibold text-yellow-900 mb-2">⚠️ Security Tips</h4>
            <ul className="list-disc list-inside text-sm text-yellow-800 space-y-1">
              <li>Use a dedicated integration user account when possible</li>
              <li>Ensure the user has appropriate permissions for package management</li>
              <li>Consider using OAuth instead of username/password for production</li>
              <li>Store credentials securely and rotate them regularly</li>
            </ul>
          </div>

          <div className="flex justify-end space-x-3 mt-6">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 font-medium"
            >
              {org ? 'Update Organization' : 'Add Organization'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};