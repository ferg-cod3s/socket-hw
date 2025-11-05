'use client';

interface LoadingSpinnerProps {
  fileName: string;
}

export function LoadingSpinner({ fileName }: LoadingSpinnerProps) {
  return (
    <div className="flex flex-col items-center gap-6 p-12" role="status" aria-live="polite">
      <div className="relative">
        {/* Background circle */}
        <div className="w-24 h-24 border-8 border-gray-200 dark:border-gray-700 rounded-full"></div>
        {/* Spinning circle */}
        <div
          className="absolute top-0 left-0 w-24 h-24 border-8 border-blue-600 border-t-transparent rounded-full animate-spin"
          aria-hidden="true"
        ></div>
      </div>

      <div className="text-center">
        <p className="text-xl font-semibold text-gray-900 dark:text-white">
          Scanning {fileName}...
        </p>
        <p className="text-gray-600 dark:text-gray-400 mt-2">
          Analyzing dependencies and checking for vulnerabilities
        </p>
      </div>
    </div>
  );
}
