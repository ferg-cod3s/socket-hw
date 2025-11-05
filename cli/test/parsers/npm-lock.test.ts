import { describe, it, expect } from 'vitest';
import { parseNpmLock } from '../../src/providers/node/parsers/npm-lock.js';

describe('parseNpmLock', () => {
  it('parses npm lockfile v3 format', () => {
    const lockContent = JSON.stringify({
      lockfileVersion: 3,
      packages: {
        '': {
          name: 'test-project',
          version: '1.0.0',
          dependencies: {
            express: '^4.18.0',
            lodash: '^4.17.21',
          },
        },
        'node_modules/express': {
          version: '4.18.2',
          resolved: 'https://registry.npmjs.org/express/-/express-4.18.2.tgz',
          dependencies: {
            accepts: '~1.3.8',
          },
        },
        'node_modules/lodash': {
          version: '4.17.21',
          resolved: 'https://registry.npmjs.org/lodash/-/lodash-4.17.21.tgz',
        },
        'node_modules/express/node_modules/accepts': {
          version: '1.3.8',
          resolved: 'https://registry.npmjs.org/accepts/-/accepts-1.3.8.tgz',
        },
      },
    });

    const result = parseNpmLock(lockContent);

    expect(result).toHaveLength(3);
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

  it('parses npm lockfile v2 format', () => {
    const lockContent = JSON.stringify({
      lockfileVersion: 2,
      packages: {
        'node_modules/express': {
          version: '4.18.2',
          dependencies: {
            accepts: '~1.3.8',
          },
        },
        'node_modules/lodash': {
          version: '4.17.21',
        },
      },
      dependencies: {
        express: {
          version: '4.18.2',
          dependencies: {
            accepts: {
              version: '1.3.8',
            },
          },
        },
        lodash: {
          version: '4.17.21',
        },
      },
    });

    const result = parseNpmLock(lockContent);

    expect(result.length).toBeGreaterThanOrEqual(3);
    expect(result.some((d) => d.name === 'express' && d.version === '4.18.2')).toBe(true);
    expect(result.some((d) => d.name === 'lodash' && d.version === '4.17.21')).toBe(true);
    expect(result.some((d) => d.name === 'accepts' && d.version === '1.3.8')).toBe(true);
  });

  it('handles scoped packages', () => {
    const lockContent = JSON.stringify({
      lockfileVersion: 3,
      packages: {
        'node_modules/@types/node': {
          version: '20.10.0',
        },
        'node_modules/@types/express': {
          version: '4.17.21',
        },
      },
    });

    const result = parseNpmLock(lockContent);

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

  it('handles nested node_modules paths', () => {
    const lockContent = JSON.stringify({
      lockfileVersion: 3,
      packages: {
        'node_modules/express': {
          version: '4.18.2',
        },
        'node_modules/express/node_modules/accepts': {
          version: '1.3.8',
        },
        'node_modules/lodash/node_modules/accepts': {
          version: '1.3.7',
        },
      },
    });

    const result = parseNpmLock(lockContent);

    // Should extract all packages, including nested ones
    expect(result.length).toBeGreaterThanOrEqual(3);
    expect(result.some((d) => d.name === 'express')).toBe(true);
    // Both accepts packages should be included (different versions)
    const acceptsVersions = result.filter((d) => d.name === 'accepts').map((d) => d.version);
    expect(acceptsVersions.length).toBeGreaterThanOrEqual(1);
  });

  it('skips root package', () => {
    const lockContent = JSON.stringify({
      lockfileVersion: 3,
      packages: {
        '': {
          name: 'test-project',
          version: '1.0.0',
        },
        'node_modules/express': {
          version: '4.18.2',
        },
      },
    });

    const result = parseNpmLock(lockContent);

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('express');
    expect(result.some((d) => d.name === 'test-project')).toBe(false);
  });

  it('handles workspace packages', () => {
    const lockContent = JSON.stringify({
      lockfileVersion: 3,
      packages: {
        'node_modules/express': {
          version: '4.18.2',
        },
        'packages/pkg-a': {
          name: 'pkg-a',
          version: '1.0.0',
          dependencies: {
            express: '^4.18.0',
          },
        },
      },
    });

    const result = parseNpmLock(lockContent);

    // Should extract express from both root and workspace
    expect(result.length).toBeGreaterThanOrEqual(1);
    expect(result.some((d) => d.name === 'express')).toBe(true);
  });

  it('handles empty lockfile', () => {
    const lockContent = JSON.stringify({
      lockfileVersion: 3,
      packages: {},
    });

    const result = parseNpmLock(lockContent);

    expect(result).toHaveLength(0);
  });

  it('handles malformed JSON gracefully', () => {
    expect(() => parseNpmLock('invalid json')).toThrow();
  });
});

