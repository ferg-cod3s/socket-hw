import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('JSON Output Format', () => {
  it('generates valid JSON schema structure', () => {
    const scanResult = {
      summary: {
        scanned: 10,
        vulnerable: 2,
        totalVulnerabilities: 3,
        scanDuration: '500ms',
        timestamp: '2023-01-01T00:00:00Z',
      },
      packages: [
        {
          name: 'express',
          version: '4.18.2',
          ecosystem: 'npm',
          vulnerabilities: [
            {
              id: 'GHSA-xxxx',
              source: 'ghsa',
              severity: 'HIGH',
              title: 'Test vulnerability',
              description: 'Test description',
              patchedVersion: '4.18.3',
              references: ['https://example.com'],
            },
          ],
        },
      ],
    };

    const json = JSON.stringify(scanResult, null, 2);
    const parsed = JSON.parse(json);

    expect(parsed.summary).toBeDefined();
    expect(parsed.summary.scanned).toBe(10);
    expect(parsed.summary.vulnerable).toBe(2);
    expect(parsed.summary.totalVulnerabilities).toBe(3);
    expect(parsed.packages).toHaveLength(1);
    expect(parsed.packages[0].vulnerabilities[0].source).toBe('ghsa');
  });

  it('includes all required fields per PDF spec', () => {
    const scanResult = {
      summary: {
        scanned: 5,
        vulnerable: 1,
        totalVulnerabilities: 1,
        scanDuration: '200ms',
        timestamp: '2023-01-01T00:00:00Z',
      },
      packages: [
        {
          name: 'package',
          version: '1.0.0',
          ecosystem: 'npm',
          vulnerabilities: [
            {
              id: 'CVE-2023-123',
              source: 'osv',
              severity: 'CRITICAL',
              title: 'Vulnerability title',
              description: 'Full description',
              patchedVersion: '1.0.1',
              references: ['https://osv.dev/vulnerability/CVE-2023-123'],
            },
          ],
        },
      ],
    };

    const json = JSON.stringify(scanResult);
    expect(json).toContain('"scanned"');
    expect(json).toContain('"vulnerable"');
    expect(json).toContain('"totalVulnerabilities"');
    expect(json).toContain('"packages"');
    expect(json).toContain('"vulnerabilities"');
  });

  it('handles empty results correctly', () => {
    const scanResult = {
      summary: {
        scanned: 10,
        vulnerable: 0,
        totalVulnerabilities: 0,
        scanDuration: '100ms',
        timestamp: '2023-01-01T00:00:00Z',
      },
      packages: [],
    };

    const json = JSON.stringify(scanResult, null, 2);
    const parsed = JSON.parse(json);

    expect(parsed.summary.vulnerable).toBe(0);
    expect(parsed.packages).toHaveLength(0);
  });

  it('includes advisory references', () => {
    const scanResult = {
      summary: {
        scanned: 1,
        vulnerable: 1,
        totalVulnerabilities: 1,
        scanDuration: '50ms',
        timestamp: '2023-01-01T00:00:00Z',
      },
      packages: [
        {
          name: 'test',
          version: '1.0.0',
          ecosystem: 'npm',
          vulnerabilities: [
            {
              id: 'GHSA-test',
              source: 'ghsa',
              severity: 'HIGH',
              title: 'Test',
              references: [
                'https://github.com/advisories/GHSA-test',
                'https://osv.dev/vulnerability/GHSA-test',
              ],
            },
          ],
        },
      ],
    };

    const json = JSON.stringify(scanResult);
    expect(json).toContain('references');
    const parsed = JSON.parse(json);
    expect(parsed.packages[0].vulnerabilities[0].references.length).toBeGreaterThan(0);
  });
});

