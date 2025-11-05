import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

describe('utils/logger', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // Reset environment
    delete process.env.NODE_ENV;
    delete process.env.LOG_LEVEL;
    delete process.env.NEXT_RUNTIME;

    // Clear module cache to get fresh logger instance
    vi.resetModules();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe('createLogger', () => {
    it('creates logger with default debug level in development', async () => {
      process.env.NODE_ENV = 'development';

      const { createLogger } = await import('../../src/utils/logger.js');
      const logger = createLogger();

      expect(logger).toBeDefined();
      expect(logger.level).toBe('debug');
    });

    it('creates logger with info level in production', async () => {
      process.env.NODE_ENV = 'production';

      const { createLogger } = await import('../../src/utils/logger.js');
      const logger = createLogger();

      expect(logger).toBeDefined();
      expect(logger.level).toBe('info');
    });

    it('respects LOG_LEVEL environment variable', async () => {
      process.env.LOG_LEVEL = 'warn';

      const { createLogger } = await import('../../src/utils/logger.js');
      const logger = createLogger();

      expect(logger.level).toBe('warn');
    });

    it('accepts custom level option', async () => {
      const { createLogger } = await import('../../src/utils/logger.js');
      const logger = createLogger({ level: 'error' });

      expect(logger.level).toBe('error');
    });

    it('prioritizes options.level over environment', async () => {
      process.env.LOG_LEVEL = 'debug';

      const { createLogger } = await import('../../src/utils/logger.js');
      const logger = createLogger({ level: 'error' });

      expect(logger.level).toBe('error');
    });

    it('creates logger without errors', async () => {
      const { createLogger } = await import('../../src/utils/logger.js');

      expect(() => createLogger()).not.toThrow();
    });

    it('supports all standard log levels', async () => {
      const { createLogger } = await import('../../src/utils/logger.js');

      const levels = ['fatal', 'error', 'warn', 'info', 'debug', 'trace'];

      for (const level of levels) {
        const logger = createLogger({ level });
        expect(logger.level).toBe(level);
        expect(typeof logger[level]).toBe('function');
      }
    });

    it('disables pretty formatting in production', async () => {
      process.env.NODE_ENV = 'production';

      const { createLogger } = await import('../../src/utils/logger.js');
      const logger = createLogger();

      // Logger should be created without errors in production
      expect(logger).toBeDefined();
      expect(logger.level).toBe('info');
    });

    it('handles development environment', async () => {
      process.env.NODE_ENV = 'development';

      const { createLogger } = await import('../../src/utils/logger.js');
      const logger = createLogger();

      // Logger should work in development
      expect(logger).toBeDefined();
    });

    it('can disable pretty formatting via option', async () => {
      process.env.NODE_ENV = 'development';

      const { createLogger } = await import('../../src/utils/logger.js');
      const logger = createLogger({ pretty: false });

      // Logger should be created successfully
      expect(logger).toBeDefined();
    });
  });

  describe('singleton logger instance', () => {
    it('exports default logger instance', async () => {
      const { logger } = await import('../../src/utils/logger.js');

      expect(logger).toBeDefined();
      expect(typeof logger.info).toBe('function');
      expect(typeof logger.error).toBe('function');
      expect(typeof logger.warn).toBe('function');
      expect(typeof logger.debug).toBe('function');
    });

    it('singleton respects environment settings', async () => {
      process.env.LOG_LEVEL = 'warn';

      const { logger } = await import('../../src/utils/logger.js');

      expect(logger.level).toBe('warn');
    });
  });

  describe('log level behavior', () => {
    it('logger at debug level logs debug messages', async () => {
      const { createLogger } = await import('../../src/utils/logger.js');
      const logger = createLogger({ level: 'debug', pretty: false });

      expect(logger.isLevelEnabled('debug')).toBe(true);
      expect(logger.isLevelEnabled('info')).toBe(true);
      expect(logger.isLevelEnabled('warn')).toBe(true);
      expect(logger.isLevelEnabled('error')).toBe(true);
    });

    it('logger at info level does not log debug messages', async () => {
      const { createLogger } = await import('../../src/utils/logger.js');
      const logger = createLogger({ level: 'info', pretty: false });

      expect(logger.isLevelEnabled('debug')).toBe(false);
      expect(logger.isLevelEnabled('info')).toBe(true);
      expect(logger.isLevelEnabled('warn')).toBe(true);
      expect(logger.isLevelEnabled('error')).toBe(true);
    });

    it('logger at warn level only logs warn and error', async () => {
      const { createLogger } = await import('../../src/utils/logger.js');
      const logger = createLogger({ level: 'warn', pretty: false });

      expect(logger.isLevelEnabled('debug')).toBe(false);
      expect(logger.isLevelEnabled('info')).toBe(false);
      expect(logger.isLevelEnabled('warn')).toBe(true);
      expect(logger.isLevelEnabled('error')).toBe(true);
    });

    it('logger at error level only logs errors', async () => {
      const { createLogger } = await import('../../src/utils/logger.js');
      const logger = createLogger({ level: 'error', pretty: false });

      expect(logger.isLevelEnabled('debug')).toBe(false);
      expect(logger.isLevelEnabled('info')).toBe(false);
      expect(logger.isLevelEnabled('warn')).toBe(false);
      expect(logger.isLevelEnabled('error')).toBe(true);
    });
  });

  describe('environment detection', () => {
    it('detects development environment', async () => {
      process.env.NODE_ENV = 'development';

      const { createLogger } = await import('../../src/utils/logger.js');
      const logger = createLogger();

      // In development, default level should be debug
      expect(logger.level).toBe('debug');
    });

    it('detects production environment', async () => {
      process.env.NODE_ENV = 'production';

      const { createLogger } = await import('../../src/utils/logger.js');
      const logger = createLogger();

      // In production, default level should be info
      expect(logger.level).toBe('info');
    });

    it('handles missing NODE_ENV as development', async () => {
      delete process.env.NODE_ENV;

      const { createLogger } = await import('../../src/utils/logger.js');
      const logger = createLogger();

      // Should default to debug (development behavior)
      expect(logger.level).toBe('debug');
    });

    it('handles Next.js runtime environment', async () => {
      process.env.NODE_ENV = 'development';
      process.env.NEXT_RUNTIME = 'edge';

      const { createLogger } = await import('../../src/utils/logger.js');
      const logger = createLogger();

      // Should create logger successfully in Next.js environment
      expect(logger).toBeDefined();
    });
  });

  describe('edge cases', () => {
    it('handles empty string log level', async () => {
      process.env.LOG_LEVEL = '';

      const { createLogger } = await import('../../src/utils/logger.js');
      const logger = createLogger();

      // Should fall back to development default
      expect(logger.level).toBe('debug');
    });

    it('logger methods exist and are callable', async () => {
      const { createLogger } = await import('../../src/utils/logger.js');
      const logger = createLogger({ level: 'silent' });

      // Should not throw when calling logger methods
      expect(() => logger.debug('test')).not.toThrow();
      expect(() => logger.info('test')).not.toThrow();
      expect(() => logger.warn('test')).not.toThrow();
      expect(() => logger.error('test')).not.toThrow();
    });

    it('handles Next.js global detection', async () => {
      (globalThis as any).__NEXT_DATA__ = {};

      const { createLogger } = await import('../../src/utils/logger.js');
      const logger = createLogger();

      expect(logger).toBeDefined();

      delete (globalThis as any).__NEXT_DATA__;
    });
  });
});
