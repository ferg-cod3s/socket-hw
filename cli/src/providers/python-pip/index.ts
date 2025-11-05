/**
 * Python pip requirements.txt Parser
 *
 * Supports requirements.txt format:
 * - PEP 508: Dependency specification format
 * - PEP 440: Version identification and dependency specification
 *
 * Documentation:
 * - PEP 508: https://peps.python.org/pep-0508/
 * - PEP 440: https://peps.python.org/pep-0440/
 * - pip requirements file: https://pip.pypa.io/en/stable/reference/requirements-file-format/
 *
 * Format notes:
 * - Exact versions: "package==1.2.3"
 * - Version ranges: "package>=1.0,<2.0"
 * - Extras: "package[extra]==1.2.3"
 * - Inline comments: "package==1.2.3  # comment"
 * - Skips: editable installs (-e), URLs, options (-r, --index-url)
 * - Package names normalized to lowercase (PyPI convention)
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

export class PythonPipProvider implements EcosystemProvider {
  supportedManifests: string[] = [
    'requirements.txt',
  ];

  getSupportedManifests(): string[] {
    return this.supportedManifests;
  }

  detect(dir: string): DetectionResult | null {
    // Only detect if requirements.txt exists AND pyproject.toml doesn't
    // (Poetry provider should take precedence)
    const hasRequirements = existsSync(join(dir, 'requirements.txt'));
    const hasPyproject = existsSync(join(dir, 'pyproject.toml'));

    if (!hasRequirements || hasPyproject) {
      return null;
    }

    return {
      providerId: 'python-pip',
      name: 'pip',
      confidence: 0.9,
    };
  }

  async ensureLockfile(dir: string, opts: LockfileOptions): Promise<void> {
    // requirements.txt doesn't have a standard lockfile format
    // Could support requirements-lock.txt or Pipfile.lock in future
    // For now, just verify requirements.txt exists

    const requirementsPath = join(dir, 'requirements.txt');
    if (!existsSync(requirementsPath)) {
      throw new Error('requirements.txt not found');
    }

    // No lockfile validation for base requirements.txt
    if (opts.forceValidate) {
      console.warn('Lockfile validation not supported for requirements.txt');
    }
  }

  async gatherDependencies(
    dir: string,
    opts: GatherDepsOptions
  ): Promise<Dependency[]> {
    const reqPath = join(dir, 'requirements.txt');
    const content = readFileSync(reqPath, 'utf8');

    return parseRequirementsTxt(content);
  }
}

function parseRequirementsTxt(content: string): Dependency[] {
  const deps: Dependency[] = [];
  const lines = content.split('\n');

  for (let line of lines) {
    line = line.trim();

    // Skip comments and empty lines
    if (!line || line.startsWith('#')) continue;

    // Skip editable installs and URLs
    if (line.startsWith('-e') || line.includes('://')) continue;

    // Skip options like -r, --index-url, etc.
    if (line.startsWith('-')) continue;

    // Parse package spec: "package==1.2.3" or "package>=1.0,<2.0"
    // Handle extras: "package[extra]==1.2.3"
    // Handle inline comments: "package==1.2.3  # comment"
    const match = line.match(/^([a-zA-Z0-9_-]+[a-zA-Z0-9._-]*)(?:\[[^\]]+\])?(.*?)(?:\s*#.*)?$/);
    if (!match) continue;

    const [, name, versionSpec] = match;

    // Extract exact version if available
    const exactMatch = versionSpec.match(/==([0-9.]+(?:[a-zA-Z0-9._-]*)?)/);
    const version = exactMatch ? exactMatch[1] : versionSpec.trim() || '*';

    deps.push({
      name: name.toLowerCase(), // PyPI normalizes to lowercase
      version,
      ecosystem: 'PyPI',
    });
  }

  return deps;
}

