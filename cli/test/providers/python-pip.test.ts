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

describe('PythonPipProvider', () => {
  let PythonPipProvider: any;
  let provider: any;

  beforeEach(async () => {
    vi.resetModules();
    mockExecFile.mockClear();
    mockExistsSync.mockClear();
    mockReadFileSync.mockClear();

    ({ PythonPipProvider } = await import(
      '../../src/providers/python-pip/index.js'
    ));
    provider = new PythonPipProvider();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('detect', () => {
    it('detects requirements.txt when present and no pyproject.toml', () => {
      mockExistsSync.mockImplementation((p: any) => {
        const path = String(p);
        return path.endsWith('requirements.txt');
      });

      const result = provider.detect('/test/project');
      expect(result).not.toBeNull();
      expect(result.providerId).toBe('python-pip');
      expect(result.name).toBe('pip');
      expect(result.confidence).toBe(0.9);
    });

    it('does not detect if pyproject.toml exists (Poetry takes precedence)', () => {
      mockExistsSync.mockImplementation((p: any) => {
        const path = String(p);
        return path.endsWith('requirements.txt') || path.endsWith('pyproject.toml');
      });

      const result = provider.detect('/test/project');
      expect(result).toBeNull();
    });

    it('returns null when requirements.txt does not exist', () => {
      mockExistsSync.mockReturnValue(false);
      expect(provider.detect('/test/project')).toBeNull();
    });

    it('returns null when only pyproject.toml exists', () => {
      mockExistsSync.mockImplementation((p: any) => {
        const path = String(p);
        return path.endsWith('pyproject.toml');
      });

      expect(provider.detect('/test/project')).toBeNull();
    });
  });

  describe('ensureLockfile', () => {
    it('verifies requirements.txt exists', async () => {
      mockExistsSync.mockReturnValue(true);

      await expect(
        provider.ensureLockfile('/test/project', {})
      ).resolves.not.toThrow();
    });

    it('throws error when requirements.txt missing', async () => {
      mockExistsSync.mockReturnValue(false);

      await expect(
        provider.ensureLockfile('/test/project', {})
      ).rejects.toThrow('requirements.txt not found');
    });

    it('warns on forceValidate (no lockfile validation for pip)', async () => {
      mockExistsSync.mockReturnValue(true);
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      await provider.ensureLockfile('/test/project', {
        forceValidate: true,
      });

      expect(consoleWarnSpy).toHaveBeenCalledWith(
        'Lockfile validation not supported for requirements.txt'
      );

      consoleWarnSpy.mockRestore();
    });
  });

  describe('gatherDependencies', () => {
    it('parses exact versions (==)', async () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(
        'django==4.2.0\nrequests==2.31.0\n'
      );

      const deps = await provider.gatherDependencies('/test/project', {});

      expect(deps).toHaveLength(2);
      expect(deps).toContainEqual({
        name: 'django',
        version: '4.2.0',
        ecosystem: 'PyPI',
      });
      expect(deps).toContainEqual({
        name: 'requests',
        version: '2.31.0',
        ecosystem: 'PyPI',
      });
    });

    it('parses version ranges', async () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue('flask>=2.0,<3.0\n');

      const deps = await provider.gatherDependencies('/test/project', {});

      expect(deps).toHaveLength(1);
      expect(deps[0].name).toBe('flask');
      expect(deps[0].version).toBe('>=2.0,<3.0');
    });

    it('skips comments and empty lines', async () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(
        '# This is a comment\n\ndjango==4.2.0\n# Another comment\n'
      );

      const deps = await provider.gatherDependencies('/test/project', {});

      expect(deps).toHaveLength(1);
      expect(deps[0].name).toBe('django');
    });

    it('skips editable installs', async () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(
        '-e git+https://github.com/user/repo.git\n-e .\ndjango==4.2.0\n'
      );

      const deps = await provider.gatherDependencies('/test/project', {});

      expect(deps).toHaveLength(1);
      expect(deps[0].name).toBe('django');
    });

    it('skips URL-based installs', async () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(
        'django==4.2.0\nhttps://example.com/pkg.tar.gz\nrequests==2.31.0\n'
      );

      const deps = await provider.gatherDependencies('/test/project', {});

      expect(deps).toHaveLength(2);
      expect(deps.every((d) => !d.name.includes('://'))).toBe(true);
    });

    it('skips options like -r, --index-url', async () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(
        '-r requirements-dev.txt\n--index-url https://pypi.org/simple/\ndjango==4.2.0\n'
      );

      const deps = await provider.gatherDependencies('/test/project', {});

      expect(deps).toHaveLength(1);
      expect(deps[0].name).toBe('django');
    });

    it('normalizes package names to lowercase', async () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue('Django==4.2.0\nReQuEsTs==2.31.0\n');

      const deps = await provider.gatherDependencies('/test/project', {});

      expect(deps).toHaveLength(2);
      expect(deps.every((d) => d.name === d.name.toLowerCase())).toBe(true);
      expect(deps.some((d) => d.name === 'django')).toBe(true);
      expect(deps.some((d) => d.name === 'requests')).toBe(true);
    });

    it('handles inline comments', async () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(
        'django==4.2.0  # Web framework\nrequests==2.31.0  # HTTP library\n'
      );

      const deps = await provider.gatherDependencies('/test/project', {});

      expect(deps).toHaveLength(2);
      expect(deps[0].name).toBe('django');
      expect(deps[0].version).toBe('4.2.0');
    });

    it('handles packages without version specifiers', async () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue('django==4.2.0\nrequests\n');

      const deps = await provider.gatherDependencies('/test/project', {});

      expect(deps).toHaveLength(2);
      const requests = deps.find((d) => d.name === 'requests');
      expect(requests).toBeDefined();
      expect(requests?.version).toBe('*');
    });

    it('handles packages with extras', async () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue('requests[security]==2.31.0\n');

      const deps = await provider.gatherDependencies('/test/project', {});

      expect(deps).toHaveLength(1);
      expect(deps[0].name).toBe('requests');
      expect(deps[0].version).toBe('2.31.0');
    });

    it('handles empty requirements.txt', async () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue('\n# Empty file\n');

      const deps = await provider.gatherDependencies('/test/project', {});

      expect(deps).toHaveLength(0);
    });
  });
});

