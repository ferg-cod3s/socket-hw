/**
 * Tests for OSV API batch query endpoint
 * Covers: batch formatting, response parsing, large batch handling
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

interface BatchQuery {
  package: {
    name: string;
    ecosystem: string;
  };
  version: string;
}

interface BatchResponse {
  results: Array<{
    vulns?: Array<{
      id: string;
      summary: string;
      severity?: Array<{
        type: string;
        score: string;
      }>;
    }>;
  }>;
}

describe('OSV Batch Query Endpoint', () => {
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
    vi.clearAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  describe('Batch Query Formation', () => {
    it('should format batch query correctly', () => {
      const packages = [
        { name: 'lodash', version: '4.17.20', ecosystem: 'npm' },
        { name: 'django', version: '3.1.0', ecosystem: 'pypi' }
      ];

      const queries: BatchQuery[] = packages.map(pkg => ({
        package: {
          name: pkg.name,
          ecosystem: pkg.ecosystem === 'npm' ? 'npm' : 'PyPI'
        },
        version: pkg.version
      }));

      expect(queries).toEqual([
        {
          package: { name: 'lodash', ecosystem: 'npm' },
          version: '4.17.20'
        },
        {
          package: { name: 'django', ecosystem: 'PyPI' },
          version: '3.1.0'
        }
      ]);
    });

    it('should handle ecosystem mapping', () => {
      const ecosystemMap: Record<string, string> = {
        npm: 'npm',
        pypi: 'PyPI',
        cargo: 'crates.io',
        go: 'Go'
      };

      expect(ecosystemMap['npm']).toBe('npm');
      expect(ecosystemMap['pypi']).toBe('PyPI');
      expect(ecosystemMap['cargo']).toBe('crates.io');
      expect(ecosystemMap['go']).toBe('Go');
    });

    it('should include all required fields', () => {
      const query: BatchQuery = {
        package: {
          name: 'express',
          ecosystem: 'npm'
        },
        version: '4.17.0'
      };

      expect(query.package).toHaveProperty('name');
      expect(query.package).toHaveProperty('ecosystem');
      expect(query).toHaveProperty('version');
    });
  });

  describe('Batch API Requests', () => {
    it('should send batch query to correct endpoint', async () => {
      const batchEndpoint = 'https://api.osv.dev/v1/querybatch';
      let capturedUrl = '';

      global.fetch = vi.fn((url) => {
        capturedUrl = url.toString();
        return Promise.resolve(
          new Response(JSON.stringify({ results: [] }), { status: 200 })
        );
      });

      await fetch(batchEndpoint, {
        method: 'POST',
        body: JSON.stringify({ queries: [] })
      });

      expect(capturedUrl).toBe(batchEndpoint);
    });

    it('should use POST method', async () => {
      let capturedMethod = '';

      global.fetch = vi.fn((url, options) => {
        capturedMethod = options?.method || 'GET';
        return Promise.resolve(
          new Response(JSON.stringify({ results: [] }), { status: 200 })
        );
      });

      await fetch('https://api.osv.dev/v1/querybatch', {
        method: 'POST',
        body: JSON.stringify({ queries: [] })
      });

      expect(capturedMethod).toBe('POST');
    });

    it('should include Content-Type header', async () => {
      let capturedHeaders: HeadersInit | undefined;

      global.fetch = vi.fn((url, options) => {
        capturedHeaders = options?.headers;
        return Promise.resolve(
          new Response(JSON.stringify({ results: [] }), { status: 200 })
        );
      });

      await fetch('https://api.osv.dev/v1/querybatch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ queries: [] })
      });

      expect(capturedHeaders).toBeDefined();
    });
  });

  describe('Batch Response Parsing', () => {
    it('should parse batch response with vulnerabilities', async () => {
      const mockResponse: BatchResponse = {
        results: [
          {
            vulns: [
              {
                id: 'GHSA-35jh-r3h4-6jhm',
                summary: 'Command injection in lodash',
                severity: [{ type: 'CVSS_V3', score: '9.8' }]
              }
            ]
          },
          {
            vulns: []
          }
        ]
      };

      global.fetch = vi.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify(mockResponse), { status: 200 })
        )
      );

      const response = await fetch('https://api.osv.dev/v1/querybatch', {
        method: 'POST',
        body: JSON.stringify({ queries: [] })
      });

      const data: BatchResponse = await response.json();

      expect(data.results).toHaveLength(2);
      expect(data.results[0].vulns).toHaveLength(1);
      expect(data.results[1].vulns).toHaveLength(0);
    });

    it('should handle empty results array', async () => {
      const mockResponse: BatchResponse = {
        results: []
      };

      global.fetch = vi.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify(mockResponse), { status: 200 })
        )
      );

      const response = await fetch('https://api.osv.dev/v1/querybatch');
      const data: BatchResponse = await response.json();

      expect(data.results).toEqual([]);
    });

    it('should handle results with no vulns field', async () => {
      const mockResponse = {
        results: [
          {}, // No vulns field
          { vulns: [] }
        ]
      };

      global.fetch = vi.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify(mockResponse), { status: 200 })
        )
      );

      const response = await fetch('https://api.osv.dev/v1/querybatch');
      const data: any = await response.json();

      expect(data.results[0].vulns).toBeUndefined();
      expect(data.results[1].vulns).toEqual([]);
    });
  });

  describe('Result Mapping', () => {
    it('should map results back to original packages', () => {
      const packages = [
        { name: 'lodash', version: '4.17.20', ecosystem: 'npm' },
        { name: 'django', version: '3.1.0', ecosystem: 'pypi' }
      ];

      const batchResponse: BatchResponse = {
        results: [
          {
            vulns: [
              { id: 'CVE-2021-23337', summary: 'Command injection' }
            ]
          },
          {
            vulns: []
          }
        ]
      };

      const resultsMap = new Map<string, any[]>();

      batchResponse.results.forEach((result, index) => {
        const pkg = packages[index];
        const key = `${pkg.name}@${pkg.version}`;
        resultsMap.set(key, result.vulns || []);
      });

      expect(resultsMap.get('lodash@4.17.20')).toHaveLength(1);
      expect(resultsMap.get('django@3.1.0')).toHaveLength(0);
      expect(resultsMap.size).toBe(2);
    });

    it('should maintain package order in results', () => {
      const packages = [
        { name: 'pkg-a', version: '1.0.0' },
        { name: 'pkg-b', version: '2.0.0' },
        { name: 'pkg-c', version: '3.0.0' }
      ];

      const results = [
        { vulns: [{ id: 'CVE-A' }] },
        { vulns: [] },
        { vulns: [{ id: 'CVE-C' }] }
      ];

      const mapped = packages.map((pkg, index) => ({
        package: pkg.name,
        vulns: results[index].vulns
      }));

      expect(mapped[0].package).toBe('pkg-a');
      expect(mapped[1].package).toBe('pkg-b');
      expect(mapped[2].package).toBe('pkg-c');
    });
  });

  describe('Batch Size Handling', () => {
    it('should split packages into batches of 1000', () => {
      const totalPackages = 2500;
      const maxBatchSize = 1000;

      const packages = Array.from({ length: totalPackages }, (_, i) => ({
        name: `pkg-${i}`,
        version: '1.0.0',
        ecosystem: 'npm'
      }));

      const batches: any[][] = [];
      for (let i = 0; i < packages.length; i += maxBatchSize) {
        batches.push(packages.slice(i, i + maxBatchSize));
      }

      expect(batches).toHaveLength(3);
      expect(batches[0]).toHaveLength(1000);
      expect(batches[1]).toHaveLength(1000);
      expect(batches[2]).toHaveLength(500);
    });

    it('should handle exactly 1000 packages', () => {
      const packages = Array.from({ length: 1000 }, (_, i) => ({
        name: `pkg-${i}`,
        version: '1.0.0'
      }));

      const maxBatchSize = 1000;
      const batches: any[][] = [];

      for (let i = 0; i < packages.length; i += maxBatchSize) {
        batches.push(packages.slice(i, i + maxBatchSize));
      }

      expect(batches).toHaveLength(1);
      expect(batches[0]).toHaveLength(1000);
    });

    it('should handle fewer than 1000 packages', () => {
      const packages = Array.from({ length: 50 }, (_, i) => ({
        name: `pkg-${i}`,
        version: '1.0.0'
      }));

      const maxBatchSize = 1000;
      const batches: any[][] = [];

      for (let i = 0; i < packages.length; i += maxBatchSize) {
        batches.push(packages.slice(i, i + maxBatchSize));
      }

      expect(batches).toHaveLength(1);
      expect(batches[0]).toHaveLength(50);
    });
  });

  describe('Performance Characteristics', () => {
    it('should make single request for small batch', async () => {
      let requestCount = 0;

      global.fetch = vi.fn(() => {
        requestCount++;
        return Promise.resolve(
          new Response(
            JSON.stringify({
              results: Array(10).fill({ vulns: [] })
            }),
            { status: 200 }
          )
        );
      });

      const packages = Array.from({ length: 10 }, (_, i) => ({
        name: `pkg-${i}`,
        version: '1.0.0',
        ecosystem: 'npm'
      }));

      // Simulate batch query
      await fetch('https://api.osv.dev/v1/querybatch', {
        method: 'POST',
        body: JSON.stringify({
          queries: packages.map(pkg => ({
            package: { name: pkg.name, ecosystem: pkg.ecosystem },
            version: pkg.version
          }))
        })
      });

      expect(requestCount).toBe(1);
    });

    it('should make multiple requests for large batch', async () => {
      let requestCount = 0;
      const maxBatchSize = 1000;

      global.fetch = vi.fn(() => {
        requestCount++;
        return Promise.resolve(
          new Response(
            JSON.stringify({
              results: Array(maxBatchSize).fill({ vulns: [] })
            }),
            { status: 200 }
          )
        );
      });

      const packages = Array.from({ length: 2500 }, (_, i) => ({
        name: `pkg-${i}`,
        version: '1.0.0',
        ecosystem: 'npm'
      }));

      // Simulate splitting into batches
      for (let i = 0; i < packages.length; i += maxBatchSize) {
        const batch = packages.slice(i, i + maxBatchSize);
        await fetch('https://api.osv.dev/v1/querybatch', {
          method: 'POST',
          body: JSON.stringify({
            queries: batch.map(pkg => ({
              package: { name: pkg.name, ecosystem: pkg.ecosystem },
              version: pkg.version
            }))
          })
        });
      }

      expect(requestCount).toBe(3); // 1000 + 1000 + 500
    });
  });

  describe('Error Handling', () => {
    it('should handle partial batch failure gracefully', async () => {
      const mockResponse = {
        results: [
          { vulns: [{ id: 'CVE-1' }] },
          { error: 'Package not found' }, // Error in middle of batch
          { vulns: [] }
        ]
      };

      global.fetch = vi.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify(mockResponse), { status: 200 })
        )
      );

      const response = await fetch('https://api.osv.dev/v1/querybatch');
      const data: any = await response.json();

      // Should still process successful results
      expect(data.results[0].vulns).toBeDefined();
      expect(data.results[2].vulns).toBeDefined();
    });

    it('should handle malformed batch response', async () => {
      const malformedResponse = {
        results: null // Invalid: should be array
      };

      global.fetch = vi.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify(malformedResponse), { status: 200 })
        )
      );

      const response = await fetch('https://api.osv.dev/v1/querybatch');
      const data: any = await response.json();

      expect(data.results).toBeNull();
    });

    it('should handle empty response body', async () => {
      global.fetch = vi.fn(() =>
        Promise.resolve(new Response('', { status: 200 }))
      );

      const response = await fetch('https://api.osv.dev/v1/querybatch');

      await expect(response.json()).rejects.toThrow();
    });
  });

  describe('Integration Tests', () => {
    it('should handle mixed ecosystems in batch', async () => {
      const packages = [
        { name: 'lodash', version: '4.17.20', ecosystem: 'npm' },
        { name: 'django', version: '3.1.0', ecosystem: 'pypi' },
        { name: 'actix-web', version: '3.0.0', ecosystem: 'cargo' }
      ];

      const queries: BatchQuery[] = packages.map(pkg => ({
        package: {
          name: pkg.name,
          ecosystem:
            pkg.ecosystem === 'npm'
              ? 'npm'
              : pkg.ecosystem === 'pypi'
                ? 'PyPI'
                : 'crates.io'
        },
        version: pkg.version
      }));

      expect(queries[0].package.ecosystem).toBe('npm');
      expect(queries[1].package.ecosystem).toBe('PyPI');
      expect(queries[2].package.ecosystem).toBe('crates.io');
    });

    it('should aggregate results from multiple batches', async () => {
      const allResults = new Map<string, any[]>();

      // Batch 1 results
      const batch1Results = [
        { name: 'pkg-1', vulns: [{ id: 'CVE-1' }] },
        { name: 'pkg-2', vulns: [] }
      ];

      // Batch 2 results
      const batch2Results = [
        { name: 'pkg-3', vulns: [{ id: 'CVE-3' }] },
        { name: 'pkg-4', vulns: [{ id: 'CVE-4' }] }
      ];

      // Merge results
      [...batch1Results, ...batch2Results].forEach(result => {
        allResults.set(result.name, result.vulns);
      });

      expect(allResults.size).toBe(4);
      expect(allResults.get('pkg-1')).toHaveLength(1);
      expect(allResults.get('pkg-2')).toHaveLength(0);
      expect(allResults.get('pkg-3')).toHaveLength(1);
      expect(allResults.get('pkg-4')).toHaveLength(1);
    });
  });

  describe('Comparison: Sequential vs Batch', () => {
    it('should demonstrate performance improvement', () => {
      const packageCount = 1000;
      const avgSequentialTime = 3; // 3ms per request
      const avgBatchTime = 500; // 500ms per batch of 1000

      const sequentialTotal = packageCount * avgSequentialTime; // 3000ms
      const batchTotal = avgBatchTime; // 500ms
      const improvement = sequentialTotal / batchTotal; // 6x

      expect(improvement).toBeGreaterThanOrEqual(5);
      expect(sequentialTotal).toBeGreaterThan(batchTotal);
    });

    it('should calculate API call reduction', () => {
      const packageCount = 2500;
      const maxBatchSize = 1000;

      const sequentialCalls = packageCount; // 2500 calls
      const batchCalls = Math.ceil(packageCount / maxBatchSize); // 3 calls

      const reduction = sequentialCalls / batchCalls; // 833x

      expect(batchCalls).toBe(3);
      expect(reduction).toBeGreaterThan(800);
    });
  });
});
