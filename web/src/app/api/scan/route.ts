/**
 * API Route: POST /api/scan
 * Handles both lockfile upload and local filesystem path scanning
 * Returns immediately with a jobId for async processing
 * Progress tracked via /api/scan/progress?jobId=xyz
 * Results available via /api/scan/job?jobId=xyz after completion
 */

import { NextRequest, NextResponse } from 'next/server';
import { stat } from 'fs/promises';
import { resolve } from 'path';
import {
  createScanJob,
  processScanFile,
  processScanPath,
  processScanDirectory,
} from '@/lib/scanJobQueue';
import { getSupportedFilenames } from '@cli/index';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Get allowed files from provider system
const ALLOWED_FILES = Array.from(getSupportedFilenames());

// Max file size: 50MB (increased to handle large projects)
const MAX_FILE_SIZE = 50 * 1024 * 1024;


export async function POST(request: NextRequest) {
  // Create a new scan job (returns immediately)
  const jobId = createScanJob();

  try {
    // Parse multipart form data
    const formData = await request.formData();

    // Check for path-based scanning first
    const scanPathParam = formData.get('path');
    if (scanPathParam && typeof scanPathParam === 'string') {
      // Resolve the path (handles ~, relative paths, etc.)
      const resolvedPath = resolve(
        scanPathParam.replace('~', process.env.HOME || '/root')
      );

      // Validate path exists and is accessible
      try {
        await stat(resolvedPath);
      } catch (error) {
        const fsError = error as NodeJS.ErrnoException;
        if (fsError.code === 'ENOENT') {
          return NextResponse.json(
            {
              error: 'Path not found',
              message: `The path "${scanPathParam}" does not exist. Please check the path and try again.`,
            },
            { status: 400 }
          );
        } else if (fsError.code === 'EACCES') {
          return NextResponse.json(
            {
              error: 'Access denied',
              message: `Permission denied accessing "${scanPathParam}". Check file permissions.`,
            },
            { status: 403 }
          );
        }
        throw error;
      }

      // Start async scan in background
      processScanPath(jobId, scanPathParam, resolvedPath).catch((err) => {
        console.error(`[API] Background scan failed for job ${jobId}:`, err);
      });

      // Return immediately with jobId
      return NextResponse.json({
        jobId,
        message: 'Scan queued. Track progress with this jobId.',
      });
    }

    // Get all files from the form data (file upload mode)
    const files: File[] = [];
    for (const [key, value] of formData.entries()) {
      if (key === 'lockfile' && value instanceof File) {
        files.push(value);
      }
    }

    if (files.length === 0) {
      return NextResponse.json(
        {
          error: 'No input provided',
          message: 'Please upload files/folder or provide a path',
        },
        { status: 400 }
      );
    }

    // Check if this is a directory upload (multiple files with webkitRelativePath)
    const firstFile = files[0] as { webkitRelativePath?: string };
    const hasRelativePath =
      firstFile.webkitRelativePath &&
      firstFile.webkitRelativePath.length > 0;
    const isDirectory = Boolean(files.length > 1 || hasRelativePath);

    if (isDirectory) {
      // Start async directory scan in background
      processScanDirectory(jobId, files).catch((err) => {
        console.error(`[API] Background directory scan failed for job ${jobId}:`, err);
      });

      // Return immediately with jobId
      return NextResponse.json({
        jobId,
        fileCount: files.length,
        message: 'Directory scan queued. Track progress with this jobId.',
      });
    } else {
      // Single file upload
      const file = files[0];

      // Validate file type using provider system
      if (!ALLOWED_FILES.includes(file.name)) {
        return NextResponse.json(
          {
            error: 'Unsupported file type',
            message: `File type '${file.name}' is not supported. Supported files: ${ALLOWED_FILES.join(
              ', '
            )}`,
          },
          { status: 400 }
        );
      }

      // Validate file size
      if (file.size > MAX_FILE_SIZE) {
        return NextResponse.json(
          {
            error: 'File too large',
            message: `File size ${(file.size / 1024 / 1024).toFixed(
              2
            )}MB exceeds maximum of ${MAX_FILE_SIZE / 1024 / 1024}MB`,
          },
          { status: 400 }
        );
      }

      // Start async file scan in background
      processScanFile(jobId, file).catch((err) => {
        console.error(`[API] Background file scan failed for job ${jobId}:`, err);
      });

      // Return immediately with jobId
      return NextResponse.json({
        jobId,
        fileName: file.name,
        fileSize: file.size,
        message: 'Scan queued. Track progress with this jobId.',
      });
    }
  } catch (error) {
    console.error('[API] Request parsing error:', error);

    return NextResponse.json(
      {
        error: 'Failed to process request',
        message:
          error instanceof Error ? error.message : 'Unknown error occurred',
      },
      { status: 400 }
    );
  }
}

// Health check endpoint
export async function GET() {
  return NextResponse.json({
    status: 'ok',
    service: 'vulnerability-scanner',
    supportedFiles: ALLOWED_FILES,
    maxFileSize: `${MAX_FILE_SIZE / 1024 / 1024}MB`
  });
}
