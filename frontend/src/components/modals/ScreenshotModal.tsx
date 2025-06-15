// components/modals/ScreenshotModal.tsx
import React from 'react';
import { validateScreenshot } from '../../utils/constants';

interface ScreenshotModalProps {
  screenshot: string;
  onClose: () => void;
}

export const ScreenshotModal: React.FC<ScreenshotModalProps> = ({ screenshot, onClose }) => {
  const validation = validateScreenshot(screenshot);
  
  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-white rounded-lg w-full max-w-md sm:max-w-lg md:max-w-2xl max-h-[80vh] overflow-auto shadow-lg"
        style={{ boxSizing: 'border-box' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-center p-4 border-b">
          <h3 className="text-lg font-semibold">Error Screenshot</h3>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-700 text-2xl leading-none"
          >
            ×
          </button>
        </div>
        <div className="p-4 overflow-auto" style={{ maxHeight: '60vh' }}>
          {!validation.isValid ? (
            <div className="text-center py-8">
              <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4">
                ❌ Invalid Screenshot Data
              </div>
              <p className="text-gray-600 mb-4">
                The screenshot data received is not in a valid format.
              </p>
              {validation.error && (
                <p className="text-sm text-gray-500">
                  Error: {validation.error}
                </p>
              )}
            </div>
          ) : (
            <div>
              <div className="overflow-auto" style={{ maxWidth: '100%', maxHeight: '50vh' }}>
                <img 
                  src={screenshot} 
                  alt="Error screenshot" 
                  className="max-w-full h-auto border border-gray-300 rounded block"
                  style={{ maxWidth: '100%', maxHeight: '40vh', objectFit: 'contain' }}
                  onError={(e) => {
                    console.error('Image load error:', e);
                    (e.target as HTMLImageElement).style.display = 'none';
                    const errorDiv = document.createElement('div');
                    errorDiv.className = 'text-center py-8';
                    errorDiv.innerHTML = `
                      <div class="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4">
                        ❌ Failed to display screenshot
                      </div>
                      <p class="text-gray-600">Screenshot data validation passed but image failed to load.</p>
                    `;
                    (e.target as HTMLImageElement).parentNode?.appendChild(errorDiv);
                  }}
                />
              </div>
              <div className="mt-4 text-sm text-gray-600">
                <p>This screenshot was captured when the error occurred.</p>
                <p className="mt-2">You can right-click and save the image for debugging purposes.</p>
              </div>
            </div>
          )}
        </div>
        <div className="flex justify-end p-4 border-t">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-gray-600 text-white rounded hover:bg-gray-700"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};