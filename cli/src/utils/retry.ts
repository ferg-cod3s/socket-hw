import pRetry, { AbortError, type RetryContext } from 'p-retry';
import { logger } from './logger.js';

/**
 * Retry configuration for API calls
 */
export interface RetryOptions {
  /** Maximum number of retries (default: 3) */
  retries?: number;
  /** Minimum delay in milliseconds (default: 1000) */
  minTimeout?: number;
  /** Maximum delay in milliseconds (default: 30000) */
  maxTimeout?: number;
  /** Request timeout in milliseconds (default: 30000) */
  timeout?: number;
  /** Whether to use exponential backoff (default: true) */
  exponentialBackoff?: boolean;
}

const DEFAULT_OPTIONS: Required<RetryOptions & { exponentialBackoff: boolean }> = {
  retries: 3,
  minTimeout: 1000,
  maxTimeout: 30000,
  timeout: 30000,
  exponentialBackoff: true,
};

/**
 * Determines if an error should trigger a retry
 */
function isRetryableError(error: any): boolean {
  // Network errors (ECONNREFUSED, ETIMEDOUT, etc.)
  if (error?.code === 'ECONNREFUSED' || error?.code === 'ETIMEDOUT') {
    return true;
  }

  // DNS errors
  if (error?.name === 'TypeError' && error?.message?.includes('fetch')) {
    return true;
  }

  // Timeout errors
  if (error?.name === 'AbortError' || error?.message?.includes('timeout')) {
    return true;
  }

  // HTTP errors that should be retried (check error message)
  if (error?.message) {
    const statusMatch = error.message.match(/HTTP (\d+):/);
    if (statusMatch) {
      const status = parseInt(statusMatch[1], 10);
      // Retry on 429 (rate limit), 500, 502, 503, 504
      if ([429, 500, 502, 503, 504].includes(status)) {
        return true;
      }
      // Don't retry on client errors (4xx except 429)
      if (status >= 400 && status < 500 && status !== 429) {
        return false;
      }
    }
  }

  return false;
}

/**
 * Wraps a fetch call with retry logic, timeout, and exponential backoff
 */
export async function fetchWithRetry(
  url: string,
  init: RequestInit = {},
  options: RetryOptions = {}
): Promise<Response> {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  return pRetry(
    async () => {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), opts.timeout);

      try {
        const response = await fetch(url, {
          ...init,
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        // Check for Retry-After header (429 rate limiting)
        let retryDelay: number | null = null;
        if (response.status === 429) {
          const retryAfter = response.headers.get('Retry-After');
          if (retryAfter) {
            const seconds = parseInt(retryAfter, 10);
            if (!isNaN(seconds) && seconds > 0) {
              retryDelay = Math.min(seconds * 1000, opts.maxTimeout);
            }
          }
        }

        // If response is not ok, check if it's retryable
        if (!response.ok) {
          const status = response.status;
          const isRetryable = [429, 500, 502, 503, 504].includes(status);

          if (isRetryable) {
            // Retryable error - throw to trigger retry
            const error = new Error(`HTTP ${status}: ${response.statusText}`);
            (error as any).status = status;
            (error as any).retryDelay = retryDelay;
            (error as any).isRateLimit = status === 429;
            throw error;
          } else {
            // Non-retryable error - throw AbortError to stop retries
            throw new AbortError(`HTTP ${status}: ${response.statusText}`);
          }
        }

        return response;
      } catch (error: any) {
        clearTimeout(timeoutId);

        // Check if error is retryable
        if (!isRetryableError(error)) {
          throw new AbortError(error.message || 'Non-retryable error');
        }

        // If we have a retry delay from Retry-After header, wait before retrying
        if (error.retryDelay && error.retryDelay > 0) {
          await new Promise((resolve) => setTimeout(resolve, error.retryDelay));
        }

        throw error;
      }
    },
    {
      retries: opts.retries,
      minTimeout: opts.minTimeout,
      maxTimeout: opts.maxTimeout,
      onFailedAttempt: (context: RetryContext) => {
        // Log retry attempts for debugging
        const errorMessage = context.error instanceof Error ? context.error.message : String(context.error);
        const isRateLimit = (context.error as any).isRateLimit;
        logger.warn(
          {
            attempt: context.attemptNumber,
            total: context.attemptNumber + context.retriesLeft,
            isRateLimit,
          },
          `API request failed: ${errorMessage}`
        );
      },
    }
  );
}

/**
 * Check if a JSON response body contains GraphQL rate limit errors
 */
export function isGraphQLRateLimitError(data: any): boolean {
  if (!data || typeof data !== 'object') return false;

  if (Array.isArray(data.errors)) {
    return data.errors.some((error: any) =>
      error?.extensions?.code === 'RATE_LIMITED' ||
      error?.type === 'RATE_LIMIT' ||
      error?.message?.includes('rate limit') ||
      error?.message?.includes('Rate limit')
    );
  }

  return false;
}

