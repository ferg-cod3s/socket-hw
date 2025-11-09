'use client';

import { useEffect, useState } from 'react';
import type { ProgressUpdate } from '@/types';

interface LoadingSpinnerProps {
  fileName: string;
  progress?: ProgressUpdate;
}

const STAGES = {
  'detecting-ecosystem': { name: 'Detecting ecosystem...', percent: 5 },
  'gathering-dependencies': { name: 'Gathering dependencies...', percent: 20 },
  'scanning-packages': { name: 'Scanning packages for vulnerabilities...', percent: 50 },
  'filtering-advisories': { name: 'Filtering results...', percent: 85 },
  'finalizing': { name: 'Generating report...', percent: 95 }
};

type StageKey = keyof typeof STAGES;

export function LoadingSpinner({ fileName, progress }: LoadingSpinnerProps) {
  const [displayProgress, setDisplayProgress] = useState(0);
  const [displayStage, setDisplayStage] = useState('detecting-ecosystem');

  // Update progress display with smooth animation
  useEffect(() => {
    if (!progress) return;

    const stage = progress.stage as StageKey;
    setDisplayStage(stage);

    // If we're in the scanning-packages stage, calculate progress based on deps scanned
    if (stage === 'scanning-packages' && progress.depsScanned !== undefined && progress.totalDeps) {
      const percent = 20 + (progress.depsScanned / progress.totalDeps) * 60; // 20-80%
      setDisplayProgress(percent);
    } else {
      // Use the provided percent or stage default
      setDisplayProgress(progress.percent || STAGES[stage]?.percent || 50);
    }
  }, [progress]);

  // Animate progress bar to current value
  const [animatedProgress, setAnimatedProgress] = useState(0);
  useEffect(() => {
    const diff = displayProgress - animatedProgress;
    if (diff === 0) return;

    const speed = Math.max(0.5, Math.abs(diff) * 0.1); // Faster for bigger jumps
    const increment = diff > 0 ? speed : -speed;

    const timer = setInterval(() => {
      setAnimatedProgress(prev => {
        const next = prev + increment;
        if ((increment > 0 && next >= displayProgress) || (increment < 0 && next <= displayProgress)) {
          return displayProgress;
        }
        return next;
      });
    }, 16); // ~60fps

    return () => clearInterval(timer);
  }, [displayProgress]);

  return (
    <div className="flex flex-col items-center gap-6 p-12" role="status" aria-live="polite">
      <div className="w-full max-w-md space-y-6">
        {/* Spinning circle */}
        <div className="flex justify-center">
          <div className="relative w-24 h-24">
            <div className="absolute inset-0 border-8 border-gray-200 dark:border-gray-700 rounded-full"></div>
            <div
              className="absolute inset-0 border-8 border-blue-600 border-t-transparent rounded-full animate-spin"
              aria-hidden="true"
            ></div>
          </div>
        </div>

        {/* Title and stage text */}
        <div className="text-center">
          <p className="text-xl font-semibold text-gray-900 dark:text-white">
            Scanning {fileName}...
          </p>
          <p className="text-sm text-gray-600 dark:text-gray-400 mt-2">
            {STAGES[displayStage as StageKey]?.name || 'Processing...'}
            {progress?.depsScanned && progress?.totalDeps && (
              <span className="block mt-1">
                Scanned {progress.depsScanned} of {progress.totalDeps} dependencies
              </span>
            )}
          </p>
        </div>

        {/* Progress bar */}
        <div className="space-y-2">
          <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-3 overflow-hidden">
            <div
              className="bg-blue-600 h-full rounded-full transition-all duration-300 ease-out"
              style={{ width: `${Math.min(animatedProgress, 100)}%` }}
              role="progressbar"
              aria-valuenow={Math.round(animatedProgress)}
              aria-valuemin={0}
              aria-valuemax={100}
            ></div>
          </div>
          <div className="text-xs text-gray-500 dark:text-gray-400 text-center">
            {Math.round(animatedProgress)}% complete
          </div>
        </div>

        {/* Stage indicator */}
        <div className="flex gap-2 justify-center text-xs">
          {Object.entries(STAGES).map(([key, stage]) => (
            <div
              key={key}
              className={`px-2 py-1 rounded transition-colors ${
                displayStage === key
                  ? 'bg-blue-600 text-white'
                  : animatedProgress >= stage.percent
                    ? 'bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-200'
                    : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400'
              }`}
            >
              {animatedProgress >= stage.percent ? '✓' : '○'}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
