import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Dependency } from '../../src/providers/index.js';

// Mock the retry module before importing maintenance
vi.mock('../../src/utils/retry.js');
vi.mock('../../src/utils/logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

const retry = await import('../../src/utils/retry.js');
const { checkMaintenance, checkMaintenanceBatch } = await import('../../src/utils/maintenance.js');

describe('utils/maintenance', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('checkMaintenance - npm packages', () => {
    it('detects unmaintained npm package (365+ days)', async () => {
      const oldDate = new Date();
      oldDate.setDate(oldDate.getDate() - 400);

      vi.mocked(retry.fetchWithRetry).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          time: {
            created: '2020-01-01T00:00:00Z',
            modified: '2023-01-01T00:00:00Z',
            '1.0.0': oldDate.toISOString(),
          },
        }),
      } as Response);

      // Mock download stats
      vi.mocked(retry.fetchWithRetry).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ downloads: 1234 }),
      } as Response);

      const result = await checkMaintenance('old-package', 'npm');

      expect(result.isUnmaintained).toBe(true);
      expect(result.daysSinceLastRelease).toBeGreaterThan(365);
      expect(result.downloads?.weekly).toBe(1234);
    });

    it('detects maintained npm package (< 365 days)', async () => {
      const recentDate = new Date();
      recentDate.setDate(recentDate.getDate() - 30);

      vi.mocked(retry.fetchWithRetry).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          time: {
            created: '2020-01-01T00:00:00Z',
            '1.0.0': '2020-01-01T00:00:00Z',
            '2.0.0': recentDate.toISOString(),
          },
        }),
      } as Response);

      vi.mocked(retry.fetchWithRetry).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ downloads: 5678 }),
      } as Response);

      const result = await checkMaintenance('active-package', 'npm');

      expect(result.isUnmaintained).toBe(false);
      expect(result.daysSinceLastRelease).toBeLessThan(365);
    });

    it('handles npm package not found (404)', async () => {
      vi.mocked(retry.fetchWithRetry).mockResolvedValueOnce({
        ok: false,
        status: 404,
      } as Response);

      const result = await checkMaintenance('nonexistent-package', 'npm');

      expect(result.isUnmaintained).toBe(false);
      expect(result.error).toBe('Package not found');
    });

    it('handles npm API errors', async () => {
      vi.mocked(retry.fetchWithRetry).mockRejectedValueOnce(new Error('Network error'));

      const result = await checkMaintenance('error-package', 'npm');

      expect(result.isUnmaintained).toBe(false);
      expect(result.error).toBe('Network error');
    });

    it('handles packages with no version releases', async () => {
      vi.mocked(retry.fetchWithRetry).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          time: {
            created: '2020-01-01T00:00:00Z',
            modified: '2023-01-01T00:00:00Z',
          },
        }),
      } as Response);

      const result = await checkMaintenance('no-releases', 'npm');

      expect(result.isUnmaintained).toBe(true);
      expect(result.error).toBe('No release dates found');
    });

    it('filters out unpublished versions from npm time field', async () => {
      const recentDate = new Date();
      recentDate.setDate(recentDate.getDate() - 100);

      vi.mocked(retry.fetchWithRetry).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          time: {
            created: '2020-01-01T00:00:00Z',
            modified: '2023-01-01T00:00:00Z',
            '1.0.0': '2020-01-01T00:00:00Z',
            unpublished: '2021-01-01T00:00:00Z', // Should be ignored
            '2.0.0': recentDate.toISOString(),
          },
        }),
      } as Response);

      vi.mocked(retry.fetchWithRetry).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ downloads: 100 }),
      } as Response);

      const result = await checkMaintenance('test-package', 'npm');

      expect(result.isUnmaintained).toBe(false);
      expect(result.daysSinceLastRelease).toBeLessThan(365);
    });

    it('handles scoped npm packages', async () => {
      const recentDate = new Date();
      recentDate.setDate(recentDate.getDate() - 30);

      vi.mocked(retry.fetchWithRetry).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          time: {
            '1.0.0': recentDate.toISOString(),
          },
        }),
      } as Response);

      vi.mocked(retry.fetchWithRetry).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ downloads: 999 }),
      } as Response);

      const result = await checkMaintenance('@scope/package', 'npm');

      expect(result.isUnmaintained).toBe(false);
      // Verify package name was URL encoded
      expect(retry.fetchWithRetry).toHaveBeenCalledWith(
        expect.stringContaining('%40scope%2Fpackage'),
        expect.any(Object),
        expect.any(Object)
      );
    });

    it('continues when download stats fail', async () => {
      const oldDate = new Date();
      oldDate.setDate(oldDate.getDate() - 400);

      vi.mocked(retry.fetchWithRetry).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          time: {
            '1.0.0': oldDate.toISOString(),
          },
        }),
      } as Response);

      // Download stats fail
      vi.mocked(retry.fetchWithRetry).mockRejectedValueOnce(new Error('Stats API down'));

      const result = await checkMaintenance('test-package', 'npm');

      expect(result.isUnmaintained).toBe(true);
      expect(result.downloads).toBeUndefined();
    });

    it('handles non-OK download stats response', async () => {
      const recentDate = new Date();
      recentDate.setDate(recentDate.getDate() - 30);

      vi.mocked(retry.fetchWithRetry).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          time: {
            '1.0.0': recentDate.toISOString(),
          },
        }),
      } as Response);

      // Download stats return non-OK
      vi.mocked(retry.fetchWithRetry).mockResolvedValueOnce({
        ok: false,
        status: 500,
      } as Response);

      const result = await checkMaintenance('test-package', 'npm');

      expect(result.isUnmaintained).toBe(false);
      expect(result.downloads).toBeUndefined();
    });
  });

  describe('checkMaintenance - PyPI packages', () => {
    it('detects unmaintained PyPI package', async () => {
      const oldDate = new Date();
      oldDate.setDate(oldDate.getDate() - 450);

      vi.mocked(retry.fetchWithRetry).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          releases: {
            '1.0.0': [
              {
                upload_time_iso_8601: oldDate.toISOString(),
              },
            ],
          },
        }),
      } as Response);

      vi.mocked(retry.fetchWithRetry).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: {
            last_week: 100,
            last_month: 500,
          },
        }),
      } as Response);

      const result = await checkMaintenance('old-python-package', 'PyPI');

      expect(result.isUnmaintained).toBe(true);
      expect(result.daysSinceLastRelease).toBeGreaterThan(365);
      expect(result.downloads?.weekly).toBe(100);
      expect(result.downloads?.monthly).toBe(500);
    });

    it('detects maintained PyPI package', async () => {
      const recentDate = new Date();
      recentDate.setDate(recentDate.getDate() - 60);

      vi.mocked(retry.fetchWithRetry).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          releases: {
            '1.0.0': [{ upload_time_iso_8601: '2020-01-01T00:00:00Z' }],
            '2.0.0': [{ upload_time_iso_8601: recentDate.toISOString() }],
          },
        }),
      } as Response);

      vi.mocked(retry.fetchWithRetry).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: { last_week: 200 },
        }),
      } as Response);

      const result = await checkMaintenance('active-python-package', 'PyPI');

      expect(result.isUnmaintained).toBe(false);
      expect(result.daysSinceLastRelease).toBeLessThan(365);
    });

    it('handles PyPI package not found', async () => {
      vi.mocked(retry.fetchWithRetry).mockResolvedValueOnce({
        ok: false,
        status: 404,
      } as Response);

      const result = await checkMaintenance('nonexistent-pypi-package', 'PyPI');

      expect(result.isUnmaintained).toBe(false);
      expect(result.error).toBe('Package not found');
    });

    it('handles PyPI packages with no releases', async () => {
      vi.mocked(retry.fetchWithRetry).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          releases: {},
        }),
      } as Response);

      const result = await checkMaintenance('no-releases-pypi', 'PyPI');

      expect(result.isUnmaintained).toBe(true);
      expect(result.error).toBe('No release dates found');
    });

    it('handles PyPI packages with multiple releases per version', async () => {
      const recentDate = new Date();
      recentDate.setDate(recentDate.getDate() - 50);
      const olderDate = new Date();
      olderDate.setDate(olderDate.getDate() - 100);

      vi.mocked(retry.fetchWithRetry).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          releases: {
            '1.0.0': [
              { upload_time_iso_8601: olderDate.toISOString() },
              { upload_time_iso_8601: recentDate.toISOString() }, // Most recent
            ],
          },
        }),
      } as Response);

      vi.mocked(retry.fetchWithRetry).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: { last_week: 50 } }),
      } as Response);

      const result = await checkMaintenance('multi-release-pkg', 'PyPI');

      expect(result.isUnmaintained).toBe(false);
      expect(result.daysSinceLastRelease).toBeLessThan(100);
    });

    it('handles PyPI download stats failures', async () => {
      const recentDate = new Date();
      recentDate.setDate(recentDate.getDate() - 30);

      vi.mocked(retry.fetchWithRetry).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          releases: {
            '1.0.0': [{ upload_time_iso_8601: recentDate.toISOString() }],
          },
        }),
      } as Response);

      // pypistats.org is down
      vi.mocked(retry.fetchWithRetry).mockRejectedValueOnce(new Error('Stats unavailable'));

      const result = await checkMaintenance('test-pypi', 'PyPI');

      expect(result.isUnmaintained).toBe(false);
      expect(result.downloads).toBeUndefined();
    });

    it('handles case-insensitive "python" ecosystem', async () => {
      const recentDate = new Date();
      recentDate.setDate(recentDate.getDate() - 30);

      vi.mocked(retry.fetchWithRetry).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          releases: {
            '1.0.0': [{ upload_time_iso_8601: recentDate.toISOString() }],
          },
        }),
      } as Response);

      vi.mocked(retry.fetchWithRetry).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: { last_week: 10 } }),
      } as Response);

      const result = await checkMaintenance('test-pkg', 'python');

      expect(result.ecosystem).toBe('python');
      expect(result.isUnmaintained).toBe(false);
    });
  });

  describe('checkMaintenance - unsupported ecosystems', () => {
    it('returns error for Go ecosystem', async () => {
      const result = await checkMaintenance('golang-package', 'Go');

      expect(result.isUnmaintained).toBe(false);
      expect(result.error).toContain('not supported');
      expect(result.error).toContain('Go');
    });

    it('returns error for Ruby ecosystem', async () => {
      const result = await checkMaintenance('ruby-gem', 'RubyGems');

      expect(result.isUnmaintained).toBe(false);
      expect(result.error).toContain('not supported');
    });

    it('returns error for unknown ecosystem', async () => {
      const result = await checkMaintenance('random-package', 'UnknownEcosystem');

      expect(result.isUnmaintained).toBe(false);
      expect(result.error).toContain('not supported');
    });
  });

  describe('checkMaintenanceBatch', () => {
    it('checks multiple packages in parallel', async () => {
      const packages: Dependency[] = [
        { name: 'pkg1', version: '1.0.0', ecosystem: 'npm', dev: false },
        { name: 'pkg2', version: '2.0.0', ecosystem: 'npm', dev: false },
        { name: 'pkg3', version: '3.0.0', ecosystem: 'PyPI', dev: false },
      ];

      const recentDate = new Date();
      recentDate.setDate(recentDate.getDate() - 30);

      // Mock npm responses
      vi.mocked(retry.fetchWithRetry).mockResolvedValue({
        ok: true,
        json: async () => ({
          time: { '1.0.0': recentDate.toISOString() },
        }),
      } as Response);

      const result = await checkMaintenanceBatch(packages, 2);

      expect(result.size).toBe(3);
      expect(result.get('pkg1')).toBeDefined();
      expect(result.get('pkg2')).toBeDefined();
      expect(result.get('pkg3')).toBeDefined();
    });

    it('respects concurrency limit', async () => {
      const packages: Dependency[] = [];
      for (let i = 0; i < 10; i++) {
        packages.push({ name: `pkg${i}`, version: '1.0.0', ecosystem: 'npm', dev: false });
      }

      let concurrentCalls = 0;
      let maxConcurrency = 0;

      vi.mocked(retry.fetchWithRetry).mockImplementation(async () => {
        concurrentCalls++;
        maxConcurrency = Math.max(maxConcurrency, concurrentCalls);
        await new Promise((resolve) => setTimeout(resolve, 10));
        concurrentCalls--;
        return {
          ok: true,
          json: async () => ({
            time: { '1.0.0': new Date().toISOString() },
          }),
        } as Response;
      });

      await checkMaintenanceBatch(packages, 3);

      // Should not exceed concurrency limit of 3
      // Note: Each package makes 2 calls (registry + downloads), so max concurrent is 6
      expect(maxConcurrency).toBeLessThanOrEqual(6);
    });

    it('handles errors for individual packages', async () => {
      const packages: Dependency[] = [
        { name: 'good-pkg', version: '1.0.0', ecosystem: 'npm', dev: false },
        { name: 'bad-pkg', version: '1.0.0', ecosystem: 'npm', dev: false },
      ];

      const recentDate = new Date();
      recentDate.setDate(recentDate.getDate() - 30);

      vi.mocked(retry.fetchWithRetry)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ time: { '1.0.0': recentDate.toISOString() } }),
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ downloads: 100 }),
        } as Response)
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ downloads: 200 }),
        } as Response);

      const result = await checkMaintenanceBatch(packages, 1);

      expect(result.size).toBe(2);
      expect(result.get('good-pkg')?.isUnmaintained).toBe(false);
      expect(result.get('bad-pkg')?.error).toBe('Network error');
    });

    it('processes packages in batches', async () => {
      const packages: Dependency[] = [];
      for (let i = 0; i < 7; i++) {
        packages.push({ name: `pkg${i}`, version: '1.0.0', ecosystem: 'npm', dev: false });
      }

      const recentDate = new Date();
      recentDate.setDate(recentDate.getDate() - 30);

      vi.mocked(retry.fetchWithRetry).mockResolvedValue({
        ok: true,
        json: async () => ({
          time: { '1.0.0': recentDate.toISOString() },
        }),
      } as Response);

      const result = await checkMaintenanceBatch(packages, 3);

      // Should process in 3 batches: [3, 3, 1]
      expect(result.size).toBe(7);
      for (let i = 0; i < 7; i++) {
        expect(result.get(`pkg${i}`)).toBeDefined();
      }
    });

    it('handles empty package list', async () => {
      const result = await checkMaintenanceBatch([], 5);

      expect(result.size).toBe(0);
    });

    it('uses default concurrency of 5', async () => {
      const packages: Dependency[] = [
        { name: 'test-pkg', version: '1.0.0', ecosystem: 'npm', dev: false },
      ];

      const recentDate = new Date();
      recentDate.setDate(recentDate.getDate() - 30);

      vi.mocked(retry.fetchWithRetry).mockResolvedValue({
        ok: true,
        json: async () => ({
          time: { '1.0.0': recentDate.toISOString() },
        }),
      } as Response);

      const result = await checkMaintenanceBatch(packages);

      expect(result.size).toBe(1);
    });
  });

  describe('edge cases', () => {
    it('handles very old packages (1000+ days)', async () => {
      const veryOldDate = new Date();
      veryOldDate.setDate(veryOldDate.getDate() - 1200);

      vi.mocked(retry.fetchWithRetry).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          time: {
            '1.0.0': veryOldDate.toISOString(),
          },
        }),
      } as Response);

      vi.mocked(retry.fetchWithRetry).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ downloads: 5 }),
      } as Response);

      const result = await checkMaintenance('ancient-package', 'npm');

      expect(result.isUnmaintained).toBe(true);
      expect(result.daysSinceLastRelease).toBeGreaterThan(1000);
    });

    it('handles packages with exactly 365 days since release', async () => {
      const exactDate = new Date();
      exactDate.setDate(exactDate.getDate() - 365);

      vi.mocked(retry.fetchWithRetry).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          time: {
            '1.0.0': exactDate.toISOString(),
          },
        }),
      } as Response);

      vi.mocked(retry.fetchWithRetry).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ downloads: 10 }),
      } as Response);

      const result = await checkMaintenance('edge-case-package', 'npm');

      // Should be considered unmaintained at exactly 365 days
      expect(result.isUnmaintained).toBe(true);
      expect(result.daysSinceLastRelease).toBe(365);
    });

    it('handles malformed npm registry response', async () => {
      vi.mocked(retry.fetchWithRetry).mockResolvedValueOnce({
        ok: true,
        json: async () => ({}), // No 'time' field
      } as Response);

      const result = await checkMaintenance('malformed-response', 'npm');

      expect(result.isUnmaintained).toBe(true);
      expect(result.error).toBe('No release dates found');
    });

    it('handles malformed PyPI response', async () => {
      vi.mocked(retry.fetchWithRetry).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ releases: null }), // Null releases
      } as Response);

      const result = await checkMaintenance('malformed-pypi', 'PyPI');

      expect(result.isUnmaintained).toBe(true);
      expect(result.error).toBe('No release dates found');
    });
  });
});
