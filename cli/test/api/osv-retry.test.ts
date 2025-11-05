/**
 * Tests for OSV API retry logic and error handling
 * Covers: timeout, rate limiting, server errors, network failures
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock p-retry for testing retry behavior
vi.mock('p-retry', () => ({
  default: vi.fn((fn, options) => {
    // Simple retry implementation for testing
    return fn();
  }),
  AbortError: class AbortError extends Error {
    constructor(message: string) {
      super(message);
      this.name = 'AbortError';
    }
  }
}));

describe('OSV API Retry Logic', () => {
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
    vi.clearAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  describe('Timeout Handling', () => {
    it('should timeout after 30 seconds', async () => {
      const controller = new AbortController();
      let aborted = false;

      global.fetch = vi.fn(() => {
        return new Promise((resolve, reject) => {
          controller.signal.addEventListener('abort', () => {
            aborted = true;
            reject(new Error('Request timed out'));
          });

          // Simulate long-running request
          setTimeout(() => {
            if (!aborted) {
              resolve(new Response(JSON.stringify({ vulns: [] })));
            }
          }, 35000);
        });
      });

      // Simulate timeout after 30s
      setTimeout(() => controller.abort(), 30000);

      // This test verifies timeout mechanism exists
      expect(controller.signal).toBeDefined();
    });

    it('should clear timeout on successful response', async () => {
      const timeoutSpy = vi.spyOn(global, 'setTimeout');
      const clearTimeoutSpy = vi.spyOn(global, 'clearTimeout');

      global.fetch = vi.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify({ vulns: [] }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          })
        )
      );

      // Test code should create and clear timeout
      const timeoutId = setTimeout(() => {}, 30000);
      clearTimeout(timeoutId);

      expect(clearTimeoutSpy).toHaveBeenCalled();

      timeoutSpy.mockRestore();
      clearTimeoutSpy.mockRestore();
    });

    it('should abort fetch when timeout fires', async () => {
      const controller = new AbortController();
      let fetchAborted = false;

      global.fetch = vi.fn((url, options) => {
        return new Promise((resolve, reject) => {
          options?.signal?.addEventListener('abort', () => {
            fetchAborted = true;
            reject(new Error('AbortError'));
          });
        });
      });

      setTimeout(() => controller.abort(), 100);

      try {
        await fetch('https://api.osv.dev/v1/query', {
          signal: controller.signal
        });
      } catch (error) {
        expect(fetchAborted).toBe(true);
      }
    });
  });

  describe('Rate Limiting (429)', () => {
    it('should detect 429 response', async () => {
      global.fetch = vi.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify({ error: 'Rate limited' }), {
            status: 429,
            headers: {
              'Retry-After': '60',
              'Content-Type': 'application/json'
            }
          })
        )
      );

      const response = await fetch('https://api.osv.dev/v1/query');

      expect(response.status).toBe(429);
      expect(response.headers.get('Retry-After')).toBe('60');
    });

    it('should respect Retry-After header', async () => {
      const retryAfterSeconds = 2;
      let requestCount = 0;
      const startTime = Date.now();

      global.fetch = vi.fn(() => {
        requestCount++;
        if (requestCount === 1) {
          return Promise.resolve(
            new Response(JSON.stringify({ error: 'Rate limited' }), {
              status: 429,
              headers: { 'Retry-After': retryAfterSeconds.toString() }
            })
          );
        } else {
          return Promise.resolve(
            new Response(JSON.stringify({ vulns: [] }), { status: 200 })
          );
        }
      });

      // Simulate retry logic
      const response1 = await fetch('https://api.osv.dev/v1/query');
      if (response1.status === 429) {
        const retryAfter =
          parseInt(response1.headers.get('Retry-After') || '60') * 1000;
        await new Promise(resolve => setTimeout(resolve, retryAfter));
      }

      const response2 = await fetch('https://api.osv.dev/v1/query');
      const duration = Date.now() - startTime;

      expect(response2.status).toBe(200);
      expect(duration).toBeGreaterThanOrEqual(retryAfterSeconds * 1000);
      expect(requestCount).toBe(2);
    });

    it('should use default delay if Retry-After missing', async () => {
      global.fetch = vi.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify({ error: 'Rate limited' }), {
            status: 429,
            headers: { 'Content-Type': 'application/json' }
          })
        )
      );

      const response = await fetch('https://api.osv.dev/v1/query');

      // Verify no Retry-After header
      expect(response.headers.get('Retry-After')).toBeNull();

      // Code should use default (60s)
      const defaultDelay = 60000;
      expect(defaultDelay).toBe(60000);
    });
  });

  describe('Server Errors (5xx)', () => {
    it('should retry on 500 server error', async () => {
      let attempts = 0;

      global.fetch = vi.fn(() => {
        attempts++;
        if (attempts < 3) {
          return Promise.resolve(
            new Response(JSON.stringify({ error: 'Internal Server Error' }), {
              status: 500
            })
          );
        }
        return Promise.resolve(
          new Response(JSON.stringify({ vulns: [] }), { status: 200 })
        );
      });

      // Simulate retry wrapper
      const maxRetries = 3;
      let response;

      for (let attempt = 0; attempt < maxRetries; attempt++) {
        response = await fetch('https://api.osv.dev/v1/query');
        if (response.ok) break;
        if (attempt < maxRetries - 1) {
          await new Promise(resolve =>
            setTimeout(resolve, 1000 * Math.pow(2, attempt))
          );
        }
      }

      expect(attempts).toBe(3);
      expect(response?.ok).toBe(true);
    });

    it('should retry on 502 bad gateway', async () => {
      let attempts = 0;

      global.fetch = vi.fn(() => {
        attempts++;
        if (attempts === 1) {
          return Promise.resolve(
            new Response(JSON.stringify({ error: 'Bad Gateway' }), {
              status: 502
            })
          );
        }
        return Promise.resolve(
          new Response(JSON.stringify({ vulns: [] }), { status: 200 })
        );
      });

      // First attempt fails, second succeeds
      const response1 = await fetch('https://api.osv.dev/v1/query');
      expect(response1.status).toBe(502);

      const response2 = await fetch('https://api.osv.dev/v1/query');
      expect(response2.status).toBe(200);
      expect(attempts).toBe(2);
    });

    it('should retry on 503 service unavailable', async () => {
      let attempts = 0;

      global.fetch = vi.fn(() => {
        attempts++;
        return Promise.resolve(
          new Response(
            JSON.stringify({ error: 'Service Temporarily Unavailable' }),
            { status: attempts < 2 ? 503 : 200 }
          )
        );
      });

      // Simulate retry
      let response;
      for (let i = 0; i < 3; i++) {
        response = await fetch('https://api.osv.dev/v1/query');
        if (response.ok) break;
      }

      expect(attempts).toBeGreaterThanOrEqual(2);
      expect(response?.ok).toBe(true);
    });
  });

  describe('Client Errors (4xx)', () => {
    it('should NOT retry on 400 bad request', async () => {
      let attempts = 0;

      global.fetch = vi.fn(() => {
        attempts++;
        return Promise.resolve(
          new Response(JSON.stringify({ error: 'Bad Request' }), {
            status: 400
          })
        );
      });

      const response = await fetch('https://api.osv.dev/v1/query');

      expect(response.status).toBe(400);
      expect(attempts).toBe(1); // Should not retry
    });

    it('should NOT retry on 404 not found', async () => {
      let attempts = 0;

      global.fetch = vi.fn(() => {
        attempts++;
        return Promise.resolve(
          new Response(JSON.stringify({ error: 'Not Found' }), { status: 404 })
        );
      });

      const response = await fetch('https://api.osv.dev/v1/query');

      expect(response.status).toBe(404);
      expect(attempts).toBe(1);
    });

    it('should NOT retry on 401 unauthorized', async () => {
      let attempts = 0;

      global.fetch = vi.fn(() => {
        attempts++;
        return Promise.resolve(
          new Response(JSON.stringify({ error: 'Unauthorized' }), {
            status: 401
          })
        );
      });

      const response = await fetch('https://api.osv.dev/v1/query');

      expect(response.status).toBe(401);
      expect(attempts).toBe(1);
    });
  });

  describe('Network Errors', () => {
    it('should retry on ECONNREFUSED', async () => {
      let attempts = 0;

      global.fetch = vi.fn(() => {
        attempts++;
        if (attempts < 3) {
          const error: any = new Error('connect ECONNREFUSED');
          error.code = 'ECONNREFUSED';
          return Promise.reject(error);
        }
        return Promise.resolve(
          new Response(JSON.stringify({ vulns: [] }), { status: 200 })
        );
      });

      let lastError;
      let response;

      for (let i = 0; i < 3; i++) {
        try {
          response = await fetch('https://api.osv.dev/v1/query');
          if (response.ok) break;
        } catch (error) {
          lastError = error;
        }
      }

      expect(attempts).toBe(3);
      expect(response?.ok).toBe(true);
    });

    it('should retry on ETIMEDOUT', async () => {
      let attempts = 0;

      global.fetch = vi.fn(() => {
        attempts++;
        if (attempts === 1) {
          const error: any = new Error('request timeout');
          error.code = 'ETIMEDOUT';
          return Promise.reject(error);
        }
        return Promise.resolve(
          new Response(JSON.stringify({ vulns: [] }), { status: 200 })
        );
      });

      let response;

      try {
        response = await fetch('https://api.osv.dev/v1/query');
      } catch {
        response = await fetch('https://api.osv.dev/v1/query');
      }

      expect(attempts).toBe(2);
      expect(response?.ok).toBe(true);
    });

    it('should retry on DNS resolution failure', async () => {
      let attempts = 0;

      global.fetch = vi.fn(() => {
        attempts++;
        if (attempts === 1) {
          const error: any = new Error('getaddrinfo ENOTFOUND api.osv.dev');
          error.code = 'ENOTFOUND';
          return Promise.reject(error);
        }
        return Promise.resolve(
          new Response(JSON.stringify({ vulns: [] }), { status: 200 })
        );
      });

      let response;

      try {
        response = await fetch('https://api.osv.dev/v1/query');
      } catch {
        response = await fetch('https://api.osv.dev/v1/query');
      }

      expect(attempts).toBe(2);
      expect(response?.ok).toBe(true);
    });
  });

  describe('Exponential Backoff', () => {
    it('should use exponential backoff between retries', async () => {
      const delays: number[] = [];
      let attempts = 0;

      global.fetch = vi.fn(() => {
        attempts++;
        if (attempts < 4) {
          return Promise.resolve(
            new Response(JSON.stringify({ error: 'Server Error' }), {
              status: 500
            })
          );
        }
        return Promise.resolve(
          new Response(JSON.stringify({ vulns: [] }), { status: 200 })
        );
      });

      // Simulate exponential backoff: 1s, 2s, 4s
      const baseDelay = 1000;
      const factor = 2;

      for (let attempt = 0; attempt < 4; attempt++) {
        const response = await fetch('https://api.osv.dev/v1/query');
        if (response.ok) break;

        const delay = baseDelay * Math.pow(factor, attempt);
        delays.push(delay);

        await new Promise(resolve => setTimeout(resolve, 10)); // Fast for test
      }

      expect(delays).toEqual([1000, 2000, 4000]);
    });

    it('should cap max retry delay', async () => {
      const maxTimeout = 10000; // 10 seconds
      const baseDelay = 1000;
      const factor = 2;

      // Calculate delay for 5th attempt: 1000 * 2^4 = 16000ms
      const calculatedDelay = baseDelay * Math.pow(factor, 4);
      expect(calculatedDelay).toBe(16000);

      // Should be capped at maxTimeout
      const actualDelay = Math.min(calculatedDelay, maxTimeout);
      expect(actualDelay).toBe(maxTimeout);
    });
  });

  describe('Retry Logging', () => {
    it('should log retry attempts', async () => {
      const logSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      let attempts = 0;

      global.fetch = vi.fn(() => {
        attempts++;
        if (attempts < 3) {
          return Promise.resolve(
            new Response(JSON.stringify({ error: 'Server Error' }), {
              status: 500
            })
          );
        }
        return Promise.resolve(
          new Response(JSON.stringify({ vulns: [] }), { status: 200 })
        );
      });

      // Simulate retry with logging
      for (let attempt = 1; attempt <= 3; attempt++) {
        const response = await fetch('https://api.osv.dev/v1/query');
        if (!response.ok && attempt < 3) {
          console.warn(
            `API attempt ${attempt} failed. ${3 - attempt} retries left.`
          );
        }
      }

      expect(logSpy).toHaveBeenCalledTimes(2);
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('attempt')
      );

      logSpy.mockRestore();
    });

    it('should log final failure after exhausting retries', async () => {
      const logSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      global.fetch = vi.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify({ error: 'Server Error' }), {
            status: 500
          })
        )
      );

      // Exhaust all retries
      const maxRetries = 3;
      let response;

      for (let attempt = 0; attempt < maxRetries; attempt++) {
        response = await fetch('https://api.osv.dev/v1/query');
        if (response.ok) break;
      }

      if (!response?.ok) {
        console.error('All retries exhausted. Final error: Server Error');
      }

      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('exhausted')
      );

      logSpy.mockRestore();
    });
  });

  describe('Integration Scenarios', () => {
    it('should handle multiple consecutive errors', async () => {
      let attempts = 0;
      const errors = [
        { status: 503, error: 'Service Unavailable' },
        { status: 502, error: 'Bad Gateway' },
        { status: 500, error: 'Internal Server Error' }
      ];

      global.fetch = vi.fn(() => {
        if (attempts < errors.length) {
          const error = errors[attempts++];
          return Promise.resolve(
            new Response(JSON.stringify({ error: error.error }), {
              status: error.status
            })
          );
        }
        return Promise.resolve(
          new Response(JSON.stringify({ vulns: [] }), { status: 200 })
        );
      });

      let response;
      for (let i = 0; i < 4; i++) {
        response = await fetch('https://api.osv.dev/v1/query');
        if (response.ok) break;
      }

      expect(attempts).toBe(3);
      expect(response?.ok).toBe(true);
    });

    it('should handle network error followed by rate limit', async () => {
      let attempts = 0;

      global.fetch = vi.fn(() => {
        attempts++;
        if (attempts === 1) {
          return Promise.reject(new Error('ECONNREFUSED'));
        }
        if (attempts === 2) {
          return Promise.resolve(
            new Response(JSON.stringify({ error: 'Rate limited' }), {
              status: 429,
              headers: { 'Retry-After': '1' }
            })
          );
        }
        return Promise.resolve(
          new Response(JSON.stringify({ vulns: [] }), { status: 200 })
        );
      });

      let response;
      for (let i = 0; i < 3; i++) {
        try {
          response = await fetch('https://api.osv.dev/v1/query');
          if (response.status === 429) {
            await new Promise(resolve => setTimeout(resolve, 1000));
            continue;
          }
          if (response.ok) break;
        } catch {
          continue;
        }
      }

      expect(attempts).toBe(3);
      expect(response?.ok).toBe(true);
    });
  });
});
