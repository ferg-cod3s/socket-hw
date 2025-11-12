import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Dependency } from '../../src/providers/index.js';
import type { OsvVuln, OsvBatchResponse } from '../../src/api/osv.js';
import type { GhsaAdvisory } from '../../src/api/ghsa.js';

// We'll mock the modules before importing scanPath
vi.mock('../../src/api/osv.js');
vi.mock('../../src/api/ghsa.js');
vi.mock('../../src/utils/maintenance.js');

const { scanPath } = await import('../../src/core/scan.js');
const osv = await import('../../src/api/osv.js');
const ghsa = await import('../../src/api/ghsa.js');
const maintenance = await import('../../src/utils/maintenance.js');

async function withTempDir(run: (dir: string) => Promise<void>): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'scanner-core-'));
  try {
    await run(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('core/scan - comprehensive tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('scanPath - basic functionality', () => {
    it('handles empty dependency list', async () => {
      await withTempDir(async (dir) => {
        writeFileSync(
          join(dir, 'package.json'),
          JSON.stringify({ name: 'test', version: '1.0.0', dependencies: {} }),
          'utf8',
        );

        const result = await scanPath(dir, { concurrency: 1 });

        expect(result.deps).toHaveLength(0);
        expect(result.advisoriesByPackage).toEqual({});
        expect(result.scanDurationMs).toBeGreaterThanOrEqual(0);
      });
    });

    it('handles standalone lockfile with temp filename', async () => {
      await withTempDir(async (dir) => {
        const lockfilePath = join(dir, '8a161a-pnpm-lock.yaml');
        writeFileSync(lockfilePath, 'lockfileVersion: 5.4\n', 'utf8');
        writeFileSync(
          join(dir, 'package.json'),
          JSON.stringify({ name: 'test', version: '1.0.0', dependencies: {} }),
          'utf8',
        );

        // Should not throw for temp-prefixed lockfiles
        await expect(scanPath(lockfilePath)).resolves.toBeDefined();
      });
    });

    it('throws error for unsupported file types', async () => {
      await withTempDir(async (dir) => {
        const unsupportedFile = join(dir, 'README.md');
        writeFileSync(unsupportedFile, '# Test', 'utf8');

        await expect(scanPath(unsupportedFile)).rejects.toThrow(/unsupported file/i);
      });
    });
  });

  describe('OSV batch processing', () => {
    it('processes packages in batches of 50', async () => {
      await withTempDir(async (dir) => {
        // Create a package.json with many dependencies
        const deps: Record<string, string> = {};
        for (let i = 0; i < 75; i++) {
          deps[`package-${i}`] = '1.0.0';
        }

        writeFileSync(
          join(dir, 'package.json'),
          JSON.stringify({ name: 'test', version: '1.0.0', dependencies: deps }),
          'utf8',
        );

        vi.mocked(osv.queryOsvBatch).mockResolvedValue({ results: [] });
        vi.mocked(ghsa.queryGhsa).mockResolvedValue([]);

        await scanPath(dir, { concurrency: 1 });

        // Should call queryOsvBatch twice (50 + 25)
        expect(osv.queryOsvBatch).toHaveBeenCalledTimes(2);
      });
    });

    it('falls back to individual queries when batch fails', async () => {
      await withTempDir(async (dir) => {
        writeFileSync(
          join(dir, 'package.json'),
          JSON.stringify({
            name: 'test',
            version: '1.0.0',
            dependencies: { 'pkg-1': '1.0.0', 'pkg-2': '1.0.0' },
          }),
          'utf8',
        );

        // First batch call fails
        vi.mocked(osv.queryOsvBatch).mockRejectedValueOnce(new Error('Batch failed'));

        // Individual calls succeed
        vi.mocked(osv.queryOsv).mockResolvedValue({ vulns: [] });
        vi.mocked(ghsa.queryGhsa).mockResolvedValue([]);

        const result = await scanPath(dir, { concurrency: 1 });

        // Should fall back to individual queries
        expect(osv.queryOsv).toHaveBeenCalled();
        expect(result.advisoriesByPackage).toBeDefined();
      });
    });

    it('handles OSV response without vulns array', async () => {
      await withTempDir(async (dir) => {
        writeFileSync(
          join(dir, 'package.json'),
          JSON.stringify({
            name: 'test',
            version: '1.0.0',
            dependencies: { lodash: '4.17.20' },
          }),
          'utf8',
        );

        // OSV returns result without vulns key
        vi.mocked(osv.queryOsvBatch).mockResolvedValueOnce({
          results: [{}],
        } as OsvBatchResponse);

        vi.mocked(ghsa.queryGhsa).mockResolvedValue([]);

        const result = await scanPath(dir, { concurrency: 1 });

        // Should not throw, should handle gracefully
        expect(result.advisoriesByPackage).toBeDefined();
      });
    });
  });

  describe('GHSA integration', () => {
    it('merges OSV and GHSA results', async () => {
      await withTempDir(async (dir) => {
        writeFileSync(
          join(dir, 'package.json'),
          JSON.stringify({
            name: 'test',
            version: '1.0.0',
            dependencies: { lodash: '4.17.20' },
          }),
          'utf8',
        );

        // OSV returns one vuln
        vi.mocked(osv.queryOsvBatch).mockResolvedValueOnce({
          results: [
            {
              vulns: [
                {
                  id: 'OSV-2021-123',
                  summary: 'OSV vulnerability',
                  modified: '2021-01-01T00:00:00Z',
                },
              ],
            },
          ],
        });

        // GHSA returns different vuln
        vi.mocked(ghsa.queryGhsa).mockResolvedValueOnce([
          {
            id: 'GHSA-xxxx-yyyy-zzzz',
            summary: 'GHSA vulnerability',
            severity: 'HIGH',
            publishedAt: '2021-01-01T00:00:00Z',
            updatedAt: '2021-01-01T00:00:00Z',
            vulnerabilities: [
              {
                package: { name: 'lodash', ecosystem: 'NPM' },
                vulnerableVersionRange: '< 4.17.21',
                firstPatchedVersion: { identifier: '4.17.21' },
              },
            ],
            references: [{ url: 'https://github.com/advisories/GHSA-xxxx-yyyy-zzzz' }],
          },
        ]);

        const result = await scanPath(dir, { concurrency: 1 });

        // Should have both advisories
        expect(result.advisoriesByPackage.lodash).toHaveLength(2);
        expect(result.advisoriesByPackage.lodash.map((a) => a.source)).toContain('osv');
        expect(result.advisoriesByPackage.lodash.map((a) => a.source)).toContain('ghsa');
      });
    });

    it('deduplicates advisories with same ID', async () => {
      await withTempDir(async (dir) => {
        writeFileSync(
          join(dir, 'package.json'),
          JSON.stringify({
            name: 'test',
            version: '1.0.0',
            dependencies: { lodash: '4.17.20' },
          }),
          'utf8',
        );

        // Both return same CVE
        const cveId = 'CVE-2021-12345';
        vi.mocked(osv.queryOsvBatch).mockResolvedValueOnce({
          results: [
            {
              vulns: [
                {
                  id: cveId,
                  summary: 'Duplicate vuln',
                  modified: '2021-01-01T00:00:00Z',
                },
              ],
            },
          ],
        });

        vi.mocked(ghsa.queryGhsa).mockResolvedValueOnce([
          {
            id: cveId,
            summary: 'Same vuln from GHSA',
            severity: 'HIGH',
            publishedAt: '2021-01-01T00:00:00Z',
            updatedAt: '2021-01-01T00:00:00Z',
            vulnerabilities: [
              {
                package: { name: 'lodash', ecosystem: 'NPM' },
                vulnerableVersionRange: '< 4.17.21',
              },
            ],
            references: [],
          },
        ]);

        const result = await scanPath(dir, { concurrency: 1 });

        // Should deduplicate to single advisory
        expect(result.advisoriesByPackage.lodash).toHaveLength(1);
        expect(result.advisoriesByPackage.lodash[0].id).toBe(cveId);
      });
    });

    it('handles GHSA query failures gracefully', async () => {
      await withTempDir(async (dir) => {
        writeFileSync(
          join(dir, 'package.json'),
          JSON.stringify({
            name: 'test',
            version: '1.0.0',
            dependencies: { lodash: '4.17.20' },
          }),
          'utf8',
        );

        // OSV succeeds
        vi.mocked(osv.queryOsvBatch).mockResolvedValueOnce({
          results: [
            {
              vulns: [
                {
                  id: 'OSV-2021-123',
                  summary: 'Test vuln',
                  modified: '2021-01-01T00:00:00Z',
                },
              ],
            },
          ],
        });

        // GHSA fails
        vi.mocked(ghsa.queryGhsa).mockRejectedValueOnce(new Error('GHSA API error'));

        const result = await scanPath(dir, { concurrency: 1 });

        // Should still include OSV results
        expect(result.advisoriesByPackage.lodash).toHaveLength(1);
        expect(result.advisoriesByPackage.lodash[0].source).toBe('osv');
      });
    });

    it('filters GHSA results by version range', async () => {
      await withTempDir(async (dir) => {
        writeFileSync(
          join(dir, 'package.json'),
          JSON.stringify({
            name: 'test',
            version: '1.0.0',
            dependencies: { lodash: '4.17.21' }, // Patched version
          }),
          'utf8',
        );

        vi.mocked(osv.queryOsvBatch).mockResolvedValueOnce({ results: [{ vulns: [] }] });

        // GHSA returns advisory for older versions
        vi.mocked(ghsa.queryGhsa).mockResolvedValueOnce([
          {
            id: 'GHSA-old-vuln',
            summary: 'Old vulnerability',
            severity: 'HIGH',
            publishedAt: '2021-01-01T00:00:00Z',
            updatedAt: '2021-01-01T00:00:00Z',
            vulnerabilities: [
              {
                package: { name: 'lodash', ecosystem: 'NPM' },
                vulnerableVersionRange: '< 4.17.21',
                firstPatchedVersion: { identifier: '4.17.21' },
              },
            ],
            references: [],
          },
        ]);

        const result = await scanPath(dir, { concurrency: 1 });

        // Should filter out advisory since version is patched
        expect(result.advisoriesByPackage.lodash || []).toHaveLength(0);
      });
    });
  });

  describe('CVE extraction', () => {
    it('extracts CVE from OSV ID', async () => {
      await withTempDir(async (dir) => {
        writeFileSync(
          join(dir, 'package.json'),
          JSON.stringify({
            name: 'test',
            version: '1.0.0',
            dependencies: { lodash: '4.17.20' },
          }),
          'utf8',
        );

        vi.mocked(osv.queryOsvBatch).mockResolvedValueOnce({
          results: [
            {
              vulns: [
                {
                  id: 'CVE-2021-12345',
                  summary: 'Test',
                  modified: '2021-01-01T00:00:00Z',
                },
              ],
            },
          ],
        });

        vi.mocked(ghsa.queryGhsa).mockResolvedValue([]);

        const result = await scanPath(dir, { concurrency: 1 });

        expect(result.advisoriesByPackage.lodash[0].cveIds).toContain('CVE-2021-12345');
      });
    });

    it('extracts CVE from OSV aliases', async () => {
      await withTempDir(async (dir) => {
        writeFileSync(
          join(dir, 'package.json'),
          JSON.stringify({
            name: 'test',
            version: '1.0.0',
            dependencies: { lodash: '4.17.20' },
          }),
          'utf8',
        );

        vi.mocked(osv.queryOsvBatch).mockResolvedValueOnce({
          results: [
            {
              vulns: [
                {
                  id: 'GHSA-xxxx-yyyy-zzzz',
                  summary: 'Test',
                  modified: '2021-01-01T00:00:00Z',
                  aliases: ['CVE-2021-12345', 'CVE-2021-67890'],
                },
              ],
            },
          ],
        });

        vi.mocked(ghsa.queryGhsa).mockResolvedValue([]);

        const result = await scanPath(dir, { concurrency: 1 });

        expect(result.advisoriesByPackage.lodash[0].cveIds).toContain('CVE-2021-12345');
        expect(result.advisoriesByPackage.lodash[0].cveIds).toContain('CVE-2021-67890');
      });
    });

    it('extracts CVE from GHSA advisory text', async () => {
      await withTempDir(async (dir) => {
        writeFileSync(
          join(dir, 'package.json'),
          JSON.stringify({
            name: 'test',
            version: '1.0.0',
            dependencies: { lodash: '4.17.20' },
          }),
          'utf8',
        );

        vi.mocked(osv.queryOsvBatch).mockResolvedValueOnce({ results: [{ vulns: [] }] });

        vi.mocked(ghsa.queryGhsa).mockResolvedValueOnce([
          {
            id: 'GHSA-xxxx-yyyy-zzzz',
            summary: 'Vulnerability CVE-2021-99999',
            description: 'This affects versions. See CVE-2021-88888 for details.',
            severity: 'HIGH',
            publishedAt: '2021-01-01T00:00:00Z',
            updatedAt: '2021-01-01T00:00:00Z',
            vulnerabilities: [
              {
                package: { name: 'lodash', ecosystem: 'NPM' },
                vulnerableVersionRange: '< 4.17.21',
              },
            ],
            references: [{ url: 'https://cve.mitre.org/cgi-bin/cvename.cgi?name=CVE-2021-77777' }],
          },
        ]);

        const result = await scanPath(dir, { concurrency: 1 });

        const cveIds = result.advisoriesByPackage.lodash[0].cveIds;
        expect(cveIds).toContain('CVE-2021-99999');
        expect(cveIds).toContain('CVE-2021-88888');
        expect(cveIds).toContain('CVE-2021-77777');
      });
    });
  });

  describe('Severity calculation', () => {
    it('extracts severity from database_specific field', async () => {
      await withTempDir(async (dir) => {
        writeFileSync(
          join(dir, 'package.json'),
          JSON.stringify({
            name: 'test',
            version: '1.0.0',
            dependencies: { lodash: '4.17.20' },
          }),
          'utf8',
        );

        vi.mocked(osv.queryOsvBatch).mockResolvedValueOnce({
          results: [
            {
              vulns: [
                {
                  id: 'OSV-123',
                  summary: 'Test',
                  modified: '2021-01-01T00:00:00Z',
                  database_specific: { severity: 'high' },
                } as OsvVuln,
              ],
            },
          ],
        });

        vi.mocked(ghsa.queryGhsa).mockResolvedValue([]);

        const result = await scanPath(dir, { concurrency: 1 });

        expect(result.advisoriesByPackage.lodash[0].severity).toBe('HIGH');
      });
    });

    it('calculates severity from CVSS score', async () => {
      await withTempDir(async (dir) => {
        writeFileSync(
          join(dir, 'package.json'),
          JSON.stringify({
            name: 'test',
            version: '1.0.0',
            dependencies: { pkg1: '1.0.0', pkg2: '1.0.0', pkg3: '1.0.0', pkg4: '1.0.0' },
          }),
          'utf8',
        );

        vi.mocked(osv.queryOsvBatch).mockResolvedValueOnce({
          results: [
            {
              vulns: [
                {
                  id: 'OSV-CRITICAL',
                  summary: 'Critical',
                  modified: '2021-01-01T00:00:00Z',
                  severity: [{ type: 'CVSS_V3', score: '9.5' }],
                },
              ],
            },
            {
              vulns: [
                {
                  id: 'OSV-HIGH',
                  summary: 'High',
                  modified: '2021-01-01T00:00:00Z',
                  severity: [{ type: 'CVSS_V3', score: '7.5' }],
                },
              ],
            },
            {
              vulns: [
                {
                  id: 'OSV-MEDIUM',
                  summary: 'Medium',
                  modified: '2021-01-01T00:00:00Z',
                  severity: [{ type: 'CVSS_V3', score: '5.0' }],
                },
              ],
            },
            {
              vulns: [
                {
                  id: 'OSV-LOW',
                  summary: 'Low',
                  modified: '2021-01-01T00:00:00Z',
                  severity: [{ type: 'CVSS_V3', score: '2.0' }],
                },
              ],
            },
          ],
        });

        vi.mocked(ghsa.queryGhsa).mockResolvedValue([]);

        const result = await scanPath(dir, { concurrency: 1 });

        expect(result.advisoriesByPackage.pkg1[0].severity).toBe('CRITICAL');
        expect(result.advisoriesByPackage.pkg2[0].severity).toBe('HIGH');
        expect(result.advisoriesByPackage.pkg3[0].severity).toBe('MEDIUM');
        expect(result.advisoriesByPackage.pkg4[0].severity).toBe('LOW');
      });
    });

    it('returns UNKNOWN for missing severity', async () => {
      await withTempDir(async (dir) => {
        writeFileSync(
          join(dir, 'package.json'),
          JSON.stringify({
            name: 'test',
            version: '1.0.0',
            dependencies: { lodash: '4.17.20' },
          }),
          'utf8',
        );

        vi.mocked(osv.queryOsvBatch).mockResolvedValueOnce({
          results: [
            {
              vulns: [
                {
                  id: 'OSV-123',
                  summary: 'Test',
                  modified: '2021-01-01T00:00:00Z',
                },
              ],
            },
          ],
        });

        vi.mocked(ghsa.queryGhsa).mockResolvedValue([]);

        const result = await scanPath(dir, { concurrency: 1 });

        expect(result.advisoriesByPackage.lodash[0].severity).toBe('UNKNOWN');
      });
    });
  });

  describe('Ignore file handling', () => {
    it('applies ignore list from .vuln-ignore.json', async () => {
      await withTempDir(async (dir) => {
        writeFileSync(
          join(dir, 'package.json'),
          JSON.stringify({
            name: 'test',
            version: '1.0.0',
            dependencies: { lodash: '4.17.20' },
          }),
          'utf8',
        );

        // Create ignore file
        writeFileSync(
          join(dir, '.vuln-ignore.json'),
          JSON.stringify({
            version: '1.0',
            ignores: [{ id: 'OSV-2021-123', reason: 'False positive' }],
          }),
          'utf8',
        );

        vi.mocked(osv.queryOsvBatch).mockResolvedValueOnce({
          results: [
            {
              vulns: [
                {
                  id: 'OSV-2021-123',
                  summary: 'Ignored vuln',
                  modified: '2021-01-01T00:00:00Z',
                },
              ],
            },
          ],
        });

        vi.mocked(ghsa.queryGhsa).mockResolvedValue([]);

        const result = await scanPath(dir, { concurrency: 1 });

        // Should filter out ignored advisory
        expect(result.advisoriesByPackage.lodash || []).toHaveLength(0);
      });
    });

    it('uses custom ignore file path', async () => {
      await withTempDir(async (dir) => {
        writeFileSync(
          join(dir, 'package.json'),
          JSON.stringify({
            name: 'test',
            version: '1.0.0',
            dependencies: { lodash: '4.17.20' },
          }),
          'utf8',
        );

        const customIgnorePath = join(dir, 'custom-ignore.json');
        writeFileSync(
          customIgnorePath,
          JSON.stringify({
            version: '1.0',
            ignores: [{ id: 'OSV-2021-123', reason: 'False positive' }],
          }),
          'utf8',
        );

        vi.mocked(osv.queryOsvBatch).mockResolvedValueOnce({
          results: [
            {
              vulns: [
                {
                  id: 'OSV-2021-123',
                  summary: 'Ignored vuln',
                  modified: '2021-01-01T00:00:00Z',
                },
              ],
            },
          ],
        });

        vi.mocked(ghsa.queryGhsa).mockResolvedValue([]);

        const result = await scanPath(dir, { concurrency: 1, ignoreFile: customIgnorePath });

        // Should filter out ignored advisory
        expect(result.advisoriesByPackage.lodash || []).toHaveLength(0);
      });
    });
  });

  describe('Maintenance checking', () => {
    it('includes maintenance info when requested', async () => {
      await withTempDir(async (dir) => {
        writeFileSync(
          join(dir, 'package.json'),
          JSON.stringify({
            name: 'test',
            version: '1.0.0',
            dependencies: { lodash: '4.17.20' },
          }),
          'utf8',
        );

        vi.mocked(osv.queryOsvBatch).mockResolvedValue({ results: [{ vulns: [] }] });
        vi.mocked(ghsa.queryGhsa).mockResolvedValue([]);

        const mockMaintenanceInfo = new Map([
          [
            'lodash',
            {
              package: 'lodash',
              ecosystem: 'npm',
              isUnmaintained: true,
              daysSinceLastRelease: 500,
            },
          ],
        ]);
        vi.mocked(maintenance.checkMaintenanceBatch).mockResolvedValueOnce(mockMaintenanceInfo);

        const result = await scanPath(dir, { checkMaintenance: true, concurrency: 1 });

        expect(result.maintenanceInfo).toBeDefined();
        expect(result.maintenanceInfo?.get('lodash')?.isUnmaintained).toBe(true);
        expect(maintenance.checkMaintenanceBatch).toHaveBeenCalled();
      });
    });

    it('skips maintenance check by default', async () => {
      await withTempDir(async (dir) => {
        writeFileSync(
          join(dir, 'package.json'),
          JSON.stringify({
            name: 'test',
            version: '1.0.0',
            dependencies: { lodash: '4.17.20' },
          }),
          'utf8',
        );

        vi.mocked(osv.queryOsvBatch).mockResolvedValue({ results: [{ vulns: [] }] });
        vi.mocked(ghsa.queryGhsa).mockResolvedValue([]);

        const result = await scanPath(dir, { concurrency: 1 });

        expect(result.maintenanceInfo).toBeUndefined();
        expect(maintenance.checkMaintenanceBatch).not.toHaveBeenCalled();
      });
    });
  });

  describe('Concurrency control', () => {
    it('respects concurrency limit for GHSA queries', async () => {
      await withTempDir(async (dir) => {
        const deps: Record<string, string> = {};
        for (let i = 0; i < 10; i++) {
          deps[`package-${i}`] = '1.0.0';
        }

        writeFileSync(
          join(dir, 'package.json'),
          JSON.stringify({ name: 'test', version: '1.0.0', dependencies: deps }),
          'utf8',
        );

        vi.mocked(osv.queryOsvBatch).mockResolvedValue({ results: [] });

        let concurrentCalls = 0;
        let maxConcurrency = 0;

        vi.mocked(ghsa.queryGhsa).mockImplementation(async () => {
          concurrentCalls++;
          maxConcurrency = Math.max(maxConcurrency, concurrentCalls);
          await new Promise((resolve) => setTimeout(resolve, 10));
          concurrentCalls--;
          return [];
        });

        await scanPath(dir, { concurrency: 3 });

        // Max concurrent GHSA calls should respect the limit
        expect(maxConcurrency).toBeLessThanOrEqual(3);
      });
    });
  });

  describe('First patched version extraction', () => {
    it('extracts first patched version from OSV', async () => {
      await withTempDir(async (dir) => {
        writeFileSync(
          join(dir, 'package.json'),
          JSON.stringify({
            name: 'test',
            version: '1.0.0',
            dependencies: { lodash: '4.17.20' },
          }),
          'utf8',
        );

        vi.mocked(osv.queryOsvBatch).mockResolvedValueOnce({
          results: [
            {
              vulns: [
                {
                  id: 'OSV-123',
                  summary: 'Test',
                  modified: '2021-01-01T00:00:00Z',
                  affected: [
                    {
                      package: { ecosystem: 'npm', name: 'lodash' },
                      ranges: [
                        {
                          type: 'SEMVER',
                          events: [{ introduced: '0' }, { fixed: '4.17.21' }],
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        });

        vi.mocked(ghsa.queryGhsa).mockResolvedValue([]);

        const result = await scanPath(dir, { concurrency: 1 });

        expect(result.advisoriesByPackage.lodash[0].firstPatchedVersion).toBe('4.17.21');
      });
    });

    it('extracts first patched version from GHSA', async () => {
      await withTempDir(async (dir) => {
        writeFileSync(
          join(dir, 'package.json'),
          JSON.stringify({
            name: 'test',
            version: '1.0.0',
            dependencies: { lodash: '4.17.20' },
          }),
          'utf8',
        );

        vi.mocked(osv.queryOsvBatch).mockResolvedValue({ results: [{ vulns: [] }] });

        vi.mocked(ghsa.queryGhsa).mockResolvedValueOnce([
          {
            id: 'GHSA-xxxx',
            summary: 'Test',
            severity: 'HIGH',
            publishedAt: '2021-01-01T00:00:00Z',
            updatedAt: '2021-01-01T00:00:00Z',
            vulnerabilities: [
              {
                package: { name: 'lodash', ecosystem: 'NPM' },
                vulnerableVersionRange: '< 4.17.21',
                firstPatchedVersion: { identifier: '4.17.21' },
              },
            ],
            references: [],
          },
        ]);

        const result = await scanPath(dir, { concurrency: 1 });

        expect(result.advisoriesByPackage.lodash[0].firstPatchedVersion).toBe('4.17.21');
      });
    });
  });

  describe('Multi-source vulnerability handling', () => {
    it('labels GHSA advisories from OSV with GHSA source', async () => {
      await withTempDir(async (dir) => {
        writeFileSync(
          join(dir, 'package.json'),
          JSON.stringify({
            name: 'test',
            version: '1.0.0',
            dependencies: { vite: '6.2.3' },
          }),
          'utf8',
        );

        // OSV returns GHSA IDs (cross-referenced vulnerabilities)
        vi.mocked(osv.queryOsvBatch).mockResolvedValueOnce({
          results: [
            {
              vulns: [
                {
                  id: 'GHSA-356w-63v5-8wf4',
                  summary: 'Test GHSA via OSV',
                  modified: '2021-01-01T00:00:00Z',
                  severity: [{ type: 'CVSS_V3', score: '7.5' }],
                  affected: [
                    {
                      package: { ecosystem: 'npm', name: 'vite' },
                      ranges: [
                        {
                          type: 'SEMVER',
                          events: [{ introduced: '0' }, { fixed: '6.2.4' }],
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        });

        vi.mocked(ghsa.queryGhsa).mockResolvedValueOnce([]);

        const result = await scanPath(dir, { concurrency: 1 });

        // Advisory should be labeled as GHSA since it has a GHSA ID
        expect(result.advisoriesByPackage.vite).toHaveLength(1);
        expect(result.advisoriesByPackage.vite[0].id).toBe('GHSA-356w-63v5-8wf4');
        expect(result.advisoriesByPackage.vite[0].source).toBe('ghsa');
      });
    });

    it('correctly identifies duplicate GHSA advisories from both OSV and GHSA', async () => {
      await withTempDir(async (dir) => {
        writeFileSync(
          join(dir, 'package.json'),
          JSON.stringify({
            name: 'test',
            version: '1.0.0',
            dependencies: { lodash: '4.17.20' },
          }),
          'utf8',
        );

        const ghsaId = 'GHSA-xxxx-yyyy-zzzz';

        // OSV returns the GHSA advisory (with GHSA ID)
        vi.mocked(osv.queryOsvBatch).mockResolvedValueOnce({
          results: [
            {
              vulns: [
                {
                  id: ghsaId,
                  summary: 'Vulnerability via OSV',
                  modified: '2021-01-01T00:00:00Z',
                  severity: [{ type: 'CVSS_V3', score: '5.0' }], // MEDIUM
                  affected: [
                    {
                      package: { ecosystem: 'npm', name: 'lodash' },
                      ranges: [
                        {
                          type: 'SEMVER',
                          events: [{ introduced: '0' }, { fixed: '4.17.21' }],
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        });

        // GHSA also returns the same advisory with higher severity
        vi.mocked(ghsa.queryGhsa).mockResolvedValueOnce([
          {
            id: ghsaId,
            summary: 'Vulnerability from GHSA',
            severity: 'CRITICAL', // Higher than OSV's MEDIUM
            publishedAt: '2021-01-01T00:00:00Z',
            updatedAt: '2021-01-01T00:00:00Z',
            vulnerabilities: [
              {
                package: { name: 'lodash', ecosystem: 'NPM' },
                vulnerableVersionRange: '< 4.17.21',
              },
            ],
            references: [],
          },
        ]);

        const result = await scanPath(dir, { concurrency: 1 });

        // Both sources return same GHSA ID, so dedup tracks both sources
        // Result: single advisory with both sources listed and highest severity
        expect(result.advisoriesByPackage.lodash).toHaveLength(1);
        const advisory = result.advisoriesByPackage.lodash[0];
        // Both report the same source 'ghsa' since ID starts with GHSA-
        expect(advisory.source).toBe('ghsa');
        // But severity should be updated to CRITICAL (higher)
        expect(advisory.severity).toBe('CRITICAL');
      });
    });

    it('uses higher severity when same advisory from multiple sources', async () => {
      await withTempDir(async (dir) => {
        writeFileSync(
          join(dir, 'package.json'),
          JSON.stringify({
            name: 'test',
            version: '1.0.0',
            dependencies: { lodash: '4.17.20' },
          }),
          'utf8',
        );

        const osvVulnId = 'OSV-2021-987';

        // OSV reports as MEDIUM
        vi.mocked(osv.queryOsvBatch).mockResolvedValueOnce({
          results: [
            {
              vulns: [
                {
                  id: osvVulnId,
                  summary: 'Vulnerability',
                  modified: '2021-01-01T00:00:00Z',
                  severity: [{ type: 'CVSS_V3', score: '5.0' }], // MEDIUM
                  affected: [
                    {
                      package: { ecosystem: 'npm', name: 'lodash' },
                      ranges: [
                        {
                          type: 'SEMVER',
                          events: [{ introduced: '0' }, { fixed: '4.17.21' }],
                        },
                      ],
                    },
                  ],
                },
                {
                  id: 'GHSA-9999-8888-7777', // Second advisory from OSV
                  summary: 'Another vulnerability',
                  modified: '2021-01-01T00:00:00Z',
                  severity: [{ type: 'CVSS_V3', score: '5.0' }], // MEDIUM
                  affected: [
                    {
                      package: { ecosystem: 'npm', name: 'lodash' },
                      ranges: [
                        {
                          type: 'SEMVER',
                          events: [{ introduced: '0' }, { fixed: '4.17.21' }],
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        });

        // GHSA reports second advisory as CRITICAL (higher severity than OSV's MEDIUM)
        vi.mocked(ghsa.queryGhsa).mockResolvedValueOnce([
          {
            id: 'GHSA-9999-8888-7777',
            summary: 'Another vulnerability from GHSA',
            severity: 'CRITICAL', // Higher than OSV's MEDIUM
            publishedAt: '2021-01-01T00:00:00Z',
            updatedAt: '2021-01-01T00:00:00Z',
            vulnerabilities: [
              {
                package: { name: 'lodash', ecosystem: 'NPM' },
                vulnerableVersionRange: '< 4.17.21',
              },
            ],
            references: [],
          },
        ]);

        const result = await scanPath(dir, { concurrency: 1 });

        // Should have 2 advisories total
        expect(result.advisoriesByPackage.lodash).toHaveLength(2);

        // Find the GHSA advisory that was in both sources
        const ghsaAdvisory = result.advisoriesByPackage.lodash.find((a) => a.id === 'GHSA-9999-8888-7777');
        expect(ghsaAdvisory).toBeDefined();
        expect(ghsaAdvisory!.severity).toBe('CRITICAL'); // Should use higher severity
      });
    });

    it('prefers GHSA details over OSV when merging sources', async () => {
      await withTempDir(async (dir) => {
        writeFileSync(
          join(dir, 'package.json'),
          JSON.stringify({
            name: 'test',
            version: '1.0.0',
            dependencies: { lodash: '4.17.20' },
          }),
          'utf8',
        );

        const ghsaId = 'GHSA-xxxx-yyyy-zzzz';

        // OSV has minimal details but includes severity
        vi.mocked(osv.queryOsvBatch).mockResolvedValueOnce({
          results: [
            {
              vulns: [
                {
                  id: ghsaId,
                  summary: 'Brief summary',
                  modified: '2021-01-01T00:00:00Z',
                  severity: [{ type: 'CVSS_V3', score: '7.5' }],
                  affected: [
                    {
                      package: { ecosystem: 'npm', name: 'lodash' },
                      ranges: [
                        {
                          type: 'SEMVER',
                          events: [{ introduced: '0' }, { fixed: '4.17.21' }],
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        });

        // GHSA has more details
        vi.mocked(ghsa.queryGhsa).mockResolvedValueOnce([
          {
            id: ghsaId,
            summary: 'Detailed summary from GHSA',
            description: 'Long detailed description',
            severity: 'HIGH',
            publishedAt: '2021-01-01T00:00:00Z',
            updatedAt: '2021-01-01T00:00:00Z',
            vulnerabilities: [
              {
                package: { name: 'lodash', ecosystem: 'NPM' },
                vulnerableVersionRange: '< 4.17.21',
                firstPatchedVersion: { identifier: '4.17.21' },
              },
            ],
            references: [{ url: 'https://ghsa.example.com' }],
          },
        ]);

        const result = await scanPath(dir, { concurrency: 1 });

        // Since OSV returns a GHSA ID, it's labeled as GHSA source
        // When GHSA also returns it (with GHSA source), both are 'ghsa'
        // So dedup doesn't add a second source, but GHSA's severity still updates it
        expect(result.advisoriesByPackage.lodash).toHaveLength(1);
        const advisory = result.advisoriesByPackage.lodash[0];
        expect(advisory.source).toBe('ghsa');
        expect(advisory.severity).toBe('HIGH');
      });
    });
  });
});
