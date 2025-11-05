import type { EcosystemProvider, DetectionResult } from './types.js';
import { NodeProvider } from './node/index.js';
import { PythonPoetryProvider } from './python-poetry/index.js';
import { PythonPipProvider } from './python-pip/index.js';
import { GoProvider } from './go/index.js';

/**
 * Registry of all available ecosystem providers.
 * Providers are tried in order until one detects the ecosystem.
 */
const PROVIDERS: EcosystemProvider[] = [
  new NodeProvider(),
  new GoProvider(),
  new PythonPoetryProvider(), // Check first (more specific)
  new PythonPipProvider(),     // Then pip (more general)
];

/**
 * Detect which provider should handle the given directory.
 * Returns the provider and its detection result, or throws if none detected.
 *
 * @param dir - Directory to scan
 * @param standaloneLockfile - Optional path to a standalone lockfile for direct parsing
 */
export function selectProvider(dir: string, standaloneLockfile?: string | null): {
  provider: EcosystemProvider;
  detection: DetectionResult;
} {
  // If a standalone lockfile is provided, try to detect provider from filename
  if (standaloneLockfile) {
    const filename = standaloneLockfile.split('/').pop() || '';

    // Check Node.js lockfiles and manifests
    if (filename.endsWith('pnpm-lock.yaml') ||
        filename.endsWith('pnpm-workspace.yaml') ||
        filename.endsWith('package.json') ||
        filename.endsWith('package-lock.json') ||
        filename.endsWith('npm-shrinkwrap.json') ||
        filename.endsWith('yarn.lock')) {
      const nodeProvider = PROVIDERS.find(p => p instanceof NodeProvider);
      if (nodeProvider) {
        // Determine package manager from filename
        let pmName: string = 'npm';
        if (filename.endsWith('pnpm-lock.yaml') || filename.endsWith('pnpm-workspace.yaml')) {
          pmName = 'pnpm';
        } else if (filename.endsWith('yarn.lock')) {
          pmName = 'yarn';
        }
        // For package.json, default to npm (actual PM will be detected from content if needed)

        return {
          provider: nodeProvider,
          detection: {
            providerId: 'node',
            name: pmName,
            confidence: 1.0,
          },
        };
      }
    }

    // Check Python lockfiles
    if (filename.endsWith('poetry.lock') || filename.endsWith('pyproject.toml')) {
      const poetryProvider = PROVIDERS.find(p => p instanceof PythonPoetryProvider);
      if (poetryProvider) {
        return {
          provider: poetryProvider,
          detection: {
            providerId: 'python-poetry',
            name: 'poetry',
            confidence: 1.0,
          },
        };
      }
    }

    if (filename.endsWith('requirements.txt')) {
      const pipProvider = PROVIDERS.find(p => p instanceof PythonPipProvider);
      if (pipProvider) {
        return {
          provider: pipProvider,
          detection: {
            providerId: 'python-pip',
            name: 'pip',
            confidence: 1.0,
          },
        };
      }
    }

    // Check Go lockfiles
    if (filename === 'go.mod' || filename === 'go.sum') {
      const goProvider = PROVIDERS.find(p => p instanceof GoProvider);
      if (goProvider) {
        return {
          provider: goProvider,
          detection: {
            providerId: 'go',
            name: 'Go modules',
            confidence: 1.0,
          },
        };
      }
    }
  }

  // Standard directory-based detection
  for (const provider of PROVIDERS) {
    const detection = provider.detect(dir);
    if (detection) {
      return { provider, detection };
    }
  }

  throw new Error(
    `No supported ecosystem detected in ${dir}. Supported: Node.js (npm/pnpm/yarn), Go (modules), Python (Poetry, pip)`
  );
}

export type { EcosystemProvider, DetectionResult, Dependency, LockfileOptions, GatherDepsOptions } from './types.js';

/**
 * Returns the set of filenames that are considered valid inputs across providers
 * when a user passes a file path instead of a directory. This centralizes the
 * supported names close to provider implementations.
 */
export function getSupportedFilenames(): Set<string> {
  const names: string[] = [];
  for (const p of PROVIDERS as any[]) {
    if (typeof p.getSupportedManifests === 'function') {
      names.push(...p.getSupportedManifests());
    }
  }
  return new Set<string>(names);
}

