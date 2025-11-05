import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readDeclaredDependencies, gatherDependencies } from '../src/utils/dependencies.js';
import { readFileSync, existsSync } from 'node:fs';
import { detectPackageManager, ensureLockfile } from '../src/utils/pm.js';

vi.mock('node:fs');
vi.mock('../src/utils/pm.js');

describe('dependency gathering', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('readDeclaredDependencies', () => {
    it('reads declared deps from package.json', async () => {
      const pkg = { dependencies: { lodash: '^4.17.21' }, devDependencies: { vitest: '^1.0.0' } };
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify(pkg));

      const out = await readDeclaredDependencies('/test', { includeDev: false });
      expect(out.some((d) => d.name === 'lodash')).toBe(true);
      expect(out.some((d) => d.name === 'vitest')).toBe(false);
    });

    it('includes devDependencies when flag is set', async () => {
      const pkg = { dependencies: { lodash: '^4.17.21' }, devDependencies: { vitest: '^1.0.0' } };
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify(pkg));

      const out = await readDeclaredDependencies('/test', { includeDev: true });
      expect(out.some((d) => d.name === 'lodash')).toBe(true);
      expect(out.some((d) => d.name === 'vitest')).toBe(true);
    });
  });

  describe('gatherDependencies', () => {
    // Note: Lockfile parsing is deferred - currently uses declared versions from package.json
    it('reads declared versions from package.json', async () => {
      const pkg = { dependencies: { lodash: '^4.17.21' } };

      vi.mocked(readFileSync).mockReturnValue(JSON.stringify(pkg));

      const out = await gatherDependencies('/test', { includeDev: false });
      expect(out).toHaveLength(1);
      expect(out[0].name).toBe('lodash');
      expect(out[0].version).toBe('^4.17.21'); // Declared version, not resolved
    });

    it('excludes devDependencies by default', async () => {
      const pkg = {
        dependencies: { lodash: '^4.17.21' },
        devDependencies: { vitest: '^1.0.0' }
      };

      vi.mocked(readFileSync).mockReturnValue(JSON.stringify(pkg));

      const out = await gatherDependencies('/test', { includeDev: false });
      expect(out.some((d) => d.name === 'lodash')).toBe(true);
      expect(out.some((d) => d.name === 'vitest')).toBe(false);
    });

    it('includes devDependencies when flag is set', async () => {
      const pkg = {
        dependencies: { lodash: '^4.17.21' },
        devDependencies: { vitest: '^1.0.0' }
      };

      vi.mocked(readFileSync).mockReturnValue(JSON.stringify(pkg));

      const out = await gatherDependencies('/test', { includeDev: true });
      expect(out.some((d) => d.name === 'lodash')).toBe(true);
      expect(out.some((d) => d.name === 'vitest')).toBe(true);
    });
  });
});
