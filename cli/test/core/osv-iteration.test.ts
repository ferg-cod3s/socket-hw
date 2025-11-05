import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock provider selection to return a fake provider with one dep
vi.mock('../../src/providers/index.js', () => {
  return {
    selectProvider: () => ({
      provider: {
        ensureLockfile: vi.fn(async () => {}),
        gatherDependencies: vi.fn(async () => [
          { name: 'chalk', version: '5.0.0', ecosystem: 'npm', dev: false },
        ]),
      },
      detection: { name: 'Node.js', variant: 'npm' },
    }),
    getSupportedFilenames: () => new Set(['package.json', 'package-lock.json', 'pnpm-lock.yaml', 'yarn.lock']),
  };
});

// Mock OSV to return an object without vulns key
vi.mock('../../src/api/osv.js', () => {
  return {
    queryOsv: vi.fn(async () => ({ /* no vulns key */ })),
  };
});

// Mock GHSA to not interfere
vi.mock('../../src/api/ghsa.js', () => {
  return { queryGhsa: vi.fn(async () => []) };
});

// Mock fs used in scanPath to treat input as directory
vi.mock('node:fs', async () => {
  const actual = await vi.importActual<any>('node:fs');
  return {
    ...actual,
    statSync: vi.fn(() => ({ isFile: () => false })),
  };
});

import { scanPath } from '../../src/core/scan.js';

describe('OSV iteration robustness', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('does not throw when OSV returns no vulns array', async () => {
    const res = await scanPath('/tmp/project');
    expect(res.advisoriesByPackage).toBeTypeOf('object');
  });
});


