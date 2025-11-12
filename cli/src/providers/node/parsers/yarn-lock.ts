import { parse as parseYaml } from 'yaml';
import * as lockfile from '@yarnpkg/lockfile';
import type { Dependency } from '../../types.js';

export function parseYarnClassic(lockContent: string): Dependency[] {
  const parsed = lockfile.parse(lockContent);
  const deps: Dependency[] = [];
  const seen = new Set<string>();

  if (!parsed.object) {
    return deps;
  }

  for (const [key, value] of Object.entries(parsed.object)) {
    // Skip file: protocol packages (local file references)
    if (key.includes('file:')) {
      continue;
    }

    // Skip git: protocol packages (git references)
    if (key.includes('git+') || key.includes('github:') || key.includes('git:')) {
      continue;
    }

    // Key format: "package-name@version-range" or "@scope/package-name@version-range"
    // Extract package name
    const lastAtIdx = key.lastIndexOf('@');
    if (lastAtIdx === -1) continue;

    let name = key.slice(0, lastAtIdx);

    // Handle scoped packages with quotes
    if (name.startsWith('"') && name.endsWith('"')) {
      name = name.slice(1, -1);
    }

    // Type guard for value
    if (!value || typeof value !== 'object' || !('version' in value)) continue;

    const pkgValue = value as { version?: string };
    if (!pkgValue.version) continue;

    // Deduplicate by name+version
    const key2 = `${name}@${pkgValue.version}`;
    if (seen.has(key2)) continue;
    seen.add(key2);

    deps.push({
      name,
      version: pkgValue.version,
      ecosystem: 'npm',
    });
  }

  return deps;
}

export function parseYarnBerry(lockContent: string): Dependency[] {
  const lock = parseYaml(lockContent) as Record<string, any>;
  const deps: Dependency[] = [];
  const seen = new Set<string>();

  for (const [key, value] of Object.entries(lock)) {
    // Skip metadata
    if (key === '__metadata') continue;

    // Skip file: protocol packages (local file references)
    if (key.includes('file:')) {
      continue;
    }

    // Skip git: protocol packages (git references)
    if (key.includes('git+') || key.includes('github:') || key.includes('git:')) {
      continue;
    }

    // Type guard for value
    if (!value || typeof value !== 'object') continue;
    const pkgValue = value as { version?: string };

    // Key format: "package-name@npm:version-range" or "@scope/package-name@npm:version-range"
    // Extract name and version from key
    const npmMatch = key.match(/^(.+?)@npm:(.+)$/);
    if (!npmMatch) continue;

    let name = npmMatch[1];
    const versionRange = npmMatch[2];

    // Handle scoped packages with quotes
    if (name.startsWith('"') && name.endsWith('"')) {
      name = name.slice(1, -1);
    }

    // Version should be in value.version (resolved version)
    const version = pkgValue.version || versionRange;

    if (!version) continue;

    // Deduplicate by name+version
    const key2 = `${name}@${version}`;
    if (seen.has(key2)) continue;
    seen.add(key2);

    deps.push({
      name,
      version,
      ecosystem: 'npm',
    });
  }

  return deps;
}
