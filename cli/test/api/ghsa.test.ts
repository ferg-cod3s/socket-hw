import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

declare const global: any;

// Hoist mocks before imports
const mockFetch = vi.hoisted(() => vi.fn());
const mockGetGitHubToken = vi.hoisted(() => vi.fn());

vi.mock('../../src/utils/auth.js', () => ({
  getGitHubToken: mockGetGitHubToken,
}));

global.fetch = mockFetch;

describe('GHSA API Client', () => {
  let queryGhsa: any;

  beforeEach(async () => {
    vi.resetModules();
    mockFetch.mockClear();
    mockGetGitHubToken.mockClear();

    ({ queryGhsa } = await import('../../src/api/ghsa.js'));
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('queryGhsa', () => {
    it('queries securityVulnerabilities and maps response', async () => {
      mockGetGitHubToken.mockReturnValue('test-token');

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          data: {
            securityVulnerabilities: {
              nodes: [
                {
                  advisory: {
                    ghsaId: 'GHSA-xxxx-yyyy-zzzz',
                    summary: 'Test',
                    description: 'Desc',
                    severity: 'LOW',
                    references: [{ url: 'https://example.com' }],
                    cvss: { score: 1.0, vectorString: 'AV:N' },
                    publishedAt: '2020-01-01T00:00:00Z',
                    updatedAt: '2020-01-02T00:00:00Z',
                  },
                  package: { name: 'chalk', ecosystem: 'NPM' },
                  vulnerableVersionRange: '<=1.0.0',
                  firstPatchedVersion: { identifier: '1.0.1' },
                },
              ],
              pageInfo: { hasNextPage: false, endCursor: null },
            },
          },
        }),
      });

      const res = await queryGhsa({ ecosystem: 'npm', packageName: 'chalk' });
      expect(res).toHaveLength(1);
      expect(res[0].id).toBe('GHSA-xxxx-yyyy-zzzz');
      expect(res[0].vulnerabilities[0].vulnerableVersionRange).toBe('<=1.0.0');
    });

    it('queries GHSA API successfully', async () => {
      mockGetGitHubToken.mockReturnValue('test-token');

      const mockResponse = {
        data: {
          securityVulnerabilities: {
            nodes: [
              {
                advisory: {
                  ghsaId: 'GHSA-xxxx-xxxx-xxxx',
                  summary: 'Test vulnerability',
                  description: 'Test description',
                  severity: 'HIGH',
                  publishedAt: '2023-01-01T00:00:00Z',
                  updatedAt: '2023-01-02T00:00:00Z',
                  references: [{ url: 'https://github.com/advisories/GHSA-xxxx' }],
                  cvss: { score: 7.5, vectorString: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:N/A:N' },
                },
                package: { name: 'express', ecosystem: 'NPM' },
                vulnerableVersionRange: '>=4.0.0 <4.18.2',
                firstPatchedVersion: { identifier: '4.18.2' },
              },
            ],
            pageInfo: {
              hasNextPage: false,
              endCursor: null,
            },
          },
        },
      };

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => mockResponse,
      });

      const result = await queryGhsa({
        ecosystem: 'npm',
        packageName: 'express',
      });

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('GHSA-xxxx-xxxx-xxxx');
      expect(result[0].severity).toBe('HIGH');
      expect(result[0].summary).toBe('Test vulnerability');

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.github.com/graphql',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Bearer test-token',
            'Content-Type': 'application/json',
          }),
        })
      );
    });

    it('maps ecosystems correctly', async () => {
      mockGetGitHubToken.mockReturnValue('test-token');
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          data: { securityVulnerabilities: { nodes: [], pageInfo: { hasNextPage: false } } },
        }),
      });

      // Test npm -> NPM
      await queryGhsa({ ecosystem: 'npm', packageName: 'express' });
      const npmCall = mockFetch.mock.calls[0][1];
      const npmBody = JSON.parse(npmCall.body);
      expect(npmBody.variables.ecosystem).toBe('NPM');
      expect(npmBody.variables.package).toBe('express');

      mockFetch.mockClear();

      // Test PyPI -> PIP
      await queryGhsa({ ecosystem: 'PyPI', packageName: 'requests' });
      const pipCall = mockFetch.mock.calls[0][1];
      const pipBody = JSON.parse(pipCall.body);
      expect(pipBody.variables.ecosystem).toBe('PIP');
      expect(pipBody.variables.package).toBe('requests');
    });

    it('throws error when token is missing', async () => {
      mockGetGitHubToken.mockReturnValue(undefined);

      await expect(
        queryGhsa({ ecosystem: 'npm', packageName: 'express' })
      ).rejects.toThrow('GitHub token required');
    });

    it('handles API errors gracefully', async () => {
      mockGetGitHubToken.mockReturnValue('test-token');
      mockFetch.mockResolvedValue({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
      });

      await expect(
        queryGhsa({ ecosystem: 'npm', packageName: 'express' })
      ).rejects.toThrow('GHSA API error: 401 Unauthorized');
    });

    it('handles GraphQL errors', async () => {
      mockGetGitHubToken.mockReturnValue('test-token');
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          errors: [{ message: 'GraphQL error' }],
        }),
      });

      await expect(
        queryGhsa({ ecosystem: 'npm', packageName: 'express' })
      ).rejects.toThrow('GHSA GraphQL errors');
    });

    it('returns empty array when no advisories found', async () => {
      mockGetGitHubToken.mockReturnValue('test-token');
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          data: {
            securityVulnerabilities: {
              nodes: [],
              pageInfo: { hasNextPage: false },
            },
          },
        }),
      });

      const result = await queryGhsa({ ecosystem: 'npm', packageName: 'nonexistent' });

      expect(result).toHaveLength(0);
    });

    it('handles pagination (fetches first page)', async () => {
      mockGetGitHubToken.mockReturnValue('test-token');
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          data: {
            securityVulnerabilities: {
              nodes: [
                {
                  advisory: {
                    ghsaId: 'GHSA-1',
                    summary: 'First advisory',
                    severity: 'HIGH',
                    publishedAt: '2023-01-01T00:00:00Z',
                    updatedAt: '2023-01-01T00:00:00Z',
                    references: [],
                  },
                  package: { name: 'express', ecosystem: 'NPM' },
                  vulnerableVersionRange: '>=1.0.0',
                  firstPatchedVersion: null,
                },
              ],
              pageInfo: {
                hasNextPage: true,
                endCursor: 'cursor1',
              },
            },
          },
        }),
      });

      const result = await queryGhsa({ ecosystem: 'npm', packageName: 'express' });

      // Current implementation fetches first page only
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('GHSA-1');
    });

    it('properly maps GraphQL response structure', async () => {
      mockGetGitHubToken.mockReturnValue('test-token');
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          data: {
            securityVulnerabilities: {
              nodes: [
                {
                  advisory: {
                    ghsaId: 'GHSA-test',
                    summary: 'Test',
                    description: 'Test description',
                    severity: 'CRITICAL',
                    publishedAt: '2023-01-01T00:00:00Z',
                    updatedAt: '2023-01-02T00:00:00Z',
                    references: [{ url: 'https://example.com' }],
                  },
                  package: { name: 'package', ecosystem: 'NPM' },
                  vulnerableVersionRange: '>=1.0.0 <2.0.0',
                  firstPatchedVersion: { identifier: '2.0.0' },
                },
              ],
              pageInfo: { hasNextPage: false },
            },
          },
        }),
      });

      const result = await queryGhsa({ ecosystem: 'npm', packageName: 'package' });

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        id: 'GHSA-test',
        summary: 'Test',
        severity: 'CRITICAL',
        vulnerabilities: expect.arrayContaining([
          expect.objectContaining({
            package: { name: 'package', ecosystem: 'NPM' },
            vulnerableVersionRange: '>=1.0.0 <2.0.0',
            firstPatchedVersion: { identifier: '2.0.0' },
          }),
        ]),
        references: [{ url: 'https://example.com' }],
      });
    });
  });
});
