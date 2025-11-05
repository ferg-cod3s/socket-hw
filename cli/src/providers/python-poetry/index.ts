/**
 * Python Poetry pyproject.toml and poetry.lock Parser
 *
 * Supports Poetry formats:
 * - poetry.lock: TOML format with [[package]] sections (stable format since Poetry 1.0)
 * - pyproject.toml: PEP 518/621 format with [tool.poetry] sections
 *
 * Documentation:
 * - Poetry dependency specification: https://python-poetry.org/docs/dependency-specification/
 * - Poetry lockfile: https://python-poetry.org/docs/basic-usage/#installing-dependencies
 * - pyproject.toml PEP 621: https://peps.python.org/pep-0621/
 *
 * Format notes:
 * - poetry.lock: Uses [[package]] arrays with name, version, category (main/dev)
 * - pyproject.toml: Supports both legacy and modern dev dependency formats:
 *   - Legacy (Poetry <1.2): [tool.poetry.dev-dependencies]
 *   - Modern (Poetry 1.2+): [tool.poetry.group.dev.dependencies]
 * - Poetry 2.0+ supports PEP 621 [project] section but still uses [tool.poetry] for dependencies
 * - Version constraints: supports ^, ~, >=, <=, ==, !=, wildcards, and ranges
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type {
  EcosystemProvider,
  DetectionResult,
  LockfileOptions,
  Dependency,
  GatherDepsOptions,
} from '../types.js';

const execFileAsync = promisify(execFile);

export class PythonPoetryProvider implements EcosystemProvider {
  supportedManifests: string[] = [
    'pyproject.toml',
    'poetry.lock',
  ];

  getSupportedManifests(): string[] {
    return this.supportedManifests;
  }

  detect(dir: string): DetectionResult | null {
    const pyprojectPath = join(dir, 'pyproject.toml');
    if (!existsSync(pyprojectPath)) {
      return null;
    }

    // Check if it's actually a Poetry project
    try {
      const content = readFileSync(pyprojectPath, 'utf8');
      if (
        content.includes('[tool.poetry]') ||
        content.includes('[tool.poetry.dependencies]')
      ) {
        return {
          providerId: 'python-poetry',
          name: 'Poetry',
          confidence: 1.0,
        };
      }
    } catch {
      // ignore read errors
    }

    return null;
  }

  async ensureLockfile(dir: string, opts: LockfileOptions): Promise<void> {
    const lockPath = join(dir, 'poetry.lock');
    const hasLock = existsSync(lockPath);

    // Force options
    if (opts.forceRefresh) {
      await execFileAsync('poetry', ['lock', '--no-update'], { cwd: dir });
      return;
    }

    if (opts.forceValidate) {
      await execFileAsync('poetry', ['check', '--lock'], { cwd: dir });
      return;
    }

    if (!hasLock && opts.createIfMissing) {
      await execFileAsync('poetry', ['lock', '--no-update'], { cwd: dir });
      return;
    }

    if (hasLock && opts.validateIfPresent) {
      await execFileAsync('poetry', ['check', '--lock'], { cwd: dir });
    }
  }

  async gatherDependencies(
    dir: string,
    opts: GatherDepsOptions
  ): Promise<Dependency[]> {
    const lockPath = join(dir, 'poetry.lock');

    // If lockfile exists, parse it for resolved versions
    if (existsSync(lockPath)) {
      return this.parseLockfile(lockPath, opts);
    }

    // Fallback: parse pyproject.toml for declared versions
    return this.parsePyproject(dir, opts);
  }

  private parseLockfile(
    lockPath: string,
    opts: GatherDepsOptions
  ): Dependency[] {
    const content = readFileSync(lockPath, 'utf8');
    const deps: Dependency[] = [];

    // Parse TOML manually (simple approach for [[package]] sections)
    const packageBlocks = content.split('\n[[package]]');

    for (const block of packageBlocks) {
      if (!block.trim()) continue;

      const nameMatch = block.match(/^name\s*=\s*"([^"]+)"/m);
      const versionMatch = block.match(/^version\s*=\s*"([^"]+)"/m);
      const categoryMatch = block.match(/^category\s*=\s*"([^"]+)"/m);

      if (nameMatch && versionMatch) {
        const name = nameMatch[1];
        const version = versionMatch[1];
        const category = categoryMatch?.[1];

        // Skip dev dependencies unless includeDev is true
        if (category === 'dev' && !opts.includeDev) {
          continue;
        }

        deps.push({
          name,
          version,
          ecosystem: 'PyPI',
        });
      }
    }

    return deps;
  }

  private parsePyproject(dir: string, opts: GatherDepsOptions): Dependency[] {
    const pyprojectPath = join(dir, 'pyproject.toml');
    const content = readFileSync(pyprojectPath, 'utf8');
    const deps: Dependency[] = [];

    // Simple TOML parsing for [tool.poetry.dependencies]
    const depsSection = this.extractSection(
      content,
      '[tool.poetry.dependencies]'
    );
    if (depsSection) {
      for (const [name, version] of this.parseTomlKeyValues(depsSection)) {
        // Skip python itself
        if (name === 'python') continue;
        deps.push({ name, version, ecosystem: 'PyPI' });
      }
    }

    // Dev dependencies
    if (opts.includeDev) {
      const devSection = this.extractSection(
        content,
        '[tool.poetry.dev-dependencies]'
      );
      if (devSection) {
        for (const [name, version] of this.parseTomlKeyValues(devSection)) {
          deps.push({ name, version, ecosystem: 'PyPI' });
        }
      }

      // Poetry 1.2+ uses group.dev
      const groupDevSection = this.extractSection(
        content,
        '[tool.poetry.group.dev.dependencies]'
      );
      if (groupDevSection) {
        for (const [name, version] of this.parseTomlKeyValues(
          groupDevSection
        )) {
          deps.push({ name, version, ecosystem: 'PyPI' });
        }
      }
    }

    return deps;
  }

  private extractSection(content: string, header: string): string | null {
    const lines = content.split('\n');
    let inSection = false;
    const sectionLines: string[] = [];

    for (const line of lines) {
      if (line.trim() === header) {
        inSection = true;
        continue;
      }
      if (inSection) {
        // Stop at next section
        if (line.trim().startsWith('[')) {
          break;
        }
        sectionLines.push(line);
      }
    }

    return inSection ? sectionLines.join('\n') : null;
  }

  private parseTomlKeyValues(section: string): Array<[string, string]> {
    const pairs: Array<[string, string]> = [];
    const lines = section.split('\n');

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;

      // Simple key = "value" or key = {version = "value"}
      const simpleMatch = trimmed.match(/^(\S+)\s*=\s*"([^"]+)"/);
      if (simpleMatch) {
        pairs.push([simpleMatch[1], simpleMatch[2]]);
        continue;
      }

      // Complex: key = {version = "^1.0"}
      const complexMatch = trimmed.match(/^(\S+)\s*=\s*\{.*version\s*=\s*"([^"]+)"/);
      if (complexMatch) {
        pairs.push([complexMatch[1], complexMatch[2]]);
      }
    }

    return pairs;
  }
}

