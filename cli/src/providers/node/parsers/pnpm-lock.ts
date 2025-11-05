/**
 * pnpm pnpm-lock.yaml Parser
 *
 * Supports lockfile versions:
 * - v6: pnpm v6-v7 (package keys with leading "/": "/package@version")
 * - v9: pnpm v9 (package keys without leading "/": "package@version")
 * - v10: pnpm v10 (same format as v9, uses SHA256 hashing instead of MD5/SHA512)
 *
 * Documentation:
 * - pnpm lockfile format: https://pnpm.io/pnpm-lock-yaml
 * - pnpm v10 release notes: https://github.com/pnpm/pnpm/releases/tag/v10.0.0
 *
 * Format notes:
 * - v6 package format: "/package-name@1.2.3" or "/@scope/package@1.2.3"
 * - v9+ package format: "package-name@1.2.3" or "@scope/package@1.2.3"
 * - Supports catalog references: "package@catalog:key"
 * - Supports peer dependencies: "package@1.2.3(peer@1.0.0)"
 * - v10 introduced SHA256 hashing for integrity checks
 */

import { parse as parseYaml } from 'yaml';
import type { Dependency } from '../../types.js';

interface PnpmLock {
  lockfileVersion: string | number;
  dependencies?: Record<string, { specifier: string; version: string }>;
  devDependencies?: Record<string, { specifier: string; version: string }>;
  packages?: Record<string, {
    version?: string;
    dev?: boolean;
    dependencies?: Record<string, string>;
  }>;
}

export function parsePnpmLock(lockContent: string, includeDev: boolean): Dependency[] {
  const lock = parseYaml(lockContent) as PnpmLock;
  const deps: Dependency[] = [];
  const seen = new Set<string>();

  if (!lock.packages) {
    return deps;
  }

  for (const [pkgSpec, pkgData] of Object.entries(lock.packages)) {
    // Skip dev dependencies unless includeDev is true
    if (pkgData.dev && !includeDev) {
      continue;
    }

    // Skip workspace protocol packages
    if (pkgSpec.includes('workspace:')) {
      continue;
    }

    // Extract name and version from package spec
    // Format v6: "/package-name@1.2.3" or "/@scope/package-name@1.2.3"
    // Format v9+: "package-name@1.2.3" or "@scope/package-name@1.2.3" (v9, v10, etc.)
    // Or with catalog: "/package-name@catalog:key" or "package-name@catalog:key"
    let name: string;
    let version: string;

    // Handle both v6 (with leading /) and v9+ (without leading /) formats
    const spec = pkgSpec.startsWith('/') ? pkgSpec.slice(1) : pkgSpec;

    // Handle peer dependencies first: "react-dom@18.2.0(react@18.2.0)"
    const specWithoutPeer = spec.includes('(') ? spec.split('(')[0] : spec;

    // Handle catalog references - version should be in pkgData.version
    if (specWithoutPeer.includes('@catalog:')) {
      const namePart = specWithoutPeer.split('@catalog:')[0];
      name = namePart;
      version = pkgData.version || specWithoutPeer.split('@')[1] || '*';
    } else {
      // Regular format: "package-name@1.2.3" or "@scope/package-name@1.2.3"
      const lastAtIdx = specWithoutPeer.lastIndexOf('@');
      if (lastAtIdx === -1) continue;

      name = specWithoutPeer.slice(0, lastAtIdx);
      version = pkgData.version || specWithoutPeer.slice(lastAtIdx + 1);
    }

    if (!version || version === '*') continue;

    // Deduplicate by name+version
    const key = `${name}@${version}`;
    if (seen.has(key)) continue;
    seen.add(key);

    deps.push({
      name,
      version,
      ecosystem: 'npm',
    });
  }

  return deps;
}

