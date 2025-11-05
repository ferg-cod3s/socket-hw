import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { existsSync, readFileSync, writeFileSync, unlinkSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  loadIgnoreConfig,
  findIgnoreConfig,
  shouldIgnoreAdvisory,
  filterAdvisories,
  type IgnoreConfig,
} from '../../src/utils/ignore.js';
import type { UnifiedAdvisory } from '../../src/index.js';

describe('ignore utils', () => {
  let testDir: string;
  let testIgnoreFile: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `vuln-ignore-test-${Date.now()}`);
    testIgnoreFile = join(testDir, '.vuln-ignore.json');
    // Create test directory
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    // Cleanup test directory
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('loadIgnoreConfig', () => {
    it('should load valid ignore config', () => {
      const config: IgnoreConfig = {
        version: '1.0',
        ignores: [
          { id: 'CVE-2024-1234', reason: 'False positive' },
          { package: 'lodash', expires: '2025-12-31' },
        ],
      };

      writeFileSync(testIgnoreFile, JSON.stringify(config, null, 2), 'utf-8');

      const loaded = loadIgnoreConfig(testIgnoreFile);
      expect(loaded).toBeTruthy();
      expect(loaded?.ignores).toHaveLength(2);
    });

    it('should return null for missing file', () => {
      const loaded = loadIgnoreConfig('/nonexistent/file.json');
      expect(loaded).toBeNull();
    });

    it('should return null for invalid JSON', () => {
      writeFileSync(testIgnoreFile, 'invalid json', 'utf-8');
      const loaded = loadIgnoreConfig(testIgnoreFile);
      expect(loaded).toBeNull();
    });

    it('should return null for missing ignores array', () => {
      writeFileSync(testIgnoreFile, JSON.stringify({ version: '1.0' }), 'utf-8');
      const loaded = loadIgnoreConfig(testIgnoreFile);
      expect(loaded).toBeNull();
    });
  });

  describe('findIgnoreConfig', () => {
    it('should find ignore config in project directory', () => {
      const config: IgnoreConfig = { ignores: [] };
      writeFileSync(testIgnoreFile, JSON.stringify(config), 'utf-8');

      const found = findIgnoreConfig(testDir);
      expect(found).toBe(testIgnoreFile);
    });

    it('should use custom path if provided', () => {
      const customPath = join(testDir, 'custom-ignore.json');
      const config: IgnoreConfig = { ignores: [] };
      writeFileSync(customPath, JSON.stringify(config), 'utf-8');

      const found = findIgnoreConfig(testDir, customPath);
      expect(found).toBe(customPath);
    });

    it('should return null if no config found', () => {
      const found = findIgnoreConfig('/nonexistent/dir');
      expect(found).toBeNull();
    });
  });

  describe('shouldIgnoreAdvisory', () => {
    const advisory: UnifiedAdvisory = {
      id: 'GHSA-xxxx-xxxx-xxxx',
      source: 'ghsa',
      severity: 'HIGH',
      summary: 'Test advisory',
      cveIds: ['CVE-2024-1234'],
    };

    it('should ignore by advisory ID', () => {
      const config: IgnoreConfig = {
        ignores: [{ id: 'GHSA-xxxx-xxxx-xxxx' }],
      };

      const result = shouldIgnoreAdvisory(advisory, 'test-pkg', '1.0.0', config);
      expect(result).toBe(true);
    });

    it('should ignore by CVE ID', () => {
      const config: IgnoreConfig = {
        ignores: [{ id: 'CVE-2024-1234' }],
      };

      const result = shouldIgnoreAdvisory(advisory, 'test-pkg', '1.0.0', config);
      expect(result).toBe(true);
    });

    it('should ignore by package name', () => {
      const config: IgnoreConfig = {
        ignores: [{ package: 'test-pkg' }],
      };

      const result = shouldIgnoreAdvisory(advisory, 'test-pkg', '1.0.0', config);
      expect(result).toBe(true);
    });

    it('should ignore by package name and version', () => {
      const config: IgnoreConfig = {
        ignores: [{ package: 'test-pkg', packageVersion: '1.0.0' }],
      };

      const result = shouldIgnoreAdvisory(advisory, 'test-pkg', '1.0.0', config);
      expect(result).toBe(true);
    });

    it('should not ignore if package version does not match', () => {
      const config: IgnoreConfig = {
        ignores: [{ package: 'test-pkg', packageVersion: '2.0.0' }],
      };

      const result = shouldIgnoreAdvisory(advisory, 'test-pkg', '1.0.0', config);
      expect(result).toBe(false);
    });

    it('should ignore expired rules', () => {
      const config: IgnoreConfig = {
        ignores: [
          {
            id: 'GHSA-xxxx-xxxx-xxxx',
            expires: '2020-01-01', // Past date
          },
        ],
      };

      const result = shouldIgnoreAdvisory(advisory, 'test-pkg', '1.0.0', config);
      expect(result).toBe(false);
    });

    it('should not ignore if no rules match', () => {
      const config: IgnoreConfig = {
        ignores: [{ id: 'OTHER-ID' }],
      };

      const result = shouldIgnoreAdvisory(advisory, 'other-pkg', '1.0.0', config);
      expect(result).toBe(false);
    });

    it('should handle package@version format in rule.id', () => {
      const config: IgnoreConfig = {
        ignores: [{ id: 'test-pkg@1.0.0' }],
      };

      const result = shouldIgnoreAdvisory(advisory, 'test-pkg', '1.0.0', config);
      expect(result).toBe(true);
    });
  });

  describe('filterAdvisories', () => {
    const deps = [
      { name: 'lodash', version: '4.17.21' },
      { name: 'express', version: '4.18.0' },
    ];

    const advisoriesByPackage: Record<string, UnifiedAdvisory[]> = {
      'lodash@4.17.21': [
        {
          id: 'CVE-2024-1234',
          source: 'osv',
          severity: 'HIGH',
          summary: 'Lodash vulnerability',
          cveIds: ['CVE-2024-1234'],
        },
        {
          id: 'GHSA-xxxx',
          source: 'ghsa',
          severity: 'MEDIUM',
          summary: 'Lodash second vulnerability',
        },
      ],
      'express@4.18.0': [
        {
          id: 'CVE-2024-5678',
          source: 'osv',
          severity: 'CRITICAL',
          summary: 'Express vulnerability',
          cveIds: ['CVE-2024-5678'],
        },
      ],
    };

    it('should filter advisories by ignore rules', () => {
      const config: IgnoreConfig = {
        ignores: [
          { id: 'CVE-2024-1234' }, // Ignore first lodash vulnerability
          { package: 'express' }, // Ignore all express vulnerabilities
        ],
      };

      const filtered = filterAdvisories(advisoriesByPackage, deps, config);

      expect(filtered['lodash@4.17.21']).toHaveLength(1);
      expect(filtered['lodash@4.17.21']?.[0].id).toBe('GHSA-xxxx');
      expect(filtered['express@4.18.0']).toBeUndefined();
    });

    it('should return original if no ignore config', () => {
      const filtered = filterAdvisories(advisoriesByPackage, deps, null);
      expect(filtered).toEqual(advisoriesByPackage);
    });

    it('should remove package entries with no remaining advisories', () => {
      const config: IgnoreConfig = {
        ignores: [
          { id: 'CVE-2024-1234' },
          { id: 'GHSA-xxxx' },
        ],
      };

      const filtered = filterAdvisories(advisoriesByPackage, deps, config);

      expect(filtered['lodash@4.17.21']).toBeUndefined();
      expect(filtered['express@4.18.0']).toHaveLength(1);
    });
  });
});

