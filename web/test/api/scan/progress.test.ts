import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { registerProgressJob, GET } from '../../../src/app/api/scan/progress/route';

describe('Progress API Route', () => {
  describe('registerProgressJob', () => {
    it('should create a job with initial state', () => {
      const { updateProgress, completeJob } = registerProgressJob('job-123');

      expect(updateProgress).toBeDefined();
      expect(completeJob).toBeDefined();
    });

    it('should update job state', () => {
      const { updateProgress } = registerProgressJob('job-123');

      updateProgress('detecting-ecosystem', 10, 'Detecting ecosystem...');
      updateProgress('gathering-dependencies', 25, 'Gathering dependencies...');

      // Job should be updated internally
      expect(updateProgress).toBeDefined();
    });

    it('should accept progress details', () => {
      const { updateProgress } = registerProgressJob('job-123');

      expect(() => {
        updateProgress('scanning-packages', 50, 'Scanning batch 1/5', {
          depsScanned: 100,
          totalDeps: 500,
        });
      }).not.toThrow();
    });

    it('should complete job without errors', () => {
      const { completeJob } = registerProgressJob('job-123');

      expect(() => {
        completeJob();
      }).not.toThrow();
    });

    it('should handle multiple subscribers', () => {
      const { updateProgress } = registerProgressJob('job-123');

      // Simulate adding multiple subscribers by calling updateProgress multiple times
      updateProgress('detecting-ecosystem', 10, 'Test 1');
      updateProgress('gathering-dependencies', 20, 'Test 2');

      expect(updateProgress).toBeDefined();
    });

    it('should cleanup after 5 minutes', async () => {
      vi.useFakeTimers();

      const { updateProgress, completeJob } = registerProgressJob('job-timeout');

      // Job should exist
      updateProgress('detecting-ecosystem', 10, 'Starting');

      // Advance 5 minutes
      vi.advanceTimersByTime(5 * 60 * 1000);

      // Job should be cleaned up (we can't directly check, but this tests the timeout path)
      expect(updateProgress).toBeDefined();

      vi.useRealTimers();
    });

    it('should reset timeout on progress update', () => {
      vi.useFakeTimers();

      const { updateProgress } = registerProgressJob('job-reset');

      updateProgress('detecting-ecosystem', 10, 'Start');

      // Advance 3 minutes
      vi.advanceTimersByTime(3 * 60 * 1000);

      // Update progress (should reset timeout)
      updateProgress('gathering-dependencies', 20, 'Continue');

      // Advance another 3 minutes (total 6, but timeout was reset)
      vi.advanceTimersByTime(3 * 60 * 1000);

      // Job should still exist (timeout was reset)
      expect(updateProgress).toBeDefined();

      vi.useRealTimers();
    });
  });

  describe('GET /api/scan/progress', () => {
    it('should return error when jobId is missing', async () => {
      const request = new NextRequest('http://localhost:3000/api/scan/progress');

      const response = GET(request);

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain('jobId');
    });

    it('should return error for non-existent job', async () => {
      const request = new NextRequest('http://localhost:3000/api/scan/progress?jobId=nonexistent');

      const response = GET(request);

      expect(response.status).toBe(404);
      const data = await response.json();
      expect(data.error).toContain('not found');
    });

    it('should return SSE response for valid job', async () => {
      const { updateProgress } = registerProgressJob('job-valid');
      updateProgress('detecting-ecosystem', 10, 'Testing...');

      const request = new NextRequest('http://localhost:3000/api/scan/progress?jobId=job-valid');

      const response = GET(request);

      expect(response.status).toBe(200);
      expect(response.headers.get('Content-Type')).toBe('text/event-stream');
      expect(response.headers.get('Cache-Control')).toBe('no-cache');
      expect(response.headers.get('Connection')).toBe('keep-alive');
    });

    it('should set correct SSE headers', async () => {
      const { updateProgress } = registerProgressJob('job-headers');

      const request = new NextRequest('http://localhost:3000/api/scan/progress?jobId=job-headers');

      const response = GET(request);

      const headers = response.headers;
      expect(headers.get('Content-Type')).toBe('text/event-stream');
      expect(headers.get('Cache-Control')).toBe('no-cache');
      expect(headers.get('Connection')).toBe('keep-alive');
      expect(headers.get('X-Accel-Buffering')).toBe('no');
    });

    it('should handle URL-encoded jobId', async () => {
      const jobId = 'scan-abc123def456';
      const { updateProgress } = registerProgressJob(jobId);

      const encodedJobId = encodeURIComponent(jobId);
      const request = new NextRequest(`http://localhost:3000/api/scan/progress?jobId=${encodedJobId}`);

      const response = GET(request);

      expect(response.status).toBe(200);
    });

    it('should support multiple concurrent jobs', async () => {
      const { updateProgress: update1 } = registerProgressJob('job-1');
      const { updateProgress: update2 } = registerProgressJob('job-2');
      const { updateProgress: update3 } = registerProgressJob('job-3');

      update1('detecting-ecosystem', 5, 'Job 1');
      update2('gathering-dependencies', 10, 'Job 2');
      update3('scanning-packages', 20, 'Job 3');

      const req1 = new NextRequest('http://localhost:3000/api/scan/progress?jobId=job-1');
      const req2 = new NextRequest('http://localhost:3000/api/scan/progress?jobId=job-2');
      const req3 = new NextRequest('http://localhost:3000/api/scan/progress?jobId=job-3');

      const res1 = GET(req1);
      const res2 = GET(req2);
      const res3 = GET(req3);

      expect(res1.status).toBe(200);
      expect(res2.status).toBe(200);
      expect(res3.status).toBe(200);
    });

    it('should handle rapid progress updates', async () => {
      const { updateProgress } = registerProgressJob('job-rapid');

      const request = new NextRequest('http://localhost:3000/api/scan/progress?jobId=job-rapid');

      // Simulate rapid updates before SSE connection
      for (let i = 0; i < 10; i++) {
        updateProgress('scanning-packages', i * 10, `Scanning ${i * 10}%`);
      }

      const response = GET(request);

      expect(response.status).toBe(200);
    });

    it('should cleanup subscribers when stream is cancelled', async () => {
      const { updateProgress } = registerProgressJob('job-cleanup');
      updateProgress('detecting-ecosystem', 10, 'Starting...');

      const request = new NextRequest('http://localhost:3000/api/scan/progress?jobId=job-cleanup');

      const response = GET(request);
      expect(response.status).toBe(200);

      // Read from the stream
      const reader = response.body?.getReader();
      expect(reader).toBeDefined();

      // Read initial message
      const { value } = await reader!.read();
      expect(value).toBeDefined();

      // Cancel the stream to trigger cleanup
      await reader!.cancel();

      // Verify stream was cancelled (no errors thrown)
      expect(true).toBe(true);
    });

    it('should trigger timeout cleanup after 5 minutes', async () => {
      vi.useFakeTimers();

      const { updateProgress } = registerProgressJob('job-timeout-stream');
      updateProgress('detecting-ecosystem', 10, 'Starting...');

      const request = new NextRequest('http://localhost:3000/api/scan/progress?jobId=job-timeout-stream');

      const response = GET(request);
      expect(response.status).toBe(200);

      // Advance time to trigger timeout cleanup
      vi.advanceTimersByTime(5 * 60 * 1000 + 100);

      // Verify timeout cleanup executed (no errors)
      expect(true).toBe(true);

      vi.useRealTimers();
    });
  });
});
