/**
 * Hook for tracking scan progress via Server-Sent Events
 * Usage:
 *   const { progress, isConnected } = useProgressTracking(jobId);
 */

import { useEffect, useState } from 'react';
import type { ProgressUpdate } from '@/types';

interface UseProgressTrackingResult {
  progress: ProgressUpdate | null;
  isConnected: boolean;
  error: string | null;
}

export function useProgressTracking(jobId: string | null): UseProgressTrackingResult {
  const [progress, setProgress] = useState<ProgressUpdate | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!jobId) {
      setIsConnected(false);
      return;
    }

    let eventSource: EventSource | null = null;
    let retries = 0;
    const maxRetries = 3;

    const connect = () => {
      try {
        const url = `/api/scan/progress?jobId=${encodeURIComponent(jobId)}`;
        eventSource = new EventSource(url);

        eventSource.onopen = () => {
          setIsConnected(true);
          setError(null);
          retries = 0;
        };

        eventSource.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            setProgress({
              stage: data.stage,
              percent: data.percent,
              depsScanned: data.depsScanned,
              totalDeps: data.totalDeps,
            });
          } catch (err) {
            // Silently ignore invalid JSON messages
          }
        };

        eventSource.onerror = (err) => {
          setIsConnected(false);

          if (eventSource?.readyState === EventSource.CLOSED) {
            // Connection was intentionally closed
            return;
          }

          // Retry with exponential backoff
          if (retries < maxRetries) {
            retries++;
            const delayMs = Math.min(1000 * Math.pow(2, retries), 10000);
            setTimeout(connect, delayMs);
          } else {
            setError('Failed to connect to progress stream after multiple attempts');
          }
        };
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to connect to progress stream');
        setIsConnected(false);
      }
    };

    connect();

    return () => {
      if (eventSource) {
        eventSource.close();
        setIsConnected(false);
      }
    };
  }, [jobId]);

  return { progress, isConnected, error };
}
