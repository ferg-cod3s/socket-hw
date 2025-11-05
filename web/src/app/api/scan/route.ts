/**
 * API Route: POST /api/scan
 * Handles lockfile upload and vulnerability scanning
 */

import { NextRequest, NextResponse } from 'next/server';
import { writeFile, unlink, mkdir, rm } from 'fs/promises';
import { join, dirname } from 'path';
import { tmpdir } from 'os';
import { randomBytes } from 'crypto';
import { scanPath } from '@/lib/scanner';
import { getSupportedFilenames } from '@cli/index';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Get allowed files from provider system
const ALLOWED_FILES = Array.from(getSupportedFilenames());

// Max file size: 10MB
const MAX_FILE_SIZE = 10 * 1024 * 1024;

export async function POST(request: NextRequest) {
  let tempPath: string | null = null;
  let isDirectory = false;

  try {
    // 1. Parse multipart form data
    const formData = await request.formData();

    // Get all files from the form data
    const files: File[] = [];
    for (const [key, value] of formData.entries()) {
      if (key === 'lockfile' && value instanceof File) {
        files.push(value);
      }
    }

    if (files.length === 0) {
      return NextResponse.json(
        { error: 'No file provided', message: 'Please upload a lockfile or folder' },
        { status: 400 }
      );
    }

    // Check if this is a directory upload (multiple files with webkitRelativePath)
    const firstFile = files[0] as { webkitRelativePath?: string };
    const hasRelativePath = firstFile.webkitRelativePath && firstFile.webkitRelativePath.length > 0;
    isDirectory = Boolean(files.length > 1 || hasRelativePath);


    if (isDirectory) {
      // Handle directory upload
      const tempDirName = `scan-${randomBytes(16).toString('hex')}`;
      tempPath = join(tmpdir(), tempDirName);

      await mkdir(tempPath, { recursive: true });

      // Write all files maintaining directory structure
      let uploadedFolderName: string | null = null;
      for (const file of files) {
        const relativePath = (file as any).webkitRelativePath || file.name;

        // Extract the root folder name from the first file
        if (!uploadedFolderName && relativePath.includes('/')) {
          uploadedFolderName = relativePath.split('/')[0];
        }

        const filePath = join(tempPath, relativePath);

        // Create parent directories if needed
        const fileDir = dirname(filePath);
        await mkdir(fileDir, { recursive: true });

        const bytes = await file.arrayBuffer();
        const buffer = Buffer.from(bytes);
        await writeFile(filePath, buffer);
      }

      // Determine the actual directory to scan
      // If files were uploaded with a root folder, scan that folder
      // Otherwise scan the temp directory root
      const scanDir = uploadedFolderName
        ? join(tempPath, uploadedFolderName)
        : tempPath;

      // Run scan on the directory
      const startTime = Date.now();
      const result = await scanPath(scanDir, {
        includeDev: true,
        validateLock: false
      });
      const scanDuration = Date.now() - startTime;

      // Clean up temp directory
      await rm(tempPath, { recursive: true, force: true });
      tempPath = null;

      // Return results
      return NextResponse.json({
        success: true,
        isDirectory: true,
        fileCount: files.length,
        scanDuration,
        results: result
      });

    } else {
      // Handle single file upload
      const file = files[0];

      // 2. Validate file type using provider system
      if (!ALLOWED_FILES.includes(file.name)) {
        return NextResponse.json(
          {
            error: 'Unsupported file type',
            message: `File type '${file.name}' is not supported. Supported files: ${ALLOWED_FILES.join(', ')}`
          },
          { status: 400 }
        );
      }

      // 3. Validate file size
      if (file.size > MAX_FILE_SIZE) {
        return NextResponse.json(
          {
            error: 'File too large',
            message: `File size ${(file.size / 1024 / 1024).toFixed(2)}MB exceeds maximum of ${MAX_FILE_SIZE / 1024 / 1024}MB`
          },
          { status: 400 }
        );
      }

      // 4. Save file to temp directory
      const bytes = await file.arrayBuffer();
      const buffer = Buffer.from(bytes);

      const tempFileName = `${randomBytes(16).toString('hex')}-${file.name}`;
      tempPath = join(tmpdir(), tempFileName);

      await writeFile(tempPath, buffer);

      // 5. Run scan
      const startTime = Date.now();
      const result = await scanPath(tempPath, {
        includeDev: true,
        validateLock: false
      });
      const scanDuration = Date.now() - startTime;

      // 6. Clean up temp file
      await unlink(tempPath);
      tempPath = null;

      // 7. Return results
      return NextResponse.json({
        success: true,
        isDirectory: false,
        fileName: file.name,
        fileSize: file.size,
        scanDuration,
        results: result
      });
    }

  } catch (error) {
    // Clean up temp path on error
    if (tempPath) {
      if (isDirectory) {
        await rm(tempPath, { recursive: true, force: true }).catch((err) => {
          console.error('[API] Failed to clean up temp directory:', err);
        });
      } else {
        await unlink(tempPath).catch((err) => {
          console.error('[API] Failed to clean up temp file:', err);
        });
      }
    }

    console.error('[API] Scan error:', error);

    // Return error response
    return NextResponse.json(
      {
        error: 'Scan failed',
        message: error instanceof Error ? error.message : 'Unknown error occurred'
      },
      { status: 500 }
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
