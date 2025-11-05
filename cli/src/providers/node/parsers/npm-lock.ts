/**
 * npm package-lock.json Parser
 *
 * Supports lockfile versions:
 * - v1: npm v5-v6
 * - v2: npm v7-v8 (backward compatible with v1)
 * - v3: npm v9+ (backward compatible with v2, current as of npm v11)
 *
 * Documentation:
 * - npm v10 package-lock.json: https://docs.npmjs.com/cli/v10/configuring-npm/package-lock-json
 * - npm v6 package-locks: https://docs.npmjs.com/cli/v6/configuring-npm/package-locks
 *
 * Format notes:
 * - v3 uses flat `packages` object with paths like "node_modules/package-name"
 * - v2 can use either `packages` object or nested `dependencies` tree
 * - v1 uses nested `dependencies` tree structure
 */

import type { Dependency } from '../../types.js';

interface NpmLockV3 {
  lockfileVersion: number;
  packages: Record<string, {
    version?: string;
    resolved?: string;
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  }>;
}

interface NpmLockV2 {
  lockfileVersion: number;
  packages?: Record<string, {
    version?: string;
    dependencies?: Record<string, string>;
  }>;
  dependencies?: Record<string, {
    version: string;
    dependencies?: Record<string, { version: string }>;
  }>;
}

export function parseNpmLock(lockContent: string): Dependency[] {
  let lock: NpmLockV3 | NpmLockV2;

  try {
    lock = JSON.parse(lockContent);
  } catch (error) {
    throw new Error(`Invalid package-lock.json format: ${error instanceof Error ? error.message : 'parse failed'}`);
  }

  const deps: Dependency[] = [];
  const seen = new Set<string>();

  // Handle v3 format (packages object)
  if (lock.lockfileVersion === 3 && 'packages' in lock && lock.packages) {
    for (const [path, pkg] of Object.entries(lock.packages)) {
      // Skip root package
      if (!path || path === '') continue;

      // Extract package name from path
      // Format: "node_modules/package-name" or "node_modules/@scope/package-name"
      // Or nested: "node_modules/express/node_modules/accepts"
      const segments = path.split('/');
      let name: string;

      if (path.startsWith('node_modules/')) {
        // Find the last segment that's not "node_modules"
        const nodeModulesIndices: number[] = [];
        segments.forEach((seg, idx) => {
          if (seg === 'node_modules') nodeModulesIndices.push(idx);
        });

        if (nodeModulesIndices.length > 0) {
          const lastNodeModulesIdx = nodeModulesIndices[nodeModulesIndices.length - 1];
          const nameSegments = segments.slice(lastNodeModulesIdx + 1);
          name = nameSegments.join('/');
        } else {
          name = segments[segments.length - 1];
        }
      } else if (path.startsWith('packages/')) {
        // Workspace package - skip or handle differently
        continue;
      } else {
        name = segments[segments.length - 1];
      }

      if (!pkg.version) continue;

      // Deduplicate by name+version
      const key = `${name}@${pkg.version}`;
      if (seen.has(key)) continue;
      seen.add(key);

      deps.push({
        name,
        version: pkg.version,
        ecosystem: 'npm',
      });
    }
  } else if (lock.lockfileVersion === 2 || lock.lockfileVersion === 1) {
    // Handle v2 format - can use packages or dependencies
    const v2Lock = lock as NpmLockV2;

    if (v2Lock.packages) {
      for (const [path, pkg] of Object.entries(v2Lock.packages)) {
        if (!path || path === '' || !pkg.version) continue;

        const segments = path.split('/');
        const name = path.startsWith('node_modules/')
          ? segments[segments.length - 1]
          : segments[segments.length - 1];

        const key = `${name}@${pkg.version}`;
        if (seen.has(key)) continue;
        seen.add(key);

        deps.push({
          name,
          version: pkg.version,
          ecosystem: 'npm',
        });
      }
    }

    // Also check dependencies tree for v2
    if (v2Lock.dependencies) {
      const traverse = (depMap: Record<string, any>, prefix = '') => {
        for (const [name, dep] of Object.entries(depMap)) {
          if (dep.version) {
            const key = `${name}@${dep.version}`;
            if (!seen.has(key)) {
              seen.add(key);
              deps.push({
                name,
                version: dep.version,
                ecosystem: 'npm',
              });
            }
          }

          if (dep.dependencies) {
            traverse(dep.dependencies, `${prefix}${name}/`);
          }
        }
      };

      traverse(v2Lock.dependencies);
    }
  }

  return deps;
}

