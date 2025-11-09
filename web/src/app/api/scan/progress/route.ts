/**
 * API Route: GET /api/scan/progress
 * Server-Sent Events (SSE) endpoint for real-time scan progress
 *
 * Usage:
 *   const eventSource = new EventSource('/api/scan/progress?jobId=xyz');
 *   eventSource.onmessage = (e) => {
 *     const progress = JSON.parse(e.data);
 *     // Update UI with progress
 *   };
 */

import { NextRequest, NextResponse } from 'next/server';

// Store active scan progress by job ID
// In production, this would be Redis or a database
const scanProgress = new Map<string, {
  stage: string;
  percent: number;
  message: string;
  depsScanned?: number;
  totalDeps?: number;
  timestamp: number;
  subscribers: Set<(data: string) => void>;
}>();

/**
 * Register a job for progress tracking
 */
export function registerProgressJob(jobId: string): {
  updateProgress: (stage: string, percent: number, message: string, details?: any) => void;
  completeJob: () => void;
} {
  const subscribers = new Set<(data: string) => void>();
  let cleanupTimeout: NodeJS.Timeout | null = null;

  const scheduleCleanup = () => {
    if (cleanupTimeout) clearTimeout(cleanupTimeout);
    cleanupTimeout = setTimeout(() => {
      scanProgress.delete(jobId);
      cleanupTimeout = null;
    }, 5 * 60 * 1000);
  };

  scanProgress.set(jobId, {
    stage: 'detecting-ecosystem',
    percent: 0,
    message: 'Starting scan...',
    timestamp: Date.now(),
    subscribers,
  });

  scheduleCleanup();

  return {
    updateProgress: (stage: string, percent: number, message: string, details?: any) => {
      const job = scanProgress.get(jobId);
      if (job) {
        job.stage = stage;
        job.percent = percent;
        job.message = message;
        job.depsScanned = details?.depsScanned;
        job.totalDeps = details?.totalDeps;
        job.timestamp = Date.now();

        // Send to all subscribers with properly escaped JSON
        const data = JSON.stringify({
          stage,
          percent,
          message,
          depsScanned: details?.depsScanned,
          totalDeps: details?.totalDeps,
        });

        for (const subscriber of job.subscribers) {
          subscriber(data);
        }
      }

      // Reschedule cleanup on every update
      scheduleCleanup();
    },

    completeJob: () => {
      scanProgress.delete(jobId);
      if (cleanupTimeout) {
        clearTimeout(cleanupTimeout);
        cleanupTimeout = null;
      }
    },
  };
}

/**
 * GET /api/scan/progress?jobId=xyz
 * Opens SSE connection for progress updates
 */
export function GET(request: NextRequest) {
  const jobId = request.nextUrl.searchParams.get('jobId');

  if (!jobId) {
    return NextResponse.json(
      { error: 'jobId parameter required' },
      { status: 400 }
    );
  }

  const job = scanProgress.get(jobId);
  if (!job) {
    return NextResponse.json(
      { error: 'Job not found. It may have expired.' },
      { status: 404 }
    );
  }

  // Create SSE response
  const encoder = new TextEncoder();
  let isClosed = false;

  const stream = new ReadableStream({
    start(controller) {
      // Send initial progress
      const initialData = JSON.stringify({
        stage: job.stage,
        percent: job.percent,
        message: job.message,
        depsScanned: job.depsScanned,
        totalDeps: job.totalDeps,
      });
      controller.enqueue(encoder.encode(`data: ${initialData}\n\n`));

      // Add this controller to subscribers
      const sendToController = (data: string) => {
        if (!isClosed) {
          controller.enqueue(encoder.encode(`data: ${data}\n\n`));
        }
      };

      job.subscribers.add(sendToController);

      // Cleanup on close
      const cleanup = () => {
        isClosed = true;
        job.subscribers.delete(sendToController);
      };

      // Setup cleanup timeout
      const timeout = setTimeout(cleanup, 5 * 60 * 1000);

      // Return cleanup function
      return () => {
        clearTimeout(timeout);
        cleanup();
      };
    },
  });

  return new NextResponse(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no', // Disable nginx buffering
    },
  });
}
