import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Note: This import will fail until the core is implemented (TDD)
import { scanPath } from './scan';

async function withTempDir(run: (dir: string) => Promise<void>): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'scanner-core-'));
  try {
    await run(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('core/scan: file-or-directory normalization', () => {
  it('resolves file path to parent directory for Node (package.json)', async () => {
    await withTempDir(async (dir) => {
      // Minimal Node project
      writeFileSync(
        join(dir, 'package.json'),
        JSON.stringify({ name: 'tmp', version: '1.0.0', dependencies: {} }, null, 2),
        'utf8'
      );

      // Pass a file path (package.json) instead of the directory
      const result = await scanPath(join(dir, 'package.json'), {
        includeDev: false,
        validateLock: false,
        refreshLock: false,
        concurrency: 1,
      });

      expect(result).toBeTruthy();
      expect(result.detection.providerId).toBe('node');
      expect(typeof result.scanDurationMs).toBe('number');
    });
  });

  it('errors for unsupported file input with friendly message', async () => {
    await withTempDir(async (dir) => {
      const badPath = join(dir, 'README.md');
      writeFileSync(badPath, '# readme', 'utf8');

      await expect(scanPath(badPath, { concurrency: 1 })).rejects.toThrow(/unsupported file/i);
    });
  });

  it('prefers Poetry over Pip when both pyproject.toml and requirements.txt exist', async () => {
    await withTempDir(async (dir) => {
      writeFileSync(join(dir, 'pyproject.toml'), '[tool.poetry]\nname = "tmp"\n', 'utf8');
      writeFileSync(join(dir, 'requirements.txt'), 'requests==2.31.0\n', 'utf8');

      // Passing requirements.txt should still result in Poetry provider due to precedence
      const result = await scanPath(join(dir, 'requirements.txt'), { concurrency: 1 });
      expect(result.detection.providerId).toBe('python-poetry');
    });
  });
});


