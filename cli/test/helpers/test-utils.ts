/**
 * Shared test utilities and helpers
 *
 * This file provides common utilities used across test suites to:
 * - Reduce code duplication
 * - Ensure consistent test patterns
 * - Simplify test setup and teardown
 * - Provide type-safe test fixtures
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { vi } from 'vitest';

/**
 * Creates a temporary directory and executes a test function within it.
 * Automatically cleans up the directory after the test completes (success or failure).
 *
 * @example
 * ```typescript
 * it('should parse go.mod file', async () => {
 *   await withTempDir(async (dir) => {
 *     writeFileSync(join(dir, 'go.mod'), 'module example.com/test');
 *     const result = parseGoMod(dir);
 *     expect(result).toBeDefined();
 *   });
 * });
 * ```
 *
 * @param fn - Test function that receives the temporary directory path
 * @returns Promise that resolves when the test completes
 */
export async function withTempDir(
  fn: (dir: string) => Promise<void>
): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'test-'));
  try {
    await fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Creates a temporary file with the given content.
 * Useful for creating test fixtures without polluting the test directory.
 *
 * @example
 * ```typescript
 * await withTempDir(async (dir) => {
 *   createFile(dir, 'package.json', JSON.stringify({ name: 'test' }));
 *   createFile(dir, 'go.mod', 'module example.com/test');
 * });
 * ```
 *
 * @param dir - Directory to create the file in
 * @param filename - Name of the file
 * @param content - File content
 */
export function createFile(dir: string, filename: string, content: string): void {
  writeFileSync(join(dir, filename), content);
}

/**
 * Common test fixtures for Go modules
 */
export const GoFixtures = {
  /**
   * Minimal valid go.mod file
   */
  minimalGoMod: `module example.com/test
`,

  /**
   * go.mod with single require statement
   */
  singleRequire: (module: string, version: string) => `module example.com/test

require ${module} ${version}
`,

  /**
   * go.mod with require block
   */
  requireBlock: (requires: Array<{ module: string; version: string; indirect?: boolean }>) => {
    const deps = requires
      .map((r) => `\t${r.module} ${r.version}${r.indirect ? ' // indirect' : ''}`)
      .join('\n');
    return `module example.com/test

require (
${deps}
)
`;
  },

  /**
   * go.sum entry format: "module version hash"
   */
  goSumEntry: (module: string, version: string, hash = 'h1:hash') =>
    `${module} ${version} ${hash}\n`,
};

/**
 * Common test fixtures for Node/npm modules
 */
export const NodeFixtures = {
  /**
   * Minimal package.json
   */
  minimalPackageJson: (name = 'test-package') => JSON.stringify({
    name,
    version: '1.0.0',
  }),

  /**
   * package.json with dependencies
   */
  packageJsonWithDeps: (
    deps: Record<string, string>,
    devDeps?: Record<string, string>
  ) => JSON.stringify({
    name: 'test-package',
    version: '1.0.0',
    dependencies: deps,
    ...(devDeps && { devDependencies: devDeps }),
  }),

  /**
   * package.json with packageManager field (for Yarn berry detection)
   */
  packageJsonWithManager: (manager: string) => JSON.stringify({
    name: 'test-package',
    version: '1.0.0',
    packageManager: manager,
  }),
};

/**
 * Assertion helpers for common test patterns
 */
export const TestAssertions = {
  /**
   * Assert that a dependency list contains a specific package
   */
  hasDependency: (
    deps: Array<{ name: string; version?: string; ecosystem?: string }>,
    name: string,
    version?: string
  ): boolean => {
    return deps.some((d) => {
      const nameMatch = d.name === name;
      const versionMatch = version ? d.version === version : true;
      return nameMatch && versionMatch;
    });
  },

  /**
   * Assert that all dependencies have required fields
   */
  allHaveRequiredFields: (
    deps: Array<{ name: string; version: string; ecosystem: string }>
  ): boolean => {
    return deps.every((d) => d.name && d.version && d.ecosystem);
  },

  /**
   * Assert no duplicate dependencies
   */
  noDuplicates: (deps: Array<{ name: string; version: string }>): boolean => {
    const seen = new Set<string>();
    for (const dep of deps) {
      const key = `${dep.name}@${dep.version}`;
      if (seen.has(key)) return false;
      seen.add(key);
    }
    return true;
  },
};

/**
 * Mock helpers for common test scenarios
 */
export const MockHelpers = {
  /**
   * Creates a mock console.warn that can be restored
   * Useful for testing warning messages
   *
   * @example
   * ```typescript
   * const mockWarn = MockHelpers.mockConsoleWarn();
   * // ... test code that should warn ...
   * expect(mockWarn.spy).toHaveBeenCalledWith(expect.stringContaining('warning'));
   * mockWarn.restore();
   * ```
   */
  mockConsoleWarn: () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    return {
      spy,
      restore: () => spy.mockRestore(),
    };
  },

  /**
   * Creates a mock console.log that can be restored
   */
  mockConsoleLog: () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    return {
      spy,
      restore: () => spy.mockRestore(),
    };
  },
};

// Re-export vitest functions for convenience
export { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Re-export common Node.js functions for convenience
export { writeFileSync, rmSync, readFileSync, existsSync } from 'node:fs';
export { join, resolve, dirname } from 'node:path';
