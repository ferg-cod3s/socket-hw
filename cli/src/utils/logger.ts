import pino from 'pino';

/**
 * Create a logger instance with appropriate configuration
 * - Pretty output in development (CLI only)
 * - JSON output in production/CI or when running in Next.js
 * - Redacts sensitive fields (tokens, keys)
 *
 * Note: pino-pretty uses worker threads which don't work with Next.js bundling,
 * so we disable it when running in a Next.js environment.
 */
export function createLogger(options?: { level?: string; pretty?: boolean }) {
  const isDevelopment = process.env.NODE_ENV !== 'production';
  const isNextJs = typeof process.env.NEXT_RUNTIME !== 'undefined' ||
                   typeof (globalThis as any).__NEXT_DATA__ !== 'undefined';
  const level = options?.level || process.env.LOG_LEVEL || (isDevelopment ? 'debug' : 'info');

  const logger = pino({
    level,
    redact: {
      paths: ['token', 'password', 'authorization', 'auth', 'key', 'secret', 'apiKey'],
      censor: '[REDACTED]',
    },
    // Only use pino-pretty transport in development AND not in Next.js environment
    // (worker threads don't work with Next.js bundler path resolution)
    ...(options?.pretty !== false && isDevelopment && !isNextJs
      ? {
          transport: {
            target: 'pino-pretty',
            options: {
              colorize: true,
              ignore: 'pid,hostname',
              translateTime: 'HH:MM:ss.l',
            },
          },
        }
      : {}),
  });

  return logger;
}

// Export singleton logger instance
export const logger = createLogger();

