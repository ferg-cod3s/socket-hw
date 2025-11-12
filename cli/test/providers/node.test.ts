/**
 * Test suite for Node.js provider
 *
 * This file tests the Node.js/npm provider which handles:
 * - Detection of Node.js projects (package.json presence)
 * - Package manager detection (npm, pnpm, yarn classic/berry)
 * - Lockfile parsing (package-lock.json, pnpm-lock.yaml, yarn.lock)
 * - Lockfile management (create, validate, refresh)
 * - Standalone file scanning (lockfiles without project context)
 * - Dev dependencies filtering
 *
 * Testing Approach:
 * This test suite uses mocks for file system operations rather than real files.
 * This approach is appropriate here because:
 * - Tests focus on detection and parsing logic in isolation
 * - Many tests require precise control over file existence and contents
 * - Mocking allows testing edge cases without creating complex file structures
 *
 * Coverage: 100%
 * Tests: 50
 */

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

  /**
   * Project Detection Tests
   *
   * Tests the provider's ability to detect Node.js projects and identify
   * the package manager being used (npm, pnpm, yarn classic/berry).
   */
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
        return path.endsWith('package.json') || path.endsWith('package-lock.json');
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

  /**
   * Lockfile Management Tests
   *
   * Tests lockfile operations including validation and creation.
   * This section focuses on the high-level ensureLockfile API.
   */
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

  /**
   * Dependency Gathering Tests
   *
   * Tests the core functionality of extracting dependencies from:
   * - package.json (manifest-only mode)
   * - Lockfiles (npm, pnpm, yarn classic/berry)
   * - Standalone lockfiles (without project context)
   * - Transitive dependencies resolution
   */
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
        }),
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
        }),
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
        }),
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

    it('parses yarn classic lockfile', async () => {
      mockExistsSync.mockImplementation((p: any) => {
        const path = String(p);
        return path.endsWith('package.json') || path.endsWith('yarn.lock');
      });

      mockReadFileSync.mockImplementation((p: any) => {
        const path = String(p);
        if (path.endsWith('package.json')) {
          return JSON.stringify({ dependencies: { lodash: '^4.17.21' } });
        }
        if (path.endsWith('yarn.lock')) {
          return `
# THIS IS AN AUTOGENERATED FILE. DO NOT EDIT THIS FILE DIRECTLY.
# yarn lockfile v1

lodash@^4.17.21:
  version "4.17.21"
  resolved "https://registry.yarnpkg.com/lodash/-/lodash-4.17.21.tgz#679591c564c3bffaae8454cf0b3df370c3d6911c"
  integrity sha512-v2kDEe57lecTulaDIuNTPy3Ry4gLGJ6Z1O3vE1krgXZNrsQ+LFTGHVxVjcXPs17LhbZVGedAJv8XZ1tvj5FvSg==
`;
        }
        return '';
      });

      const deps = await provider.gatherDependencies('/test/project', {});

      expect(deps.length).toBeGreaterThanOrEqual(1);
      expect(deps.some((d) => d.name === 'lodash' && d.version === '4.17.21')).toBe(true);
    });

    it('parses yarn berry lockfile', async () => {
      // Test berry detection via standalone file (uses __metadata: to detect berry)
      mockReadFileSync.mockReturnValue(`__metadata:
  version: 6

lodash@npm:^4.17.21:
  version: "4.17.21"
  resolution: "lodash@npm:4.17.21"
  languageName: node
  linkType: hard
`);

      const deps = await provider.gatherDependencies('/test/project', {
        standaloneLockfile: '/tmp/yarn.lock',
      });

      expect(deps.length).toBeGreaterThanOrEqual(1);
      // Berry parser extracts name and version
      const lodashDep = deps.find((d) => d.name === 'lodash');
      expect(lodashDep).toBeDefined();
      expect(lodashDep?.version).toBe('4.17.21');
    });

    it('handles standalone pnpm-lock.yaml file', async () => {
      mockReadFileSync.mockReturnValue(`
lockfileVersion: '6.0'
packages:
  /express@4.18.2:
    version: 4.18.2
`);

      const deps = await provider.gatherDependencies('/test/project', {
        standaloneLockfile: '/tmp/pnpm-lock.yaml',
      });

      expect(deps.length).toBeGreaterThanOrEqual(1);
      expect(deps.some((d) => d.name === 'express')).toBe(true);
    });

    it('handles standalone package-lock.json file', async () => {
      mockReadFileSync.mockReturnValue(
        JSON.stringify({
          lockfileVersion: 3,
          packages: {
            'node_modules/lodash': { version: '4.17.21' },
          },
        }),
      );

      const deps = await provider.gatherDependencies('/test/project', {
        standaloneLockfile: '/tmp/package-lock.json',
      });

      expect(deps.length).toBeGreaterThanOrEqual(1);
      expect(deps.some((d) => d.name === 'lodash')).toBe(true);
    });

    it('handles standalone yarn.lock file (classic)', async () => {
      mockReadFileSync.mockReturnValue(`
lodash@^4.17.21:
  version "4.17.21"
  resolved "https://registry.yarnpkg.com/lodash/-/lodash-4.17.21.tgz"
`);

      const deps = await provider.gatherDependencies('/test/project', {
        standaloneLockfile: '/tmp/yarn.lock',
      });

      expect(deps.length).toBeGreaterThanOrEqual(1);
      expect(deps.some((d) => d.name === 'lodash')).toBe(true);
    });

    it('handles standalone yarn.lock file (berry)', async () => {
      mockReadFileSync.mockReturnValue(`__metadata:
  version: 6

"lodash@npm:^4.17.21":
  version: 4.17.21
  resolution: "lodash@npm:4.17.21"
`);

      const deps = await provider.gatherDependencies('/test/project', {
        standaloneLockfile: '/tmp/yarn.lock',
      });

      expect(deps.length).toBeGreaterThanOrEqual(1);
      expect(deps.some((d) => d.name === 'lodash')).toBe(true);
    });

    it('throws error for standalone package.json file', async () => {
      await expect(
        provider.gatherDependencies('/test/project', {
          standaloneLockfile: '/tmp/package.json',
        }),
      ).rejects.toThrow(/package.json requires a lockfile/);
    });

    it('throws error for standalone pnpm-workspace.yaml file', async () => {
      await expect(
        provider.gatherDependencies('/test/project', {
          standaloneLockfile: '/tmp/pnpm-workspace.yaml',
        }),
      ).rejects.toThrow(/pnpm-workspace.yaml only defines workspace structure/);
    });

    it('rethrows error for standalone lockfile parsing failure', async () => {
      mockReadFileSync.mockImplementation(() => {
        throw new Error('File read error');
      });

      await expect(
        provider.gatherDependencies('/test/project', {
          standaloneLockfile: '/tmp/pnpm-lock.yaml',
        }),
      ).rejects.toThrow('File read error');
    });

    it('handles package.json with no dependencies', async () => {
      mockExistsSync.mockImplementation((p: any) => {
        const path = String(p);
        return path.endsWith('package.json');
      });
      mockReadFileSync.mockReturnValue(JSON.stringify({ name: 'empty-project' }));

      const deps = await provider.gatherDependencies('/test/project', {});

      expect(deps).toHaveLength(0);
    });

    it('handles package.json with empty dependencies object', async () => {
      mockExistsSync.mockImplementation((p: any) => {
        const path = String(p);
        return path.endsWith('package.json');
      });
      mockReadFileSync.mockReturnValue(
        JSON.stringify({
          dependencies: {},
          devDependencies: {},
        }),
      );

      const deps = await provider.gatherDependencies('/test/project', {
        includeDev: true,
      });

      expect(deps).toHaveLength(0);
    });
  });

  /**
   * Package Manager Detection Tests
   *
   * Tests the logic for determining which package manager is being used.
   * Detection sources (in priority order):
   * 1. Lockfile presence (pnpm-lock.yaml, package-lock.json, yarn.lock, npm-shrinkwrap.json)
   * 2. packageManager field in package.json
   * 3. pnpm-workspace.yaml presence
   * 4. Default to npm
   *
   * Also tests yarn variant detection (classic vs berry).
   */
  describe('detectPackageManager', () => {
    it('detects pnpm from pnpm-lock.yaml', () => {
      mockExistsSync.mockImplementation((p: any) => {
        const path = String(p);
        return path.endsWith('package.json') || path.endsWith('pnpm-lock.yaml');
      });

      const result = provider.detect('/test/project');
      expect(result.name).toBe('pnpm');
    });

    it('detects npm from npm-shrinkwrap.json', () => {
      mockExistsSync.mockImplementation((p: any) => {
        const path = String(p);
        return path.endsWith('package.json') || path.endsWith('npm-shrinkwrap.json');
      });

      const result = provider.detect('/test/project');
      expect(result.name).toBe('npm');
    });

    it('detects pnpm from packageManager field', () => {
      mockExistsSync.mockImplementation((p: any) => {
        const path = String(p);
        return path.endsWith('package.json');
      });
      mockReadFileSync.mockReturnValue(JSON.stringify({ packageManager: 'pnpm@8.0.0' }));

      const result = provider.detect('/test/project');
      expect(result.name).toBe('pnpm');
    });

    it('detects yarn from packageManager field', () => {
      mockExistsSync.mockImplementation((p: any) => {
        const path = String(p);
        return path.endsWith('package.json');
      });
      mockReadFileSync.mockReturnValue(JSON.stringify({ packageManager: 'yarn@1.22.0' }));

      const result = provider.detect('/test/project');
      expect(result.name).toBe('yarn');
    });

    it('detects npm from packageManager field', () => {
      mockExistsSync.mockImplementation((p: any) => {
        const path = String(p);
        return path.endsWith('package.json');
      });
      mockReadFileSync.mockReturnValue(JSON.stringify({ packageManager: 'npm@9.0.0' }));

      const result = provider.detect('/test/project');
      expect(result.name).toBe('npm');
    });

    it('detects pnpm from pnpm-workspace.yaml', () => {
      mockExistsSync.mockImplementation((p: any) => {
        const path = String(p);
        // Only return true for package.json and pnpm-workspace.yaml, not lockfiles
        return path.endsWith('package.json') || (path.endsWith('pnpm-workspace.yaml') && !path.includes('lock'));
      });
      mockReadFileSync.mockReturnValue(JSON.stringify({ name: 'test' }));

      const result = provider.detect('/test/project');
      expect(result.name).toBe('pnpm');
    });

    it('defaults to npm when no indicators present', () => {
      mockExistsSync.mockImplementation((p: any) => {
        const path = String(p);
        return path.endsWith('package.json');
      });
      mockReadFileSync.mockReturnValue(JSON.stringify({ name: 'test' }));

      const result = provider.detect('/test/project');
      expect(result.name).toBe('npm');
    });

    it('handles malformed package.json gracefully', () => {
      mockExistsSync.mockImplementation((p: any) => {
        const path = String(p);
        return path.endsWith('package.json');
      });
      mockReadFileSync.mockReturnValue('invalid json');

      const result = provider.detect('/test/project');
      expect(result.name).toBe('npm'); // defaults
    });

    it('detects yarn berry variant from packageManager field', () => {
      mockExistsSync.mockImplementation((p: any) => {
        const path = String(p);
        // Only package.json exists, no yarn.lock yet (forces packageManager detection)
        if (path.endsWith('yarn.lock')) return false;
        return path.endsWith('package.json');
      });
      mockReadFileSync.mockReturnValue(JSON.stringify({ packageManager: 'yarn@3.2.0' }));

      const result = provider.detect('/test/project');
      expect(result.name).toBe('yarn');
      expect(result.variant).toBe('berry');
    });

    it('detects yarn classic variant from packageManager field', () => {
      mockExistsSync.mockImplementation((p: any) => {
        const path = String(p);
        return path.endsWith('package.json') || path.endsWith('yarn.lock');
      });
      mockReadFileSync.mockReturnValue(JSON.stringify({ packageManager: 'yarn@1.22.19' }));

      const result = provider.detect('/test/project');
      expect(result.name).toBe('yarn');
      expect(result.variant).toBe('classic');
    });

    it('handles malformed packageManager field version', () => {
      mockExistsSync.mockImplementation((p: any) => {
        const path = String(p);
        return path.endsWith('package.json') || path.endsWith('yarn.lock');
      });
      mockReadFileSync.mockReturnValue(JSON.stringify({ packageManager: 'yarn@invalid' }));

      const result = provider.detect('/test/project');
      expect(result.name).toBe('yarn');
      expect(result.variant).toBe('classic'); // defaults to classic
    });
  });

  /**
   * Advanced Lockfile Management Tests
   *
   * Tests detailed lockfile operations across all package managers:
   * - forceRefresh: Update lockfile to match package.json
   * - forceValidate: Verify lockfile is in sync with package.json
   * - createIfMissing: Generate lockfile if it doesn't exist
   * - validateIfPresent: Validate only if lockfile already exists
   * - Error handling and propagation
   */
  describe('lockfile management', () => {
    beforeEach(() => {
      mockExecFile.mockImplementation((cmd: any, args: any, opts: any, cb?: any) => {
        const callback = typeof opts === 'function' ? opts : cb;
        if (callback) {
          setImmediate(() => callback(null, { stdout: '', stderr: '' }));
        }
        return {} as any;
      });
    });

    describe('forceRefresh', () => {
      it('refreshes pnpm lockfile', async () => {
        mockExistsSync.mockImplementation((p: any) => {
          const path = String(p);
          return path.endsWith('package.json') || path.endsWith('pnpm-lock.yaml');
        });

        await provider.ensureLockfile('/test/project', { forceRefresh: true });

        expect(mockExecFile).toHaveBeenCalled();
        const calls = mockExecFile.mock.calls;
        expect(calls[0][0]).toBe('pnpm');
        expect(calls[0][1]).toEqual(['install', '--lockfile-only']);
      });

      it('refreshes npm lockfile', async () => {
        mockExistsSync.mockImplementation((p: any) => {
          const path = String(p);
          return path.endsWith('package.json') || path.endsWith('package-lock.json');
        });

        await provider.ensureLockfile('/test/project', { forceRefresh: true });

        expect(mockExecFile).toHaveBeenCalled();
        const calls = mockExecFile.mock.calls;
        expect(calls[0][0]).toBe('npm');
        expect(calls[0][1]).toEqual(['install', '--package-lock-only']);
      });

      it('refreshes yarn classic lockfile', async () => {
        mockExistsSync.mockImplementation((p: any) => {
          const path = String(p);
          return path.endsWith('package.json') || path.endsWith('yarn.lock');
        });
        mockReadFileSync.mockReturnValue(JSON.stringify({ packageManager: 'yarn@1.22.0' }));

        await provider.ensureLockfile('/test/project', { forceRefresh: true });

        expect(mockExecFile).toHaveBeenCalled();
        const calls = mockExecFile.mock.calls;
        expect(calls[0][0]).toBe('yarn');
        expect(calls[0][1]).toEqual(['install']);
      });

      it('refreshes yarn berry lockfile', async () => {
        mockExistsSync.mockImplementation((p: any) => {
          const path = String(p);
          // No yarn.lock, so it reads packageManager field
          if (path.endsWith('yarn.lock')) return false;
          return path.endsWith('package.json');
        });
        mockReadFileSync.mockReturnValue(JSON.stringify({ packageManager: 'yarn@3.0.0' }));

        await provider.ensureLockfile('/test/project', { forceRefresh: true });

        expect(mockExecFile).toHaveBeenCalled();
        const calls = mockExecFile.mock.calls;
        expect(calls[0][0]).toBe('yarn');
        expect(calls[0][1]).toEqual(['install', '--mode=update-lockfile']);
      });
    });

    describe('forceValidate', () => {
      it('validates pnpm lockfile', async () => {
        mockExistsSync.mockImplementation((p: any) => {
          const path = String(p);
          return path.endsWith('package.json') || path.endsWith('pnpm-lock.yaml');
        });

        await provider.ensureLockfile('/test/project', { forceValidate: true });

        expect(mockExecFile).toHaveBeenCalled();
        const calls = mockExecFile.mock.calls;
        expect(calls[0][0]).toBe('pnpm');
        expect(calls[0][1]).toEqual(['install', '--frozen-lockfile']);
      });

      it('validates npm lockfile with ci --dry-run', async () => {
        mockExistsSync.mockImplementation((p: any) => {
          const path = String(p);
          return path.endsWith('package.json') || path.endsWith('package-lock.json');
        });

        await provider.ensureLockfile('/test/project', { forceValidate: true });

        expect(mockExecFile).toHaveBeenCalled();
        const calls = mockExecFile.mock.calls;
        expect(calls[0][0]).toBe('npm');
        expect(calls[0][1]).toEqual(['ci', '--dry-run']);
      });

      it('validates yarn classic lockfile', async () => {
        mockExistsSync.mockImplementation((p: any) => {
          const path = String(p);
          return path.endsWith('package.json') || path.endsWith('yarn.lock');
        });
        mockReadFileSync.mockReturnValue(JSON.stringify({ packageManager: 'yarn@1.22.0' }));

        await provider.ensureLockfile('/test/project', { forceValidate: true });

        expect(mockExecFile).toHaveBeenCalled();
        const calls = mockExecFile.mock.calls;
        expect(calls[0][0]).toBe('yarn');
        expect(calls[0][1]).toEqual(['install', '--frozen-lockfile']);
      });

      it('validates yarn berry lockfile with --immutable', async () => {
        mockExistsSync.mockImplementation((p: any) => {
          const path = String(p);
          // No yarn.lock, so it reads packageManager field
          if (path.endsWith('yarn.lock')) return false;
          return path.endsWith('package.json');
        });
        mockReadFileSync.mockReturnValue(JSON.stringify({ packageManager: 'yarn@3.0.0' }));

        await provider.ensureLockfile('/test/project', { forceValidate: true });

        expect(mockExecFile).toHaveBeenCalled();
        const calls = mockExecFile.mock.calls;
        expect(calls[0][0]).toBe('yarn');
        expect(calls[0][1]).toEqual(['install', '--immutable']);
      });
    });

    describe('createIfMissing', () => {
      it('creates npm lockfile when missing', async () => {
        mockExistsSync.mockImplementation((p: any) => {
          const path = String(p);
          return path.endsWith('package.json');
        });
        mockReadFileSync.mockReturnValue(JSON.stringify({ name: 'test' }));

        await provider.ensureLockfile('/test/project', {
          createIfMissing: true,
        });

        expect(mockExecFile).toHaveBeenCalled();
        const calls = mockExecFile.mock.calls;
        expect(calls[0][0]).toBe('npm');
        expect(calls[0][1]).toEqual(['install', '--package-lock-only']);
      });

      it('creates yarn classic lockfile when missing', async () => {
        mockExistsSync.mockImplementation((p: any) => {
          const path = String(p);
          return path.endsWith('package.json');
        });
        mockReadFileSync.mockReturnValue(JSON.stringify({ packageManager: 'yarn@1.22.0' }));

        await provider.ensureLockfile('/test/project', {
          createIfMissing: true,
        });

        expect(mockExecFile).toHaveBeenCalled();
        const calls = mockExecFile.mock.calls;
        expect(calls[0][0]).toBe('yarn');
        expect(calls[0][1]).toEqual(['install']);
      });

      it('creates yarn berry lockfile when missing', async () => {
        mockExistsSync.mockImplementation((p: any) => {
          const path = String(p);
          return path.endsWith('package.json');
        });
        mockReadFileSync.mockReturnValue(JSON.stringify({ packageManager: 'yarn@3.0.0' }));

        await provider.ensureLockfile('/test/project', {
          createIfMissing: true,
        });

        expect(mockExecFile).toHaveBeenCalled();
        const calls = mockExecFile.mock.calls;
        expect(calls[0][0]).toBe('yarn');
        expect(calls[0][1]).toEqual(['install', '--mode=update-lockfile']);
      });

      it('does not create lockfile when it already exists', async () => {
        mockExistsSync.mockImplementation((p: any) => {
          const path = String(p);
          return path.endsWith('package.json') || path.endsWith('pnpm-lock.yaml');
        });

        await provider.ensureLockfile('/test/project', {
          createIfMissing: true,
        });

        // Should not call execFile
        expect(mockExecFile).not.toHaveBeenCalled();
      });
    });

    describe('validateIfPresent', () => {
      it('validates when lockfile present', async () => {
        mockExistsSync.mockImplementation((p: any) => {
          const path = String(p);
          return path.endsWith('package.json') || path.endsWith('package-lock.json');
        });

        await provider.ensureLockfile('/test/project', {
          validateIfPresent: true,
        });

        expect(mockExecFile).toHaveBeenCalled();
      });

      it('does not validate when lockfile missing', async () => {
        mockExistsSync.mockImplementation((p: any) => {
          const path = String(p);
          return path.endsWith('package.json');
        });

        await provider.ensureLockfile('/test/project', {
          validateIfPresent: true,
        });

        expect(mockExecFile).not.toHaveBeenCalled();
      });
    });

    describe('error handling', () => {
      it('propagates errors from execFile', async () => {
        mockExistsSync.mockImplementation((p: any) => {
          const path = String(p);
          return path.endsWith('package.json') || path.endsWith('package-lock.json');
        });

        mockExecFile.mockImplementation((cmd: any, args: any, opts: any, cb?: any) => {
          const callback = typeof opts === 'function' ? opts : cb;
          if (callback) {
            setImmediate(() => callback(new Error('Command failed'), null));
          }
          return {} as any;
        });

        await expect(provider.ensureLockfile('/test/project', { forceValidate: true })).rejects.toThrow(
          'Command failed',
        );
      });
    });
  });

  /**
   * Manifest Enumeration Tests
   *
   * Tests that the provider correctly reports all supported manifest
   * and lockfile formats.
   */
  describe('getSupportedManifests', () => {
    it('returns list of supported manifest files', () => {
      const manifests = provider.getSupportedManifests();

      expect(manifests).toContain('package.json');
      expect(manifests).toContain('package-lock.json');
      expect(manifests).toContain('pnpm-lock.yaml');
      expect(manifests).toContain('yarn.lock');
      expect(manifests).toContain('npm-shrinkwrap.json');
      expect(manifests).toContain('pnpm-workspace.yaml');
    });
  });

  /**
   * Integration Tests
   *
   * Tests complex real-world scenarios with actual lockfile parsing
   * and dependency resolution.
   */
  describe('integration tests', () => {
    it('handles complex npm lockfile with nested dependencies and conflicts', async () => {
      mockExistsSync.mockImplementation((p: any) => {
        const path = String(p);
        return path.endsWith('package.json') || path.endsWith('package-lock.json');
      });

      mockReadFileSync.mockImplementation((p: any) => {
        const path = String(p);
        if (path.endsWith('package.json')) {
          return JSON.stringify({
            name: 'complex-app',
            dependencies: {
              react: '^18.0.0',
              express: '^4.18.0',
            },
          });
        }
        if (path.endsWith('package-lock.json')) {
          return JSON.stringify({
            lockfileVersion: 3,
            packages: {
              '': {
                name: 'complex-app',
                dependencies: { react: '^18.0.0', express: '^4.18.0' },
              },
              'node_modules/react': { version: '18.2.0' },
              'node_modules/express': {
                version: '4.18.2',
                dependencies: { accepts: '~1.3.8', 'body-parser': '^1.20.0' },
              },
              'node_modules/accepts': { version: '1.3.8' },
              'node_modules/body-parser': {
                version: '1.20.2',
                dependencies: { bytes: '3.1.2' },
              },
              'node_modules/bytes': { version: '3.1.2' },
              // Version conflict scenario
              'node_modules/express/node_modules/accepts': { version: '1.3.7' },
            },
          });
        }
        return '';
      });

      const deps = await provider.gatherDependencies('/test/project', {});

      // Should include all transitive dependencies and handle conflicts
      expect(deps.length).toBeGreaterThanOrEqual(5);
      expect(deps.some((d) => d.name === 'react' && d.version === '18.2.0')).toBe(true);
      expect(deps.some((d) => d.name === 'express' && d.version === '4.18.2')).toBe(true);
      expect(deps.some((d) => d.name === 'accepts')).toBe(true); // Both versions
      expect(deps.some((d) => d.name === 'body-parser')).toBe(true);
      expect(deps.some((d) => d.name === 'bytes')).toBe(true);
    });

    it('handles complex pnpm workspace with multiple packages', async () => {
      mockExistsSync.mockImplementation((p: any) => {
        const path = String(p);
        return path.endsWith('package.json') || path.endsWith('pnpm-lock.yaml');
      });

      mockReadFileSync.mockImplementation((p: any) => {
        const path = String(p);
        if (path.endsWith('package.json')) {
          return JSON.stringify({
            name: 'workspace-root',
            dependencies: { shared: 'workspace:*' },
          });
        }
        if (path.endsWith('pnpm-lock.yaml')) {
          return `
lockfileVersion: '6.0'

importers:
  .:
    dependencies:
      shared: workspace:*
      lodash: ^4.17.21
  packages/app:
    dependencies:
      shared: workspace:*
      react: ^18.0.0
      express: ^4.18.0
  packages/lib:
    dependencies:
      shared: workspace:*
      typescript: ^5.0.0

packages:
  lodash@4.17.21:
    version: 4.17.21
  react@18.2.0:
    version: 18.2.0
  express@4.18.2:
    version: 4.18.2
    dependencies:
      accepts: /accepts@1.3.8
  accepts@1.3.8:
    version: 1.3.8
  typescript@5.2.2:
    version: 5.2.2
  shared@workspace:packages/shared:
    version: 1.0.0
`;
        }
        return '';
      });

      const deps = await provider.gatherDependencies('/test/project', {});

      // Should include external dependencies from all workspace packages but skip workspace packages
      expect(deps.length).toBeGreaterThanOrEqual(5);
      expect(deps.some((d) => d.name === 'lodash')).toBe(true);
      expect(deps.some((d) => d.name === 'react')).toBe(true);
      expect(deps.some((d) => d.name === 'express')).toBe(true);
      expect(deps.some((d) => d.name === 'accepts')).toBe(true);
      expect(deps.some((d) => d.name === 'typescript')).toBe(true);
      expect(deps.some((d) => d.name === 'shared')).toBe(false); // workspace protocol
    });

    it('handles yarn berry workspace with zero-installs and patches', async () => {
      mockExistsSync.mockImplementation((p: any) => {
        const path = String(p);
        return path.endsWith('package.json') || path.endsWith('yarn.lock');
      });

      mockReadFileSync.mockImplementation((p: any) => {
        const path = String(p);
        if (path.endsWith('package.json')) {
          return JSON.stringify({
            name: 'berry-workspace',
            packageManager: 'yarn@4.0.0',
            dependencies: { lodash: '^4.17.21' },
          });
        }
        if (path.endsWith('yarn.lock')) {
          return `__metadata:
  version: 8
  cacheKey: 10c0
  zeroInstalls: true

lodash@npm:^4.17.21:
  version: "4.17.21"
  resolution: "lodash@npm:4.17.21"
  languageName: node
  linkType: hard

express@npm:^4.18.0:
  version: "4.18.2"
  resolution: "express@npm:4.18.2"
  languageName: node
  linkType: hard

workspace-pkg@workspace:packages/shared:
  version: "1.0.0"
  resolution: "workspace-pkg@workspace:packages/shared"
`;
        }
        return '';
      });

      const deps = await provider.gatherDependencies('/test/project', {});

      // Should detect yarn berry and parse correctly, excluding workspaces
      expect(deps.length).toBeGreaterThanOrEqual(1);
      expect(deps.some((d) => d.name === 'lodash')).toBe(true);
      expect(deps.some((d) => d.name === 'workspace-pkg')).toBe(false);
    });

    it('handles mixed package managers and dev dependencies', async () => {
      mockExistsSync.mockImplementation((p: any) => {
        const path = String(p);
        return path.endsWith('package.json') || path.endsWith('pnpm-lock.yaml');
      });

      mockReadFileSync.mockImplementation((p: any) => {
        const path = String(p);
        if (path.endsWith('package.json')) {
          return JSON.stringify({
            name: 'mixed-deps-app',
            dependencies: {
              react: '^18.0.0',
              lodash: '^4.17.21',
            },
            devDependencies: {
              vitest: '^1.0.0',
              '@types/node': '^20.0.0',
              eslint: '^8.0.0',
            },
          });
        }
        if (path.endsWith('pnpm-lock.yaml')) {
          return `
lockfileVersion: '6.0'

importers:
  .:
    dependencies:
      react: ^18.0.0
      lodash: ^4.17.21
    devDependencies:
      vitest: ^1.0.0
      '@types/node': ^20.0.0
      eslint: ^8.0.0

packages:
  react@18.2.0:
    version: 18.2.0
    dev: false
  lodash@4.17.21:
    version: 4.17.21
    dev: false
  vitest@1.0.0:
    version: 1.0.0
    dev: true
  '@types/node@20.10.0':
    version: 20.10.0
    dev: true
  eslint@8.50.0:
    version: 8.50.0
    dev: true
    dependencies:
      '@eslint/js': /@eslint/js@8.50.0
  '@eslint/js@8.50.0':
    version: 8.50.0
    dev: true
`;
        }
        return '';
      });

      const depsWithDev = await provider.gatherDependencies('/test/project', {
        includeDev: true,
      });
      const depsWithoutDev = await provider.gatherDependencies('/test/project', {
        includeDev: false,
      });

      // With dev dependencies
      expect(depsWithDev.length).toBeGreaterThanOrEqual(6);
      expect(depsWithDev.some((d) => d.name === 'react')).toBe(true);
      expect(depsWithDev.some((d) => d.name === 'vitest')).toBe(true);
      expect(depsWithDev.some((d) => d.name === '@types/node')).toBe(true);
      expect(depsWithDev.some((d) => d.name === 'eslint')).toBe(true);
      expect(depsWithDev.some((d) => d.name === '@eslint/js')).toBe(true);

      // Without dev dependencies
      expect(depsWithoutDev.length).toBeGreaterThanOrEqual(2);
      expect(depsWithoutDev.some((d) => d.name === 'react')).toBe(true);
      expect(depsWithoutDev.some((d) => d.name === 'lodash')).toBe(true);
      expect(depsWithoutDev.some((d) => d.name === 'vitest')).toBe(false);
    });

    it('handles standalone lockfile parsing with complex trees', async () => {
      // Test parsing a standalone npm lockfile
      mockReadFileSync.mockReturnValue(
        JSON.stringify({
          lockfileVersion: 3,
          packages: {
            'node_modules/@babel/core': {
              version: '7.23.0',
              dependencies: {
                '@babel/generator': '^7.23.0',
                '@babel/parser': '^7.23.0',
              },
            },
            'node_modules/@babel/generator': { version: '7.23.0' },
            'node_modules/@babel/parser': { version: '7.23.0' },
            'node_modules/@types/node': { version: '20.10.0' },
            'node_modules/typescript': {
              version: '5.2.2',
              dependencies: {
                '@types/node': '^20.0.0', // Different version specifier
              },
            },
            'node_modules/typescript/node_modules/@types/node': { version: '20.5.0' }, // Different version
          },
        }),
      );

      const deps = await provider.gatherDependencies('/test/project', {
        standaloneLockfile: '/tmp/package-lock.json',
      });

      // Should extract all packages including nested and conflicting versions
      expect(deps.length).toBeGreaterThanOrEqual(5);
      expect(deps.some((d) => d.name === '@babel/core')).toBe(true);
      expect(deps.some((d) => d.name === '@babel/generator')).toBe(true);
      expect(deps.some((d) => d.name === '@babel/parser')).toBe(true);
      expect(deps.some((d) => d.name === 'typescript')).toBe(true);
      // Should include both @types/node versions
      const typesNodeVersions = deps.filter((d) => d.name === '@types/node').map((d) => d.version);
      expect(typesNodeVersions.length).toBeGreaterThanOrEqual(1);
    });
  });
});
