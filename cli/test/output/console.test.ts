import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { UnifiedAdvisory } from '../../src/index.js';
import type { Dependency } from '../../src/providers/index.js';
import type { MaintenanceInfo } from '../../src/utils/maintenance.js';
import { formatConsoleOutput } from '../../src/output/console.js';

describe('output/console', () => {
  let consoleLogSpy: any;

  beforeEach(() => {
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
  });

  describe('formatConsoleOutput - no vulnerabilities', () => {
    it('displays success message when no vulnerabilities found', () => {
      const deps: Dependency[] = [
        { name: 'lodash', version: '4.17.21', ecosystem: 'npm', dev: false },
        { name: 'express', version: '4.18.0', ecosystem: 'npm', dev: false },
      ];
      const vulns = {};
      const scanDuration = 1234;

      formatConsoleOutput(deps, vulns, scanDuration);

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('No vulnerabilities found in 2 packages')
      );
    });

    it('handles singular package count', () => {
      const deps: Dependency[] = [
        { name: 'lodash', version: '4.17.21', ecosystem: 'npm', dev: false },
      ];
      const vulns = {};
      const scanDuration = 500;

      formatConsoleOutput(deps, vulns, scanDuration);

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('No vulnerabilities found in 1 packages')
      );
    });

    it('handles empty dependency list', () => {
      const deps: Dependency[] = [];
      const vulns = {};
      const scanDuration = 100;

      formatConsoleOutput(deps, vulns, scanDuration);

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('No vulnerabilities found in 0 packages')
      );
    });
  });

  describe('formatConsoleOutput - with vulnerabilities', () => {
    it('displays vulnerability summary', () => {
      const deps: Dependency[] = [
        { name: 'lodash', version: '4.17.20', ecosystem: 'npm', dev: false },
      ];

      const vulns: Record<string, UnifiedAdvisory[]> = {
        lodash: [
          {
            id: 'CVE-2021-12345',
            source: 'osv',
            severity: 'HIGH',
            summary: 'Test vulnerability',
            details: 'This is a test vulnerability',
            references: ['https://example.com/advisory'],
            firstPatchedVersion: '4.17.21',
            cveIds: ['CVE-2021-12345'],
          },
        ],
      };

      formatConsoleOutput(deps, vulns, 1000);

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('Found 1 vulnerability in 1 package')
      );
    });

    it('handles plural vulnerabilities and packages', () => {
      const deps: Dependency[] = [
        { name: 'lodash', version: '4.17.20', ecosystem: 'npm', dev: false },
        { name: 'express', version: '4.0.0', ecosystem: 'npm', dev: false },
      ];

      const vulns: Record<string, UnifiedAdvisory[]> = {
        lodash: [
          {
            id: 'CVE-2021-1',
            source: 'osv',
            severity: 'HIGH',
            summary: 'Vuln 1',
          },
          {
            id: 'CVE-2021-2',
            source: 'ghsa',
            severity: 'MEDIUM',
            summary: 'Vuln 2',
          },
        ],
        express: [
          {
            id: 'CVE-2021-3',
            source: 'osv',
            severity: 'LOW',
            summary: 'Vuln 3',
          },
        ],
      };

      formatConsoleOutput(deps, vulns, 1500);

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('Found 3 vulnerabilities in 2 packages')
      );
    });

    it('displays package name with version', () => {
      const deps: Dependency[] = [
        { name: 'lodash', version: '4.17.20', ecosystem: 'npm', dev: false },
      ];

      const vulns: Record<string, UnifiedAdvisory[]> = {
        lodash: [
          {
            id: 'CVE-2021-12345',
            source: 'osv',
            severity: 'HIGH',
            summary: 'Test',
          },
        ],
      };

      formatConsoleOutput(deps, vulns, 1000);

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('lodash@4.17.20'));
    });

    it('displays unknown version for packages not in dependency list', () => {
      const deps: Dependency[] = [
        { name: 'lodash', version: '4.17.20', ecosystem: 'npm', dev: false },
      ];

      const vulns: Record<string, UnifiedAdvisory[]> = {
        'other-package': [
          {
            id: 'CVE-2021-12345',
            source: 'osv',
            severity: 'HIGH',
            summary: 'Test',
          },
        ],
      };

      formatConsoleOutput(deps, vulns, 1000);

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('other-package@unknown'));
    });
  });

  describe('formatConsoleOutput - vulnerability details', () => {
    it('displays advisory ID and severity', () => {
      const deps: Dependency[] = [
        { name: 'lodash', version: '4.17.20', ecosystem: 'npm', dev: false },
      ];

      const vulns: Record<string, UnifiedAdvisory[]> = {
        lodash: [
          {
            id: 'CVE-2021-12345',
            source: 'osv',
            severity: 'CRITICAL',
            summary: 'Critical bug',
          },
        ],
      };

      formatConsoleOutput(deps, vulns, 1000);

      const allCalls = consoleLogSpy.mock.calls.map((call: any) => call[0]).join('\n');
      expect(allCalls).toContain('CVE-2021-12345');
      expect(allCalls).toContain('CRITICAL');
    });

    it('displays summary title and advisory ID separately when summary differs', () => {
      const deps: Dependency[] = [
        { name: 'lodash', version: '4.17.20', ecosystem: 'npm', dev: false },
      ];

      const vulns: Record<string, UnifiedAdvisory[]> = {
        lodash: [
          {
            id: 'GHSA-aaaa-bbbb-cccc',
            source: 'ghsa',
            severity: 'HIGH',
            summary: 'Remote code execution vulnerability',
          },
        ],
      };

      formatConsoleOutput(deps, vulns, 1000);

      const allCalls = consoleLogSpy.mock.calls.map((call: any) => call[0]).join('\n');
      expect(allCalls).toContain('Remote code execution vulnerability');
      expect(allCalls).toContain('Advisory ID: GHSA-aaaa-bbbb-cccc');
    });

    it('falls back to advisory ID as title when summary missing', () => {
      const deps: Dependency[] = [
        { name: 'lodash', version: '4.17.20', ecosystem: 'npm', dev: false },
      ];

      const vulns: Record<string, UnifiedAdvisory[]> = {
        lodash: [
          {
            id: 'GHSA-dddd-eeee-ffff',
            source: 'ghsa',
            severity: 'HIGH',
          },
        ],
      };

      formatConsoleOutput(deps, vulns, 1000);

      const allCalls = consoleLogSpy.mock.calls.map((call: any) => call[0]).join('\n');
      expect(allCalls).toContain('GHSA-dddd-eeee-ffff');
      expect(allCalls).not.toContain('Advisory ID: GHSA-dddd-eeee-ffff');
    });

    it('displays OSV source label', () => {
      const deps: Dependency[] = [
        { name: 'lodash', version: '4.17.20', ecosystem: 'npm', dev: false },
      ];

      const vulns: Record<string, UnifiedAdvisory[]> = {
        lodash: [
          {
            id: 'OSV-2021-123',
            source: 'osv',
            severity: 'HIGH',
            summary: 'Test',
          },
        ],
      };

      formatConsoleOutput(deps, vulns, 1000);

      const allCalls = consoleLogSpy.mock.calls.map((call: any) => call[0]).join('\n');
      expect(allCalls).toContain('OSV');
    });

    it('displays GHSA source label', () => {
      const deps: Dependency[] = [
        { name: 'lodash', version: '4.17.20', ecosystem: 'npm', dev: false },
      ];

      const vulns: Record<string, UnifiedAdvisory[]> = {
        lodash: [
          {
            id: 'GHSA-xxxx-yyyy-zzzz',
            source: 'ghsa',
            severity: 'HIGH',
            summary: 'Test',
          },
        ],
      };

      formatConsoleOutput(deps, vulns, 1000);

      const allCalls = consoleLogSpy.mock.calls.map((call: any) => call[0]).join('\n');
      expect(allCalls).toContain('GHSA');
    });

    it('displays CVE IDs when available', () => {
      const deps: Dependency[] = [
        { name: 'lodash', version: '4.17.20', ecosystem: 'npm', dev: false },
      ];

      const vulns: Record<string, UnifiedAdvisory[]> = {
        lodash: [
          {
            id: 'GHSA-xxxx',
            source: 'ghsa',
            severity: 'HIGH',
            summary: 'Test',
            cveIds: ['CVE-2021-12345', 'CVE-2021-67890'],
          },
        ],
      };

      formatConsoleOutput(deps, vulns, 1000);

      const allCalls = consoleLogSpy.mock.calls.map((call: any) => call[0]).join('\n');
      expect(allCalls).toContain('CVE IDs: CVE-2021-12345, CVE-2021-67890');
    });

    it('does not display CVE IDs section when empty', () => {
      const deps: Dependency[] = [
        { name: 'lodash', version: '4.17.20', ecosystem: 'npm', dev: false },
      ];

      const vulns: Record<string, UnifiedAdvisory[]> = {
        lodash: [
          {
            id: 'OSV-123',
            source: 'osv',
            severity: 'HIGH',
            summary: 'Test',
            cveIds: [],
          },
        ],
      };

      formatConsoleOutput(deps, vulns, 1000);

      const allCalls = consoleLogSpy.mock.calls.map((call: any) => call[0]).join('\n');
      expect(allCalls).not.toContain('CVE IDs:');
    });

    it('displays vulnerability summary as title and description', () => {
      const deps: Dependency[] = [
        { name: 'lodash', version: '4.17.20', ecosystem: 'npm', dev: false },
      ];

      const vulns: Record<string, UnifiedAdvisory[]> = {
        lodash: [
          {
            id: 'CVE-2021-123',
            source: 'osv',
            severity: 'HIGH',
            summary: 'Test summary',
            details: 'This is a detailed description of the vulnerability.',
          },
        ],
      };

      formatConsoleOutput(deps, vulns, 1000);

      const allCalls = consoleLogSpy.mock.calls.map((call: any) => call[0]).join('\n');
      expect(allCalls).toContain('Title: Test summary');
      expect(allCalls).toContain('Description: This is a detailed description');
    });

    it('falls back to advisory id when summary missing', () => {
      const deps: Dependency[] = [
        { name: 'lodash', version: '4.17.20', ecosystem: 'npm', dev: false },
      ];

      const vulns: Record<string, UnifiedAdvisory[]> = {
        lodash: [
          {
            id: 'CVE-2021-456',
            source: 'osv',
            severity: 'MEDIUM',
            details: 'Fallback description',
          },
        ],
      };

      formatConsoleOutput(deps, vulns, 1000);

      const allCalls = consoleLogSpy.mock.calls.map((call: any) => call[0]).join('\n');
      expect(allCalls).toContain('Title: CVE-2021-456');
    });

    it('truncates long descriptions to 200 characters', () => {
      const deps: Dependency[] = [
        { name: 'lodash', version: '4.17.20', ecosystem: 'npm', dev: false },
      ];

      const longDescription = 'A'.repeat(250);
      const vulns: Record<string, UnifiedAdvisory[]> = {
        lodash: [
          {
            id: 'CVE-2021-123',
            source: 'osv',
            severity: 'HIGH',
            summary: 'Test',
            details: longDescription,
          },
        ],
      };

      formatConsoleOutput(deps, vulns, 1000);

      const allCalls = consoleLogSpy.mock.calls.map((call: any) => call[0]).join('\n');
      expect(allCalls).toContain('...');
      expect(allCalls).not.toContain(longDescription);
    });

    it('displays first patched version when available', () => {
      const deps: Dependency[] = [
        { name: 'lodash', version: '4.17.20', ecosystem: 'npm', dev: false },
      ];

      const vulns: Record<string, UnifiedAdvisory[]> = {
        lodash: [
          {
            id: 'CVE-2021-123',
            source: 'osv',
            severity: 'HIGH',
            summary: 'Test',
            firstPatchedVersion: '4.17.21',
          },
        ],
      };

      formatConsoleOutput(deps, vulns, 1000);

      const allCalls = consoleLogSpy.mock.calls.map((call: any) => call[0]).join('\n');
      expect(allCalls).toContain('Fix available: upgrade to 4.17.21');
    });

    it('displays advisory link when references available', () => {
      const deps: Dependency[] = [
        { name: 'lodash', version: '4.17.20', ecosystem: 'npm', dev: false },
      ];

      const vulns: Record<string, UnifiedAdvisory[]> = {
        lodash: [
          {
            id: 'CVE-2021-123',
            source: 'osv',
            severity: 'HIGH',
            summary: 'Test',
            references: ['https://example.com/advisory', 'https://example.com/other'],
          },
        ],
      };

      formatConsoleOutput(deps, vulns, 1000);

      const allCalls = consoleLogSpy.mock.calls.map((call: any) => call[0]).join('\n');
      // Should display first reference
      expect(allCalls).toContain('Advisory: https://example.com/advisory');
    });

    it('handles missing optional fields', () => {
      const deps: Dependency[] = [
        { name: 'lodash', version: '4.17.20', ecosystem: 'npm', dev: false },
      ];

      const vulns: Record<string, UnifiedAdvisory[]> = {
        lodash: [
          {
            id: 'CVE-2021-123',
            source: 'osv',
            severity: 'HIGH',
            summary: 'Minimal advisory',
            // No details, references, firstPatchedVersion, cveIds
          },
        ],
      };

      // Should not throw
      expect(() => formatConsoleOutput(deps, vulns, 1000)).not.toThrow();
    });
  });

  describe('formatConsoleOutput - severity colors', () => {
    it('applies different colors for different severity levels', () => {
      const deps: Dependency[] = [
        { name: 'pkg1', version: '1.0.0', ecosystem: 'npm', dev: false },
        { name: 'pkg2', version: '1.0.0', ecosystem: 'npm', dev: false },
        { name: 'pkg3', version: '1.0.0', ecosystem: 'npm', dev: false },
        { name: 'pkg4', version: '1.0.0', ecosystem: 'npm', dev: false },
        { name: 'pkg5', version: '1.0.0', ecosystem: 'npm', dev: false },
      ];

      const vulns: Record<string, UnifiedAdvisory[]> = {
        pkg1: [{ id: 'CRIT', source: 'osv', severity: 'CRITICAL', summary: 'Test' }],
        pkg2: [{ id: 'HIGH', source: 'osv', severity: 'HIGH', summary: 'Test' }],
        pkg3: [{ id: 'MED', source: 'osv', severity: 'MEDIUM', summary: 'Test' }],
        pkg4: [{ id: 'MOD', source: 'osv', severity: 'MODERATE', summary: 'Test' }],
        pkg5: [{ id: 'LOW', source: 'osv', severity: 'LOW', summary: 'Test' }],
      };

      // Should not throw and should handle all severity levels
      expect(() => formatConsoleOutput(deps, vulns, 1000)).not.toThrow();
    });

    it('handles unknown severity level', () => {
      const deps: Dependency[] = [
        { name: 'lodash', version: '4.17.20', ecosystem: 'npm', dev: false },
      ];

      const vulns: Record<string, UnifiedAdvisory[]> = {
        lodash: [
          {
            id: 'UNKNOWN-SEV',
            source: 'osv',
            severity: 'UNKNOWN',
            summary: 'Test',
          },
        ],
      };

      expect(() => formatConsoleOutput(deps, vulns, 1000)).not.toThrow();
    });
  });

  describe('formatConsoleOutput - maintenance info', () => {
    it('displays unmaintained packages section', () => {
      const deps: Dependency[] = [
        { name: 'old-package', version: '1.0.0', ecosystem: 'npm', dev: false },
        { name: 'current-package', version: '2.0.0', ecosystem: 'npm', dev: false },
      ];

      const vulns: Record<string, UnifiedAdvisory[]> = {
        'old-package': [
          {
            id: 'CVE-2021-999',
            source: 'osv',
            severity: 'LOW',
            summary: 'Test vuln',
          },
        ],
      };

      const maintenanceInfo = new Map<string, MaintenanceInfo>([
        [
          'old-package',
          {
            package: 'old-package',
            ecosystem: 'npm',
            isUnmaintained: true,
            daysSinceLastRelease: 450,
            downloads: { weekly: 1234 },
          },
        ],
        [
          'current-package',
          {
            package: 'current-package',
            ecosystem: 'npm',
            isUnmaintained: false,
            daysSinceLastRelease: 30,
          },
        ],
      ]);

      formatConsoleOutput(deps, vulns, 1000, maintenanceInfo);

      const allCalls = consoleLogSpy.mock.calls.map((call: any) => call[0]).join('\n');
      expect(allCalls).toContain('Unmaintained Packages (1)');
      expect(allCalls).toContain('old-package');
      expect(allCalls).toContain('450 days ago');
    });

    it('displays weekly download count when available', () => {
      const deps: Dependency[] = [
        { name: 'old-package', version: '1.0.0', ecosystem: 'npm', dev: false },
      ];

      const vulns: Record<string, UnifiedAdvisory[]> = {
        'old-package': [
          {
            id: 'CVE-2021-888',
            source: 'osv',
            severity: 'LOW',
            summary: 'Test',
          },
        ],
      };

      const maintenanceInfo = new Map<string, MaintenanceInfo>([
        [
          'old-package',
          {
            package: 'old-package',
            ecosystem: 'npm',
            isUnmaintained: true,
            daysSinceLastRelease: 400,
            downloads: { weekly: 5678 },
          },
        ],
      ]);

      formatConsoleOutput(deps, vulns, 1000, maintenanceInfo);

      const allCalls = consoleLogSpy.mock.calls.map((call: any) => call[0]).join('\n');
      expect(allCalls).toContain('Weekly downloads: 5,678');
    });

    it('handles unmaintained package without daysSinceLastRelease', () => {
      const deps: Dependency[] = [
        { name: 'unknown-age', version: '1.0.0', ecosystem: 'npm', dev: false },
      ];

      const vulns: Record<string, UnifiedAdvisory[]> = {
        'unknown-age': [
          {
            id: 'CVE-2021-777',
            source: 'osv',
            severity: 'LOW',
            summary: 'Test',
          },
        ],
      };

      const maintenanceInfo = new Map<string, MaintenanceInfo>([
        [
          'unknown-age',
          {
            package: 'unknown-age',
            ecosystem: 'npm',
            isUnmaintained: true,
          },
        ],
      ]);

      formatConsoleOutput(deps, vulns, 1000, maintenanceInfo);

      const allCalls = consoleLogSpy.mock.calls.map((call: any) => call[0]).join('\n');
      expect(allCalls).toContain('unknown');
    });

    it('does not display maintenance section when no unmaintained packages', () => {
      const deps: Dependency[] = [
        { name: 'current-package', version: '1.0.0', ecosystem: 'npm', dev: false },
      ];

      const vulns = {};

      const maintenanceInfo = new Map<string, MaintenanceInfo>([
        [
          'current-package',
          {
            package: 'current-package',
            ecosystem: 'npm',
            isUnmaintained: false,
            daysSinceLastRelease: 30,
          },
        ],
      ]);

      formatConsoleOutput(deps, vulns, 1000, maintenanceInfo);

      const allCalls = consoleLogSpy.mock.calls.map((call: any) => call[0]).join('\n');
      expect(allCalls).not.toContain('Unmaintained Packages');
    });

    it('handles empty maintenance info map', () => {
      const deps: Dependency[] = [
        { name: 'test-package', version: '1.0.0', ecosystem: 'npm', dev: false },
      ];

      const vulns = {};
      const maintenanceInfo = new Map<string, MaintenanceInfo>();

      expect(() => formatConsoleOutput(deps, vulns, 1000, maintenanceInfo)).not.toThrow();
    });

    it('handles undefined maintenance info', () => {
      const deps: Dependency[] = [
        { name: 'test-package', version: '1.0.0', ecosystem: 'npm', dev: false },
      ];

      const vulns = {};

      expect(() => formatConsoleOutput(deps, vulns, 1000, undefined)).not.toThrow();
    });
  });

  describe('formatConsoleOutput - multiple vulnerabilities per package', () => {
    it('displays all vulnerabilities for a package', () => {
      const deps: Dependency[] = [
        { name: 'lodash', version: '4.17.20', ecosystem: 'npm', dev: false },
      ];

      const vulns: Record<string, UnifiedAdvisory[]> = {
        lodash: [
          {
            id: 'CVE-2021-1',
            source: 'osv',
            severity: 'HIGH',
            summary: 'First vuln',
          },
          {
            id: 'CVE-2021-2',
            source: 'ghsa',
            severity: 'MEDIUM',
            summary: 'Second vuln',
          },
          {
            id: 'CVE-2021-3',
            source: 'osv',
            severity: 'LOW',
            summary: 'Third vuln',
          },
        ],
      };

      formatConsoleOutput(deps, vulns, 1000);

      const allCalls = consoleLogSpy.mock.calls.map((call: any) => call[0]).join('\n');
      expect(allCalls).toContain('CVE-2021-1');
      expect(allCalls).toContain('CVE-2021-2');
      expect(allCalls).toContain('CVE-2021-3');
    });

    it('skips packages with empty vulnerability arrays', () => {
      const deps: Dependency[] = [
        { name: 'lodash', version: '4.17.20', ecosystem: 'npm', dev: false },
      ];

      const vulns: Record<string, UnifiedAdvisory[]> = {
        lodash: [],
      };

      formatConsoleOutput(deps, vulns, 1000);

      const allCalls = consoleLogSpy.mock.calls.map((call: any) => call[0]).join('\n');
      expect(allCalls).toContain('No vulnerabilities found');
    });
  });
});
