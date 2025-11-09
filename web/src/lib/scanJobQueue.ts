/**
 * Background job queue for managing async scans
 * Handles queuing, execution, and progress tracking for vulnerability scans
 */

import { writeFile, mkdir, rm } from 'fs/promises';
import { join, dirname } from 'path';
import { tmpdir } from 'os';
import { randomBytes } from 'crypto';
import { scanPath } from './scanner';
import { progressTracker } from '@cli/index';
import { registerProgressJob } from '@/app/api/scan/progress/route';
import type { ScanResult } from './scanner';

export interface ScanJob {
  jobId: string;
  status: 'queued' | 'processing' | 'completed' | 'failed';
  progress: {
    stage: string;
    percent: number;
    message: string;
    depsScanned?: number;
    totalDeps?: number;
  };
  result?: ScanResult;
  error?: string;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  tempPath?: string;
}

// In-memory job store (in production, use Redis or database)
const jobStore = new Map<string, ScanJob>();

// Cleanup completed jobs after 10 minutes
const CLEANUP_TIMEOUT = 10 * 60 * 1000;

/**
 * Create a new scan job and queue it
 */
export function createScanJob(): string {
  const jobId = `scan-${randomBytes(16).toString('hex')}`;

  const job: ScanJob = {
    jobId,
    status: 'queued',
    progress: {
      stage: 'queued',
      percent: 0,
      message: 'Waiting to start scan...',
    },
    createdAt: Date.now(),
  };

  jobStore.set(jobId, job);

  // Schedule cleanup
  setTimeout(() => {
    jobStore.delete(jobId);
  }, CLEANUP_TIMEOUT);

  return jobId;
}

/**
 * Get a job by ID
 */
export function getJob(jobId: string): ScanJob | undefined {
  return jobStore.get(jobId);
}

interface ProgressDetails {
  depsScanned?: number;
  totalDeps?: number;
}

/**
 * Update job progress
 */
function updateJobProgress(
  jobId: string,
  stage: string,
  percent: number,
  message: string,
  details?: ProgressDetails
) {
  const job = jobStore.get(jobId);
  if (job) {
    job.progress = {
      stage,
      percent,
      message,
      depsScanned: details?.depsScanned,
      totalDeps: details?.totalDeps,
    };
  }
}

/**
 * Process a file upload scan in the background
 */
export async function processScanFile(
  jobId: string,
  file: File
): Promise<void> {
  const job = jobStore.get(jobId);
  if (!job) throw new Error('Job not found');

  let tempPath: string | null = null;

  try {
    // Update job status
    job.status = 'processing';
    job.startedAt = Date.now();

    // Register progress tracking
    const { updateProgress, completeJob } = registerProgressJob(jobId);

    // Save file to temp directory
    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);
    const tempFileName = `${randomBytes(16).toString('hex')}-${file.name}`;
    tempPath = join(tmpdir(), tempFileName);
    job.tempPath = tempPath;

    await writeFile(tempPath, buffer);

    // Update progress: preparing
    updateProgress('detecting-ecosystem', 5, 'Detecting ecosystem and dependencies...');
    updateJobProgress(jobId, 'detecting-ecosystem', 5, 'Detecting ecosystem and dependencies...');

    // Subscribe to progress events from the scanner
    const unsubscribe = progressTracker.subscribe((event) => {
      updateProgress(event.stage, event.percent, event.message, {
        depsScanned: event.depsScanned,
        totalDeps: event.totalDeps,
      });
      updateJobProgress(jobId, event.stage, event.percent, event.message, {
        depsScanned: event.depsScanned,
        totalDeps: event.totalDeps,
      });
    });

    try {
      // Run scan
      const result = await scanPath(tempPath, {
        includeDev: true,
        validateLock: false,
      });

      // Complete the job in progress tracking
      completeJob();

      // Store result in job
      job.result = result;
      job.status = 'completed';
      job.completedAt = Date.now();
    } finally {
      unsubscribe();
    }
  } catch (error) {
    // Clean up temp path on error
    if (tempPath) {
      await rm(tempPath, { recursive: true, force: true }).catch((err) => {
        console.error('[ScanJob] Failed to clean up temp file:', err);
      });
    }

    console.error('[ScanJob] Scan error:', error);
    job.status = 'failed';
    job.error = error instanceof Error ? error.message : 'Unknown error';
    job.completedAt = Date.now();

    throw error;
  }
}

/**
 * Process a path scan in the background
 */
export async function processScanPath(
  jobId: string,
  _scanPathParam: string,
  resolvedPath: string
): Promise<void> {
  const job = jobStore.get(jobId);
  if (!job) throw new Error('Job not found');

  try {
    // Update job status
    job.status = 'processing';
    job.startedAt = Date.now();

    // Register progress tracking
    const { updateProgress, completeJob } = registerProgressJob(jobId);

    // Update progress: preparing
    updateProgress('detecting-ecosystem', 5, 'Detecting ecosystem and dependencies...');
    updateJobProgress(jobId, 'detecting-ecosystem', 5, 'Detecting ecosystem and dependencies...');

    // Subscribe to progress events from the scanner
    const unsubscribe = progressTracker.subscribe((event) => {
      updateProgress(event.stage, event.percent, event.message, {
        depsScanned: event.depsScanned,
        totalDeps: event.totalDeps,
      });
      updateJobProgress(jobId, event.stage, event.percent, event.message, {
        depsScanned: event.depsScanned,
        totalDeps: event.totalDeps,
      });
    });

    try {
      // Run scan
      const result = await scanPath(resolvedPath, {
        includeDev: true,
        validateLock: false,
      });

      // Complete the job in progress tracking
      completeJob();

      // Store result in job
      job.result = result;
      job.status = 'completed';
      job.completedAt = Date.now();
    } finally {
      unsubscribe();
    }
  } catch (error) {
    console.error('[ScanJob] Scan error:', error);
    job.status = 'failed';
    job.error = error instanceof Error ? error.message : 'Unknown error';
    job.completedAt = Date.now();

    throw error;
  }
}

/**
 * Process a directory upload scan in the background
 */
export async function processScanDirectory(
  jobId: string,
  files: File[]
): Promise<void> {
  const job = jobStore.get(jobId);
  if (!job) throw new Error('Job not found');

  let tempPath: string | null = null;

  try {
    // Update job status
    job.status = 'processing';
    job.startedAt = Date.now();

    // Create temp directory
    const tempDirName = `scan-${randomBytes(16).toString('hex')}`;
    tempPath = join(tmpdir(), tempDirName);
    job.tempPath = tempPath;

    await mkdir(tempPath, { recursive: true });

    // Register progress tracking
    const { updateProgress, completeJob } = registerProgressJob(jobId);

    // Update initial progress
    updateProgress('uploading-files', 10, `Uploading ${files.length} files...`);
    updateJobProgress(jobId, 'uploading-files', 10, `Uploading ${files.length} files...`, {
      depsScanned: 0,
      totalDeps: files.length,
    });

    // Prepare file write operations
    interface FileOperation {
      file: File;
      filePath: string;
      fileDir: string;
    }
    const fileOps: FileOperation[] = [];
    let uploadedFolderName: string | null = null;

    for (const file of files) {
      const fileWithPath = file as File & { webkitRelativePath?: string };
      const relativePath = fileWithPath.webkitRelativePath || file.name;

      // Extract the root folder name from the first file
      if (!uploadedFolderName && relativePath.includes('/')) {
        uploadedFolderName = relativePath.split('/')[0];
      }

      const filePath = join(tempPath, relativePath);
      const fileDir = dirname(filePath);
      fileOps.push({ file, filePath, fileDir });
    }

    // Create all directories in parallel
    const uniqueDirs = [...new Set(fileOps.map((op) => op.fileDir))];
    await Promise.all(uniqueDirs.map((dir) => mkdir(dir, { recursive: true })));

    // Write files in parallel batches
    const MAX_CONCURRENT_WRITES = 10;
    for (let i = 0; i < fileOps.length; i += MAX_CONCURRENT_WRITES) {
      const batch = fileOps.slice(i, i + MAX_CONCURRENT_WRITES);
      await Promise.all(
        batch.map(async (op) => {
          const bytes = await op.file.arrayBuffer();
          const buffer = Buffer.from(bytes);
          return writeFile(op.filePath, buffer);
        })
      );
    }

    // Determine the actual directory to scan
    const scanDir = uploadedFolderName ? join(tempPath, uploadedFolderName) : tempPath;

    // Update progress: detecting
    updateProgress('detecting-ecosystem', 20, 'Detecting ecosystem and dependencies...');
    updateJobProgress(jobId, 'detecting-ecosystem', 20, 'Detecting ecosystem and dependencies...');

    // Subscribe to progress events from the scanner
    const unsubscribe = progressTracker.subscribe((event) => {
      updateProgress(event.stage, event.percent, event.message, {
        depsScanned: event.depsScanned,
        totalDeps: event.totalDeps,
      });
      updateJobProgress(jobId, event.stage, event.percent, event.message, {
        depsScanned: event.depsScanned,
        totalDeps: event.totalDeps,
      });
    });

    try {
      // Run scan
      const result = await scanPath(scanDir, {
        includeDev: true,
        validateLock: false,
      });

      // Complete the job in progress tracking
      completeJob();

      // Store result in job
      job.result = result;
      job.status = 'completed';
      job.completedAt = Date.now();
    } finally {
      unsubscribe();
    }
  } catch (error) {
    // Clean up temp directory on error
    if (tempPath) {
      await rm(tempPath, { recursive: true, force: true }).catch((err) => {
        console.error('[ScanJob] Failed to clean up temp directory:', err);
      });
    }

    console.error('[ScanJob] Scan error:', error);
    job.status = 'failed';
    job.error = error instanceof Error ? error.message : 'Unknown error';
    job.completedAt = Date.now();

    throw error;
  }
}
