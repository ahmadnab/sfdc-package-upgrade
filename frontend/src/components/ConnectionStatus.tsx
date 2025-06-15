// components/ConnectionStatus.tsx
import React from 'react';

interface ConnectionStatusProps {
  error: string | null;
  loading: boolean;
}

export const ConnectionStatus: React.FC<ConnectionStatusProps> = ({ error, loading }) => {
  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded relative mb-4">
        <strong className="font-bold">Error: </strong>
        <span className="block sm:inline">{error}</span>
      </div>
    );
  }
  
  if (loading) {
    return (
      <div className="bg-blue-50 border border-blue-200 text-blue-700 px-4 py-3 rounded relative mb-4">
        <span className="block sm:inline">Connecting to backend...</span>
      </div>
    );
  }
  
  return null;
};