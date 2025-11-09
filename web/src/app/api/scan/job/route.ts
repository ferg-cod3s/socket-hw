/**
 * API Route: GET /api/scan/job?jobId=xyz
 * Retrieves the current status and results of a scan job
 */

import { NextRequest, NextResponse } from 'next/server';
import { getJob } from '@/lib/scanJobQueue';

export async function GET(request: NextRequest) {
  const jobId = request.nextUrl.searchParams.get('jobId');

  if (!jobId) {
    return NextResponse.json(
      { error: 'jobId parameter required' },
      { status: 400 }
    );
  }

  const job = getJob(jobId);

  if (!job) {
    return NextResponse.json(
      { error: 'Job not found. It may have expired.' },
      { status: 404 }
    );
  }

  // Return the job status and results
  return NextResponse.json({
    jobId,
    status: job.status,
    progress: job.progress,
    createdAt: job.createdAt,
    startedAt: job.startedAt,
    completedAt: job.completedAt,
    result: job.status === 'completed' ? job.result : null,
    error: job.status === 'failed' ? job.error : null,
  });
}
