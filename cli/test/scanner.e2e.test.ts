import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { execFile } from 'node:child_process';

vi.mock('node:fs');
vi.mock('node:child_process');

describe('scanner e2e', () => {
  let createCli: any;
  const originalFetch = global.fetch as any;
  const origLog = console.log;
  let logs: string[] = [];

  function mockOsvResponse(vulns: any[] = []) {
    return { ok: true, json: async () => ({ vulns }) } as any;
  }

  beforeEach(async () => {
    logs = [];
    console.log = (...args: any[]) => logs.push(args.join(' '));

    // Mock file system
    vi.mocked(existsSync).mockImplementation((p: any) => {
      const path = String(p);
      if (path.endsWith('pnpm-lock.yaml')) return true;
      if (path.endsWith('package.json')) return true;
      return false;
    });

    vi.mocked(statSync).mockImplementation((p: any) => {
      const path = String(p);
      // Return a directory stat for '.'
      if (path === '.' || path.endsWith('/')) {
        return {
          isFile: () => false,
          isDirectory: () => true,
        } as any;
      }
      // Return a file stat for specific files
      if (path.endsWith('package.json') || path.endsWith('pnpm-lock.yaml')) {
        return {
          isFile: () => true,
          isDirectory: () => false,
        } as any;
      }
      // Default to directory
      return {
        isFile: () => false,
        isDirectory: () => true,
      } as any;
    });

    vi.mocked(readFileSync).mockImplementation((p: any) => {
      const path = String(p);
      if (path.endsWith('package.json')) {
        return JSON.stringify({
          dependencies: { 'left-pad': '^1.0.0' },
        });
      }
      return '';
    });

    // Mock execFile
    vi.mocked(execFile).mockImplementation((cmd: any, args: any, opts: any, cb: any) => {
      if (typeof cb === 'function') {
        setImmediate(() => cb(null, { stdout: '', stderr: '' }));
      }
      return {} as any;
    });

    global.fetch = vi
      .fn()
      .mockResolvedValue(
        mockOsvResponse([
          { id: 'OSV-123', affected: [{ package: { ecosystem: 'npm', name: 'left-pad' }, versions: ['1.0.0'] }] },
        ]),
      );

    ({ createCli } = await import('../src/index.ts'));
  }, 30000); // 30 second timeout

  afterEach(() => {
    console.log = origLog;
    global.fetch = originalFetch;
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('runs scanner default and prints results', async () => {
    const y = createCli(['.']);
    await y.parseAsync();
    const out = logs.join('\n');
    expect(out).toMatch(/OSV-123/);
    expect(out).toMatch(/left-pad/);
  });
});
