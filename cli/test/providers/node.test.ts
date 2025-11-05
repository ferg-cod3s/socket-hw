import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Hoist mocks before imports
const mockExecFile = vi.hoisted(() => vi.fn());
const mockExistsSync = vi.hoisted(() => vi.fn());
const mockReadFileSync = vi.hoisted(() => vi.fn());

vi.mock('node:fs', () => ({
  existsSync: mockExistsSync,
  readFileSync: mockReadFileSync,
}));

vi.mock('node:child_process', () => ({
  execFile: mockExecFile,
}));

describe('NodeProvider', () => {
  let NodeProvider: any;
  let provider: any;

  beforeEach(async () => {
    vi.resetModules();
    mockExecFile.mockClear();
    mockExistsSync.mockClear();
    mockReadFileSync.mockClear();

    ({ NodeProvider } = await import('../../src/providers/node/index.js'));
    provider = new NodeProvider();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('detect', () => {
    it('returns null when package.json does not exist', () => {
      mockExistsSync.mockReturnValue(false);
      expect(provider.detect('/test/project')).toBeNull();
    });

    it('detects pnpm from lockfile', () => {
      mockExistsSync.mockImplementation((p: any) => {
        const path = String(p);
        return path.endsWith('package.json') || path.endsWith('pnpm-lock.yaml');
      });

      const result = provider.detect('/test/project');
      expect(result).not.toBeNull();
      expect(result.providerId).toBe('node');
      expect(result.name).toBe('pnpm');
    });

    it('detects npm from lockfile', () => {
      mockExistsSync.mockImplementation((p: any) => {
        const path = String(p);
        return (
          path.endsWith('package.json') || path.endsWith('package-lock.json')
        );
      });

      const result = provider.detect('/test/project');
      expect(result.providerId).toBe('node');
      expect(result.name).toBe('npm');
    });

    it('detects yarn from lockfile', () => {
      mockExistsSync.mockImplementation((p: any) => {
        const path = String(p);
        return path.endsWith('package.json') || path.endsWith('yarn.lock');
      });

      const result = provider.detect('/test/project');
      expect(result.providerId).toBe('node');
      expect(result.name).toBe('yarn');
      expect(result.variant).toBe('classic');
    });
  });

  describe('ensureLockfile', () => {
    beforeEach(() => {
      mockExistsSync.mockImplementation((p: any) => {
        const path = String(p);
        return path.endsWith('package.json') || path.endsWith('pnpm-lock.yaml');
      });

      // Mock execFile to work with promisify
      mockExecFile.mockImplementation((cmd: any, args: any, opts: any, cb?: any) => {
        // Handle both callback and promise-based calls
        const callback = typeof opts === 'function' ? opts : cb;
        if (callback) {
          setImmediate(() => callback(null, { stdout: '', stderr: '' }));
        }
        return {} as any;
      });
    });

    it('validates lockfile when validateIfPresent is true', async () => {
      await provider.ensureLockfile('/test/project', {
        validateIfPresent: true,
      });

      expect(mockExecFile).toHaveBeenCalled();
      const calls = mockExecFile.mock.calls;
      expect(calls[0][0]).toBe('pnpm');
      expect(calls[0][1]).toEqual(['install', '--frozen-lockfile']);
      expect(calls[0][2]).toMatchObject({ cwd: '/test/project' });
    });

    it('creates lockfile when missing and createIfMissing is true', async () => {
      mockExistsSync.mockImplementation((p: any) => {
        const path = String(p);
        return path.endsWith('package.json');
      });

      await provider.ensureLockfile('/test/project', {
        createIfMissing: true,
      });

      expect(mockExecFile).toHaveBeenCalled();
      const calls = mockExecFile.mock.calls;
      // When no lockfile exists, defaults to npm
      expect(calls[0][0]).toBe('npm');
      expect(calls[0][1]).toEqual(['install', '--package-lock-only']);
      expect(calls[0][2]).toMatchObject({ cwd: '/test/project' });
    });
  });

  describe('gatherDependencies', () => {
    it('reads dependencies from package.json', async () => {
      mockExistsSync.mockImplementation((p: any) => {
        const path = String(p);
        // Return true for package.json, false for all lockfiles (forces manifest-only)
        return path.endsWith('package.json');
      });
      mockReadFileSync.mockReturnValue(
        JSON.stringify({
          dependencies: {
            'left-pad': '^1.0.0',
            express: '~4.18.0',
          },
        })
      );

      const deps = await provider.gatherDependencies('/test/project', {});

      expect(deps).toHaveLength(2);
      expect(deps).toContainEqual({
        name: 'left-pad',
        version: '^1.0.0',
        ecosystem: 'npm',
      });
      expect(deps).toContainEqual({
        name: 'express',
        version: '~4.18.0',
        ecosystem: 'npm',
      });
    });

    it('includes devDependencies when includeDev is true', async () => {
      mockExistsSync.mockImplementation((p: any) => {
        const path = String(p);
        // Return true for package.json, false for all lockfiles (forces manifest-only)
        return path.endsWith('package.json');
      });
      mockReadFileSync.mockReturnValue(
        JSON.stringify({
          dependencies: { express: '~4.18.0' },
          devDependencies: { vitest: '^0.34.0' },
        })
      );

      const deps = await provider.gatherDependencies('/test/project', {
        includeDev: true,
      });

      expect(deps).toHaveLength(2);
      expect(deps).toContainEqual({
        name: 'vitest',
        version: '^0.34.0',
        ecosystem: 'npm',
      });
    });

    it('excludes devDependencies by default', async () => {
      mockExistsSync.mockImplementation((p: any) => {
        const path = String(p);
        // Return true for package.json, false for all lockfiles (forces manifest-only)
        return path.endsWith('package.json');
      });
      mockReadFileSync.mockReturnValue(
        JSON.stringify({
          dependencies: { express: '~4.18.0' },
          devDependencies: { vitest: '^0.34.0' },
        })
      );

      const deps = await provider.gatherDependencies('/test/project', {});

      expect(deps).toHaveLength(1);
      expect(deps[0].name).toBe('express');
    });

    it('parses npm lockfile v3 for transitive dependencies', async () => {
      mockExistsSync.mockImplementation((p: any) => {
        const path = String(p);
        return path.endsWith('package.json') || path.endsWith('package-lock.json');
      });

      mockReadFileSync.mockImplementation((p: any) => {
        const path = String(p);
        if (path.endsWith('package.json')) {
          return JSON.stringify({
            dependencies: { express: '^4.18.0' },
          });
        }
        if (path.endsWith('package-lock.json')) {
          return JSON.stringify({
            lockfileVersion: 3,
            packages: {
              '': { name: 'test-project', version: '1.0.0' },
              'node_modules/express': {
                version: '4.18.2',
                dependencies: { accepts: '~1.3.8' },
              },
              'node_modules/accepts': {
                version: '1.3.8',
              },
            },
          });
        }
        return '';
      });

      const deps = await provider.gatherDependencies('/test/project', {});

      // Should include transitive dependencies
      expect(deps.length).toBeGreaterThanOrEqual(2);
      expect(deps.some((d) => d.name === 'express' && d.version === '4.18.2')).toBe(true);
      expect(deps.some((d) => d.name === 'accepts' && d.version === '1.3.8')).toBe(true);
    });

    it('parses pnpm lockfile for transitive dependencies', async () => {
      mockExistsSync.mockImplementation((p: any) => {
        const path = String(p);
        return path.endsWith('package.json') || path.endsWith('pnpm-lock.yaml');
      });

      mockReadFileSync.mockImplementation((p: any) => {
        const path = String(p);
        if (path.endsWith('package.json')) {
          return JSON.stringify({
            dependencies: { express: '^4.18.0' },
          });
        }
        if (path.endsWith('pnpm-lock.yaml')) {
          return `
lockfileVersion: '6.0'
packages:
  /express@4.18.2:
    version: 4.18.2
    dependencies:
      accepts: /accepts@1.3.8
  /accepts@1.3.8:
    version: 1.3.8
`;
        }
        return '';
      });

      const deps = await provider.gatherDependencies('/test/project', {});

      // Should include transitive dependencies
      expect(deps.length).toBeGreaterThanOrEqual(2);
      expect(deps.some((d) => d.name === 'express' && d.version === '4.18.2')).toBe(true);
      expect(deps.some((d) => d.name === 'accepts' && d.version === '1.3.8')).toBe(true);
    });

    it('falls back to manifest when lockfile parsing fails', async () => {
      mockExistsSync.mockImplementation((p: any) => {
        const path = String(p);
        return path.endsWith('package.json') || path.endsWith('package-lock.json');
      });

      mockReadFileSync.mockImplementation((p: any) => {
        const path = String(p);
        if (path.endsWith('package.json')) {
          return JSON.stringify({
            dependencies: { express: '^4.18.0' },
          });
        }
        if (path.endsWith('package-lock.json')) {
          return 'invalid json';
        }
        return '';
      });

      const deps = await provider.gatherDependencies('/test/project', {});

      // Should fall back to manifest-only
      expect(deps).toHaveLength(1);
      expect(deps[0].name).toBe('express');
      expect(deps[0].version).toBe('^4.18.0');
    });
  });
});

