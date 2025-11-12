import { describe, it, expect } from 'vitest';
import { parsePnpmLock } from '../../src/providers/node/parsers/pnpm-lock.js';

describe('parsePnpmLock', () => {
  it('parses pnpm lockfile v6 format', () => {
    const lockContent = `
lockfileVersion: '6.0'

dependencies:
  express:
    specifier: ^4.18.0
    version: 4.18.2
  lodash:
    specifier: ^4.17.21
    version: 4.17.21

packages:
  /express@4.18.2:
    version: 4.18.2
    dependencies:
      accepts: /accepts@1.3.8
  /lodash@4.17.21:
    version: 4.17.21
  /accepts@1.3.8:
    version: 1.3.8
`;

    const result = parsePnpmLock(lockContent, false);

    expect(result.length).toBeGreaterThanOrEqual(3);
    expect(result).toContainEqual({
      name: 'express',
      version: '4.18.2',
      ecosystem: 'npm',
    });
    expect(result).toContainEqual({
      name: 'lodash',
      version: '4.17.21',
      ecosystem: 'npm',
    });
    expect(result).toContainEqual({
      name: 'accepts',
      version: '1.3.8',
      ecosystem: 'npm',
    });
  });

  it('handles scoped packages', () => {
    const lockContent = `
lockfileVersion: '6.0'

packages:
  /@types/node@20.10.0:
    version: 20.10.0
  /@types/express@4.17.21:
    version: 4.17.21
`;

    const result = parsePnpmLock(lockContent, false);

    expect(result).toContainEqual({
      name: '@types/node',
      version: '20.10.0',
      ecosystem: 'npm',
    });
    expect(result).toContainEqual({
      name: '@types/express',
      version: '4.17.21',
      ecosystem: 'npm',
    });
  });

  it('handles catalog references', () => {
    const lockContent = `
lockfileVersion: '6.0'

packages:
  /express@catalog:express:
    version: 4.18.2
  /lodash@catalog:lodash:
    version: 4.17.21
`;

    const result = parsePnpmLock(lockContent, false);

    // Should extract versions even with catalog references
    expect(result.length).toBeGreaterThanOrEqual(2);
    expect(result.some((d) => d.name === 'express')).toBe(true);
    expect(result.some((d) => d.name === 'lodash')).toBe(true);
  });

  it('handles workspace protocol', () => {
    const lockContent = `
lockfileVersion: '6.0'

packages:
  /express@4.18.2:
    version: 4.18.2
    dependencies:
      workspace-pkg: workspace:*
  /workspace-pkg@workspace:packages/pkg-a:
    version: 1.0.0
`;

    const result = parsePnpmLock(lockContent, false);

    // Should skip workspace: protocol packages but include others
    expect(result.length).toBeGreaterThanOrEqual(1);
    expect(result.some((d) => d.name === 'express')).toBe(true);
  });

  it('handles peer dependencies', () => {
    const lockContent = `
lockfileVersion: '6.0'

packages:
  /react@18.2.0:
    version: 18.2.0
  /react-dom@18.2.0(react@18.2.0):
    version: 18.2.0
`;

    const result = parsePnpmLock(lockContent, false);

    expect(result).toContainEqual({
      name: 'react',
      version: '18.2.0',
      ecosystem: 'npm',
    });
    expect(result).toContainEqual({
      name: 'react-dom',
      version: '18.2.0',
      ecosystem: 'npm',
    });
  });

  it('includes dev dependencies when includeDev is true', () => {
    const lockContent = `
lockfileVersion: '6.0'

devDependencies:
  vitest:
    specifier: ^1.0.0
    version: 1.0.0

packages:
  /vitest@1.0.0:
    version: 1.0.0
    dev: true
  /express@4.18.2:
    version: 4.18.2
`;

    const resultWithDev = parsePnpmLock(lockContent, true);
    const resultWithoutDev = parsePnpmLock(lockContent, false);

    expect(resultWithDev.some((d) => d.name === 'vitest')).toBe(true);
    expect(resultWithoutDev.some((d) => d.name === 'vitest')).toBe(false);
  });

  it('handles empty lockfile', () => {
    const lockContent = `
lockfileVersion: '6.0'

packages: {}
`;

    const result = parsePnpmLock(lockContent, false);

    expect(result).toHaveLength(0);
  });

  it('handles malformed YAML gracefully', () => {
    expect(() => parsePnpmLock('invalid: yaml: : :', false)).toThrow();
  });

  it('parses pnpm lockfile v9 format (without leading slash)', () => {
    const lockContent = `
lockfileVersion: 9.0

importers:
  .:
    dependencies:
      express:
        specifier: ^4.18.0
        version: 4.18.2

packages:
  '@actions/core@1.11.1':
    resolution: {integrity: sha512-test}
  express@4.18.2:
    version: 4.18.2
  '@types/node@20.10.0':
    version: 20.10.0
`;

    const result = parsePnpmLock(lockContent, false);

    expect(result.length).toBeGreaterThanOrEqual(3);
    expect(result).toContainEqual({
      name: '@actions/core',
      version: '1.11.1',
      ecosystem: 'npm',
    });
    expect(result).toContainEqual({
      name: 'express',
      version: '4.18.2',
      ecosystem: 'npm',
    });
    expect(result).toContainEqual({
      name: '@types/node',
      version: '20.10.0',
      ecosystem: 'npm',
    });
  });

  it('parses pnpm lockfile v10 format (same as v9, with SHA256 hashes)', () => {
    const lockContent = `
lockfileVersion: 10.0

importers:
  .:
    dependencies:
      lodash:
        specifier: ^4.17.21
        version: 4.17.21

packages:
  '@types/node@20.10.0':
    resolution: {integrity: sha256-test}
  lodash@4.17.21:
    version: 4.17.21
    resolution: {integrity: sha256-abc123}
  '@typescript-eslint/parser@6.0.0':
    version: 6.0.0
`;

    const result = parsePnpmLock(lockContent, false);

    expect(result.length).toBeGreaterThanOrEqual(3);
    expect(result).toContainEqual({
      name: '@types/node',
      version: '20.10.0',
      ecosystem: 'npm',
    });
    expect(result).toContainEqual({
      name: 'lodash',
      version: '4.17.21',
      ecosystem: 'npm',
    });
    expect(result).toContainEqual({
      name: '@typescript-eslint/parser',
      version: '6.0.0',
      ecosystem: 'npm',
    });
  });

  it('handles patch dependencies', () => {
    const lockContent = `
lockfileVersion: '6.0'

packages:
  lodash@4.17.21:
    version: 4.17.21
  lodash@4.17.21(patch_hash=abc123):
    version: 4.17.21
    patch_file: patches/lodash.patch
  express@4.18.2:
    version: 4.18.2
`;

    const result = parsePnpmLock(lockContent, false);

    // Should include both patched and unpatched versions
    expect(result.length).toBeGreaterThanOrEqual(2);
    expect(result.some((d) => d.name === 'lodash' && d.version === '4.17.21')).toBe(true);
    expect(result.some((d) => d.name === 'express')).toBe(true);
  });

  it('handles complex workspace setups with multiple importers', () => {
    const lockContent = `
lockfileVersion: '6.0'

importers:
  .:
    dependencies:
      shared-lib: workspace:*
  packages/pkg-a:
    dependencies:
      shared-lib: workspace:*
      express: ^4.18.0
  packages/pkg-b:
    dependencies:
      shared-lib: workspace:*
      lodash: ^4.17.21

packages:
  express@4.18.2:
    version: 4.18.2
  lodash@4.17.21:
    version: 4.17.21
  shared-lib@workspace:packages/shared:
    version: 1.0.0
`;

    const result = parsePnpmLock(lockContent, false);

    // Should include external dependencies but skip workspace packages
    expect(result.length).toBeGreaterThanOrEqual(2);
    expect(result.some((d) => d.name === 'express')).toBe(true);
    expect(result.some((d) => d.name === 'lodash')).toBe(true);
    expect(result.some((d) => d.name === 'shared-lib')).toBe(false); // workspace protocol
  });

  it('handles optional peer dependencies', () => {
    const lockContent = `
lockfileVersion: '6.0'

packages:
  react@18.2.0:
    version: 18.2.0
  react-dom@18.2.0(react@18.2.0):
    version: 18.2.0
    peerDependencies:
      react: ^18.0.0
  optional-peer-dep@1.0.0(react@18.2.0):
    version: 1.0.0
    optionalPeerDependencies:
      react: ^18.0.0
`;

    const result = parsePnpmLock(lockContent, false);

    expect(result).toContainEqual({
      name: 'react',
      version: '18.2.0',
      ecosystem: 'npm',
    });
    expect(result).toContainEqual({
      name: 'react-dom',
      version: '18.2.0',
      ecosystem: 'npm',
    });
    expect(result).toContainEqual({
      name: 'optional-peer-dep',
      version: '1.0.0',
      ecosystem: 'npm',
    });
  });

  it('skips packages with file: protocol (local packages)', () => {
    const lockContent = `
lockfileVersion: '6.0'

packages:
  express@4.18.2:
    version: 4.18.2
  local-package@file:../local-pkg:
    version: 1.0.0
  another-local@file:./packages/local:
    version: 2.0.0
`;

    const result = parsePnpmLock(lockContent, false);

    // Should include external packages but skip file: protocol packages
    expect(result.length).toBeGreaterThanOrEqual(1);
    expect(result.some((d) => d.name === 'express')).toBe(true);
    expect(result.some((d) => d.name === 'local-package')).toBe(false);
    expect(result.some((d) => d.name === 'another-local')).toBe(false);
  });

  it('skips packages with git: protocol', () => {
    const lockContent = `
lockfileVersion: '6.0'

packages:
  express@4.18.2:
    version: 4.18.2
  my-repo@git+https://github.com/user/repo.git#commit123:
    version: 1.0.0
  another-repo@github:user/repo#v1.0.0:
    version: 1.0.0
`;

    const result = parsePnpmLock(lockContent, false);

    expect(result).toContainEqual({
      name: 'express',
      version: '4.18.2',
      ecosystem: 'npm',
    });
    // Git packages should be skipped
    expect(result.some((d) => d.name === 'my-repo')).toBe(false);
    expect(result.some((d) => d.name === 'another-repo')).toBe(false);
  });

  it('handles packages with different integrity algorithms', () => {
    const lockContent = `
lockfileVersion: '6.0'

packages:
  package-sha1@1.0.0:
    resolution: {integrity: sha1-abc123}
  package-sha256@1.0.0:
    resolution: {integrity: sha256-def456}
  package-sha512@1.0.0:
    resolution: {integrity: sha512-ghi789}
`;

    const result = parsePnpmLock(lockContent, false);

    expect(result.length).toBeGreaterThanOrEqual(3);
    expect(result.some((d) => d.name === 'package-sha1')).toBe(true);
    expect(result.some((d) => d.name === 'package-sha256')).toBe(true);
    expect(result.some((d) => d.name === 'package-sha512')).toBe(true);
  });
});
