'use client';

import { useState } from 'react';
import { FileUpload } from '@/components/FileUpload';
import { ScanResults } from '@/components/ScanResults';
import { LoadingSpinner } from '@/components/LoadingSpinner';
import type { ScanResult } from '@/lib/scanner';

export default function Home() {
  const [isScanning, setIsScanning] = useState(false);
  const [scanResult, setScanResult] = useState<ScanResult | null>(null);
  const [fileName, setFileName] = useState<string>('');
  const [error, setError] = useState<string | null>(null);

  const handleUpload = async (fileOrFiles: File | FileList) => {
    setIsScanning(true);
    setError(null);
    setScanResult(null); // Clear previous results

    try {
      const formData = new FormData();

      // Handle both single file and directory uploads
      if (fileOrFiles instanceof File) {
        // Single file upload
        setFileName(fileOrFiles.name);
        formData.append('lockfile', fileOrFiles);
      } else {
        // Directory upload (FileList or FileList-like array)
        const fileList = fileOrFiles;
        setFileName(`${fileList.length} files from folder`);

        // Handle both native FileList and array-based FileList
        if (Array.isArray(fileList)) {
          // Array-based (from drag/drop)
          fileList.forEach((file) => {
            formData.append('lockfile', file);
          });
        } else {
          // Native FileList (from input[webkitdirectory])
          for (let i = 0; i < fileList.length; i++) {
            const file = fileList[i];
            formData.append('lockfile', file);
          }
        }
      }

      const response = await fetch('/api/scan', {
        method: 'POST',
        body: formData
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || errorData.error || 'Scan failed');
      }

      const data = await response.json();
      setScanResult(data.results);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Scan failed');
      console.error('Scan error:', err);
    } finally {
      setIsScanning(false);
    }
  };

  const handleReset = () => {
    setScanResult(null);
    setFileName('');
    setError(null);
  };

  return (
    <div className="min-h-screen bg-linear-to-br from-gray-50 to-gray-100 dark:from-gray-900 dark:to-black">
      <div className="container mx-auto px-4 py-12">
        {/* Header */}
        <header className="text-center mb-12">
          <h1 className="text-5xl font-bold text-gray-900 dark:text-white mb-4">
            Vulnerability Scanner
          </h1>
          <p className="text-xl text-gray-600 dark:text-gray-400">
            Upload your lockfile to scan for known security vulnerabilities
          </p>
          <p className="text-sm text-gray-500 dark:text-gray-500 mt-2">
            Powered by OSV.dev & GitHub Security Advisories
          </p>
        </header>

        {/* Main Content */}
        <main className="flex flex-col items-center gap-8">
          {/* File Upload (only show when not scanning and no results) */}
          {!scanResult && !isScanning && (
            <FileUpload onUpload={handleUpload} isScanning={isScanning} />
          )}

          {/* Loading State */}
          {isScanning && <LoadingSpinner fileName={fileName} />}

          {/* Error State */}
          {error && !isScanning && (
            <div
              className="bg-red-50 dark:bg-red-900 border border-red-200 dark:border-red-700 rounded-lg p-6 max-w-2xl w-full"
              role="alert"
            >
              <h3 className="text-lg font-semibold text-red-800 dark:text-red-200 mb-2">
                Scan Error
              </h3>
              <p className="text-red-600 dark:text-red-300">{error}</p>
              <button
                onClick={handleReset}
                className="mt-4 px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 transition-colors"
              >
                Try Again
              </button>
            </div>
          )}

          {/* Results State */}
          {scanResult && !isScanning && (
            <>
              <ScanResults result={scanResult} fileName={fileName} />
              <button
                onClick={handleReset}
                className="px-6 py-3 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors font-medium shadow-sm"
              >
                Scan Another File
              </button>
            </>
          )}
        </main>

        {/* Footer */}
        <footer className="text-center mt-16 text-gray-500 dark:text-gray-400 text-sm">
          <p>
            Built for Socket.dev | Open Source Vulnerability Scanner
          </p>
        </footer>
      </div>
    </div>
  );
}
