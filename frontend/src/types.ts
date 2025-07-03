// frontend/src/types.ts - Centralized type definitions

export interface Org {
  id: string;
  name: string;
  url: string;
  username: string;
}

export interface StatusUpdate {
  type: 'status';
  orgId: string;
  upgradeId?: string;
  batchId?: string;
  status: 'starting' | 'navigating' | 'logging-in' | 'logged-in' | 'verification-required' | 
          'entering-verification' | 'verification-completed' | 'navigating-package' | 
          'extracting-version-info' | 'awaiting-confirmation' | 'user-confirmed' |
          'finding-upgrade-button' | 'upgrading' | 'completed' | 'error';
  message: string;
  screenshot?: string;
  timestamp?: number;
}

export interface VersionConfirmationUpdate {
  type: 'version-confirmation-required';
  orgId: string;
  upgradeId: string;
  batchId?: string;
  status: 'awaiting-confirmation';
  message: string;
  versionInfo: {
    installedVersion: string;
    newVersion: string;
    headerMessage: string;
    fullText: string;
  };
}

export interface VerificationCodeUpdate {
  type: 'verification-code-required';
  orgId: string;
  upgradeId: string;
  batchId?: string;
  status: 'verification-required';
  message: string;
  screenshot?: string;
}

export interface BatchStatus {
  type: 'batch-status';
  batchId: string;
  status: 'started' | 'completed' | 'error';
  totalOrgs?: number;
  successCount?: number;
  failureCount?: number;
  message: string;
  results?: Array<{
    orgId: string;
    orgName: string;
    status: string;
    error?: string;
    duration?: number;
  }>;
  startTime?: string;
  endTime?: string;
  totalDuration?: number;
}

export interface BatchProgress {
  type: 'batch-progress';
  batchId: string;
  orgId?: string;
  orgName?: string;
  status?: string;
  completed: number;
  total: number;
  successCount?: number;
  failureCount?: number;
  percentComplete?: number;
}

export interface HistoryEntry {
  id: string;
  batchId: string | null;
  orgId: string;
  orgName: string;
  packageUrl: string;
  startTime: string;
  endTime: string | null;
  duration: number | null;
  status: 'in-progress' | 'success' | 'failed' | 'timeout';
  error: string | null;
  screenshot?: string | null;
  retries?: number;
}

export interface HistoryResponse {
  upgrades: HistoryEntry[];
  total: number;
  limit: number;
  offset: number;
}

export type TabType = 'orgs' | 'single' | 'batch' | 'history';

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected' | 'error';

export interface ApiError {
  error: string;
  message: string;
}