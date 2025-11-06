/**
 * Go modules parser
 *
 * Supports Go modules format:
 * - go.mod: Module definition and dependencies
 * - go.sum: Checksums for module versions (lockfile)
 *
 * Documentation:
 * - Go Modules: https://go.dev/ref/mod
 * - go.mod reference: https://go.dev/ref/mod#go-mod-file
 * - go.sum reference: https://go.dev/ref/mod#go-sum-files
 *
 * Format notes:
 * - go.mod defines dependencies with semantic versioning
 * - go.sum contains checksums for reproducible builds
 * - Indirect dependencies are marked with "// indirect"
 * - Replace directives can override module paths/versions
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type {
  EcosystemProvider,
  DetectionResult,
  LockfileOptions,
  Dependency,
  GatherDepsOptions,
} from '../types.js';

export class GoProvider implements EcosystemProvider {
  supportedManifests: string[] = [
    'go.mod',
    'go.sum',
  ];

  getSupportedManifests(): string[] {
    return this.supportedManifests;
  }

  detect(dir: string): DetectionResult | null {
    const hasGoMod = existsSync(join(dir, 'go.mod'));

    if (!hasGoMod) {
      return null;
    }

    return {
      providerId: 'go',
      name: 'Go modules',
      confidence: 1.0,
    };
  }

  async ensureLockfile(dir: string, opts: LockfileOptions): Promise<void> {
    const goModPath = join(dir, 'go.mod');
    if (!existsSync(goModPath)) {
      throw new Error('go.mod not found');
    }

    // go.sum is automatically managed by go commands
    // No need to validate or create it here
    if (opts.forceValidate) {
      const goSumPath = join(dir, 'go.sum');
      if (!existsSync(goSumPath)) {
        console.warn('go.sum not found - run "go mod download" to generate');
      }
    }
  }

  async gatherDependencies(
    dir: string,
    opts: GatherDepsOptions
  ): Promise<Dependency[]> {
    // If scanning a standalone file, parse it directly
    if (opts.standaloneLockfile) {
      const filename = opts.standaloneLockfile.split('/').pop() || '';
      const content = readFileSync(opts.standaloneLockfile, 'utf8');

      if (filename === 'go.sum') {
        return parseGoSum(content);
      } else if (filename === 'go.mod') {
        return parseGoMod(content, opts.includeDev ?? false);
      }
    }

    // Standard directory scanning - prefer go.sum for resolved versions
    const goSumPath = join(dir, 'go.sum');
    const goModPath = join(dir, 'go.mod');

    if (existsSync(goSumPath)) {
      const content = readFileSync(goSumPath, 'utf8');
      return parseGoSum(content);
    } else if (existsSync(goModPath)) {
      const content = readFileSync(goModPath, 'utf8');
      return parseGoMod(content, opts.includeDev ?? false);
    }

    throw new Error('Neither go.sum nor go.mod found');
  }
}

/**
 * Parse go.sum file to extract dependencies with exact versions
 * go.sum format: "module version h1:hash"
 * Example: "github.com/pkg/errors v0.9.1 h1:FEBLx1zS214owpjy7qsBeixbURkuhQAwrK5UwLGTwt4="
 */
function parseGoSum(content: string): Dependency[] {
  const deps: Dependency[] = [];
  const seen = new Set<string>();
  const lines = content.split('\n');

  for (let line of lines) {
    line = line.trim();
    if (!line) continue;

    // Parse format: "module version hash"
    const parts = line.split(' ');
    if (parts.length < 2) continue;

    const [modulePath, version] = parts;

    // Skip /go.mod entries (they're checksums for go.mod files)
    if (version.endsWith('/go.mod')) continue;

    // Extract just the version number (remove v prefix if present)
    const cleanVersion = version.startsWith('v') ? version.slice(1) : version;

    // Create unique key to deduplicate
    const key = `${modulePath}@${cleanVersion}`;
    if (seen.has(key)) continue;
    seen.add(key);

    deps.push({
      name: modulePath,
      version: cleanVersion,
      ecosystem: 'Go',
    });
  }

  return deps;
}

/**
 * Parse go.mod file to extract dependencies
 * go.mod format uses "require" blocks:
 * require (
 *   github.com/pkg/errors v0.9.1
 *   golang.org/x/sync v0.1.0 // indirect
 * )
 */
function parseGoMod(content: string, includeDev: boolean): Dependency[] {
  const deps: Dependency[] = [];
  const seen = new Set<string>();

  // Match require blocks: require ( ... )
  const requireBlockRegex = /require\s*\(([\s\S]*?)\)/g;

  // Parse require blocks first
  let match;
  const blockMatches: Array<{ start: number; end: number }> = [];

  while ((match = requireBlockRegex.exec(content)) !== null) {
    // Track positions of require blocks so we can exclude them later
    blockMatches.push({
      start: match.index,
      end: match.index + match[0].length,
    });

    const block = match[1];
    const lines = block.split('\n');

    for (let line of lines) {
      line = line.trim();
      if (!line || line.startsWith('//')) continue;

      // Parse format: "module version" or "module version // indirect"
      const lineMatch = line.match(/^(\S+)\s+(\S+)(?:\s+\/\/\s*(.*))?$/);
      if (!lineMatch) continue;

      const [, modulePath, version, comment] = lineMatch;
      const isIndirect = comment?.includes('indirect');

      // Skip indirect dependencies unless includeDev is true
      if (isIndirect && !includeDev) continue;

      // Extract just the version number (remove v prefix if present)
      const cleanVersion = version.startsWith('v') ? version.slice(1) : version;

      const key = `${modulePath}@${cleanVersion}`;
      if (seen.has(key)) continue;
      seen.add(key);

      deps.push({
        name: modulePath,
        version: cleanVersion,
        ecosystem: 'Go',
      });
    }
  }

  // Parse single-line require statements (excluding content in require blocks)
  // Build a string with require blocks removed
  let remainingContent = content;
  for (let i = blockMatches.length - 1; i >= 0; i--) {
    const { start, end } = blockMatches[i];
    remainingContent = remainingContent.slice(0, start) + remainingContent.slice(end);
  }

  const requireLineRegex = /require\s+(\S+)\s+(\S+)/g;
  while ((match = requireLineRegex.exec(remainingContent)) !== null) {
    const [, modulePath, version] = match;
    const cleanVersion = version.startsWith('v') ? version.slice(1) : version;

    const key = `${modulePath}@${cleanVersion}`;
    if (seen.has(key)) continue;
    seen.add(key);

    deps.push({
      name: modulePath,
      version: cleanVersion,
      ecosystem: 'Go',
    });
  }

  return deps;
}
