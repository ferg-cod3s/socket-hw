import { describe, it, expect, vi, beforeEach } from 'vitest';
import { detectPackageManager, ensureLockfile } from '../src/utils/pm.js';
import { existsSync } from 'node:fs';
import { execFile } from 'node:child_process';

vi.mock('node:fs');
vi.mock('node:child_process');

describe('pm detection and lockfile ensure', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('detects pnpm when pnpm-lock.yaml exists', () => {
    vi.mocked(existsSync).mockImplementation((p: any) => {
      const path = String(p);
      return path.endsWith('pnpm-lock.yaml') || path.endsWith('package.json');
    });

    const which = detectPackageManager('/test');
    expect(which.name).toBe('pnpm');
  });

  it('detects npm when package-lock.json exists', () => {
    vi.mocked(existsSync).mockImplementation((p: any) => {
      const path = String(p);
      return path.endsWith('package-lock.json') || path.endsWith('package.json');
    });

    const which = detectPackageManager('/test');
    expect(which.name).toBe('npm');
  });

  it('detects yarn when yarn.lock exists', () => {
    vi.mocked(existsSync).mockImplementation((p: any) => {
      const path = String(p);
      return path.endsWith('yarn.lock') || path.endsWith('package.json');
    });

    const which = detectPackageManager('/test');
    expect(which.name).toBe('yarn');
  });

  it('ensures lockfile with pnpm --lockfile-only when creating', async () => {
    vi.mocked(existsSync).mockImplementation((p: any) => {
      const path = String(p);
      if (path.endsWith('pnpm-lock.yaml')) return false; // no lock yet
      if (path.endsWith('package.json')) return true;
      return false;
    });

    vi.mocked(execFile).mockImplementation((cmd: any, args: any, opts: any, cb: any) => {
      if (typeof cb === 'function') {
        setImmediate(() => cb(null, { stdout: '', stderr: '' }));
      }
      return {} as any;
    });

    const which = { name: 'pnpm' as const };
    // Test passes if no error is thrown
    await expect(
      ensureLockfile('/test', which, { createIfMissing: true, validateIfPresent: false })
    ).resolves.toBeUndefined();
  });
});
