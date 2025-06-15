// utils/constants.ts - Shared constants and utility functions

// Configuration
export const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:8080';
export const API_KEY = process.env.REACT_APP_API_KEY || '';
export const MAX_RETRIES = 3;
export const RETRY_DELAY = 1000;

// Validation functions
export const validatePackageId = (packageId: string): boolean => {
  return packageId.length === 15 && /^04t[a-zA-Z0-9]{12}$/.test(packageId);
};

// Screenshot validation
export const validateScreenshot = (screenshot: string): { isValid: boolean; error?: string } => {
  if (!screenshot) return { isValid: false, error: 'Empty screenshot' };
  
  if (!screenshot.startsWith('data:image/')) {
    return { isValid: false, error: 'Not a data URL' };
  }
  
  if (!screenshot.includes('base64,')) {
    return { isValid: false, error: 'Not base64 encoded' };
  }
  
  const base64Part = screenshot.split('base64,')[1];
  if (!base64Part) {
    return { isValid: false, error: 'No base64 data' };
  }
  
  const base64Regex = /^[A-Za-z0-9+/]*={0,2}$/;
  if (!base64Regex.test(base64Part)) {
    return { isValid: false, error: 'Invalid base64 characters' };
  }
  
  if (base64Part.length % 4 !== 0) {
    return { isValid: false, error: 'Invalid base64 length' };
  }
  
  return { isValid: true };
};

export const cleanScreenshot = (screenshot: string): string => {
  if (!screenshot) return '';
  
  let cleaned = screenshot.replace(/\s/g, '');
  
  if (cleaned.startsWith('data:image/') && cleaned.includes('base64,')) {
    const [header, base64Data] = cleaned.split('base64,');
    const cleanBase64 = base64Data.replace(/[^A-Za-z0-9+/=]/g, '');
    cleaned = `${header}base64,${cleanBase64}`;
  }
  
  return cleaned;
};

// Formatting functions
export const formatDuration = (seconds: number | null): string => {
  if (!seconds) return '-';
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}m ${secs}s`;
};

export const formatDate = (dateString: string): string => {
  try {
    return new Date(dateString).toLocaleString();
  } catch {
    return dateString;
  }
};

// Status helper functions
export const getStatusColor = (status: string): string => {
  switch (status) {
    case 'completed':
    case 'success': return 'text-green-600';
    case 'error':
    case 'failed': return 'text-red-600';
    case 'upgrading': return 'text-blue-600';
    case 'timeout': return 'text-orange-600';
    case 'verification-required': return 'text-purple-600';
    case 'entering-verification': return 'text-purple-600';
    case 'verification-completed': return 'text-green-600';
    case 'awaiting-confirmation': return 'text-yellow-600';
    case 'user-confirmed': return 'text-green-600';
    case 'extracting-version-info': return 'text-blue-600';
    case 'in-progress': return 'text-yellow-600';
    default: return 'text-gray-600';
  }
};

export const getStatusIcon = (status: string): string => {
  switch (status) {
    case 'completed':
    case 'success': return '✅';
    case 'error':
    case 'failed': return '❌';
    case 'upgrading': return '🔄';
    case 'timeout': return '⚠️';
    case 'verification-required': return '🔐';
    case 'entering-verification': return '🔑';
    case 'verification-completed': return '✅';
    case 'awaiting-confirmation': return '❓';
    case 'user-confirmed': return '👍';
    case 'extracting-version-info': return '📋';
    case 'in-progress': return '⏳';
    default: return '⏳';
  }
};

export const getConnectionStatusColor = (status: string): string => {
  switch (status) {
    case 'connected': return 'text-green-600';
    case 'connecting': return 'text-yellow-600';
    case 'disconnected': return 'text-gray-600';
    case 'error': return 'text-red-600';
    default: return 'text-gray-600';
  }
};

export const getConnectionStatusIcon = (status: string): string => {
  switch (status) {
    case 'connected': return '🟢';
    case 'connecting': return '🟡';
    case 'disconnected': return '⚪';
    case 'error': return '🔴';
          default: return '⚪';
  }
};