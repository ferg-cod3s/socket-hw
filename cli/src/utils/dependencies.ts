import fs from 'fs';
import { join } from 'node:path';
import { detectPackageManager, ensureLockfile } from './pm.js';

export type DeclaredDependency = { name: string; version: string; ecosystem: 'npm' };

export async function readDeclaredDependencies(dir: string, opts: { includeDev?: boolean } = {}): Promise<DeclaredDependency[]> {
  const pkgRaw = fs.readFileSync(join(dir, 'package.json'), { encoding: 'utf8' });
  const pkg = JSON.parse(pkgRaw) as any;
  const out: DeclaredDependency[] = [];
  for (const [name, version] of Object.entries(pkg.dependencies ?? {})) {
    out.push({ name, version: String(version), ecosystem: 'npm' });
  }
  if (opts.includeDev) {
    for (const [name, version] of Object.entries(pkg.devDependencies ?? {})) {
      out.push({ name, version: String(version), ecosystem: 'npm' });
    }
  }
  return out;
}

export async function gatherDependencies(dir: string, opts: { includeDev?: boolean } = {}): Promise<DeclaredDependency[]> {
  // Detect package manager
  const pm = detectPackageManager(dir);

  // Ensure lockfile exists
  await ensureLockfile(dir, pm, { createIfMissing: true });

  // Try to parse lockfile for resolved versions
  try {
    if (pm.name === 'npm') {
      return await parseNpmLock(dir, opts);
    } else if (pm.name === 'pnpm') {
      return await parsePnpmLock(dir, opts);
    } else if (pm.name === 'yarn') {
      return await parseYarnLock(dir, opts);
    }
  } catch (err) {
    // Fall back to declared deps if lockfile parsing fails
    console.warn(`Failed to parse lockfile, using declared versions: ${err}`);
  }

  // Fallback: use declared deps from package.json
  return readDeclaredDependencies(dir, opts);
}

async function parseNpmLock(dir: string, opts: { includeDev?: boolean }): Promise<DeclaredDependency[]> {
  const lockPath = join(dir, 'package-lock.json');
  if (!fs.existsSync(lockPath)) {
    throw new Error('package-lock.json not found');
  }

  const lockRaw = fs.readFileSync(lockPath, 'utf8');
  const lock = JSON.parse(lockRaw);

  // Read package.json to know which are top-level deps
  const pkgRaw = fs.readFileSync(join(dir, 'package.json'), 'utf8');
  const pkg = JSON.parse(pkgRaw);

  const topLevelDeps = new Set(Object.keys(pkg.dependencies ?? {}));
  const topLevelDevDeps = new Set(Object.keys(pkg.devDependencies ?? {}));

  const out: DeclaredDependency[] = [];

  // Parse package-lock v2/v3 format (with packages field)
  if (lock.packages) {
    for (const [path, pkgInfo] of Object.entries(lock.packages as Record<string, any>)) {
      // Skip root package
      if (path === '') continue;

      // Extract package name from path (node_modules/package-name)
      const name = path.replace(/^node_modules\//, '').split('/node_modules/').pop() || '';

      // Only include top-level dependencies
      const isTopLevel = topLevelDeps.has(name);
      const isTopLevelDev = topLevelDevDeps.has(name);

      if (isTopLevel || (opts.includeDev && isTopLevelDev)) {
        const version = pkgInfo.version as string | undefined;
        if (version) {
          out.push({ name, version, ecosystem: 'npm' });
        }
      }
    }
  }

  return out;
}

async function parsePnpmLock(dir: string, opts: { includeDev?: boolean }): Promise<DeclaredDependency[]> {
  const lockPath = join(dir, 'pnpm-lock.yaml');
  if (!fs.existsSync(lockPath)) {
    throw new Error('pnpm-lock.yaml not found');
  }

  const lockRaw = fs.readFileSync(lockPath, 'utf8');

  // Simple YAML parser for pnpm-lock.yaml
  // Look for the importers section which contains top-level dependencies
  const out: DeclaredDependency[] = [];

  // Parse dependencies section under importers > .
  const lines = lockRaw.split('\n');
  let inRootImporter = false;
  let inDependencies = false;
  let inDevDependencies = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Check if we're in the root importer
    if (line.trim() === '.:') {
      inRootImporter = true;
      continue;
    }

    // Exit root importer if we hit another importer
    if (inRootImporter && line.match(/^\s{2}\S/)) {
      inRootImporter = false;
      inDependencies = false;
      inDevDependencies = false;
    }

    if (inRootImporter) {
      // Check for dependencies/devDependencies sections
      if (line.trim() === 'dependencies:') {
        inDependencies = true;
        inDevDependencies = false;
        continue;
      }
      if (line.trim() === 'devDependencies:') {
        inDependencies = false;
        inDevDependencies = true;
        continue;
      }

      // Exit sections if we hit another top-level key
      if (line.match(/^\s{4}\S/) && line.includes(':') && !line.includes('version:')) {
        inDependencies = false;
        inDevDependencies = false;
      }

      // Parse dependency entries
      if ((inDependencies || (inDevDependencies && opts.includeDev)) && line.match(/^\s{6}\S/)) {
        const nameMatch = line.match(/^\s{6}(\S+):/);
        if (nameMatch) {
          const name = nameMatch[1];

          // Look for version on next line
          if (i + 2 < lines.length) {
            const versionLine = lines[i + 2];
            const versionMatch = versionLine.match(/^\s{8}version:\s*(.+)/);
            if (versionMatch) {
              const version = versionMatch[1].trim();
              out.push({ name, version, ecosystem: 'npm' });
            }
          }
        }
      }
    }
  }

  return out;
}

async function parseYarnLock(dir: string, opts: { includeDev?: boolean }): Promise<DeclaredDependency[]> {
  const lockPath = join(dir, 'yarn.lock');
  if (!fs.existsSync(lockPath)) {
    throw new Error('yarn.lock not found');
  }

  const lockRaw = fs.readFileSync(lockPath, 'utf8');

  // Read package.json to know which are top-level deps
  const pkgRaw = fs.readFileSync(join(dir, 'package.json'), 'utf8');
  const pkg = JSON.parse(pkgRaw);

  const topLevelDeps = new Map<string, string>();
  for (const [name, version] of Object.entries(pkg.dependencies ?? {})) {
    topLevelDeps.set(name, String(version));
  }
  if (opts.includeDev) {
    for (const [name, version] of Object.entries(pkg.devDependencies ?? {})) {
      topLevelDeps.set(name, String(version));
    }
  }

  const out: DeclaredDependency[] = [];
  const resolvedVersions = new Map<string, string>();

  // Parse yarn.lock format
  const lines = lockRaw.split('\n');
  let currentPackage: string | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Package entry starts with package@version: (no leading whitespace or just quotes)
    if (line.match(/^[^#\s]/) && line.includes(':')) {
      // Extract package name (before @version)
      const pkgPattern = line.split(':')[0].trim();
      // Handle quoted package names and multiple patterns
      const patterns = pkgPattern.split(/,\s*/);
      if (patterns.length > 0) {
        const firstPattern = patterns[0].replace(/^["']|["']$/g, '');

        // Handle scoped packages like @babel/core@^7.24.0
        // For scoped packages, keep the @ in the name
        let pkgName: string;
        if (firstPattern.startsWith('@')) {
          // Scoped package: @scope/name@version -> @scope/name
          const parts = firstPattern.split('@');
          // parts = ['', 'scope/name', 'version']
          pkgName = `@${parts[1]}`;
        } else {
          // Regular package: name@version -> name
          pkgName = firstPattern.split('@')[0];
        }

        currentPackage = pkgName;
      }
      continue;
    }

    // Version line
    if (currentPackage && line.match(/^\s+version\s+"(.+)"/)) {
      const match = line.match(/^\s+version\s+"(.+)"/);
      if (match) {
        const version = match[1];
        resolvedVersions.set(currentPackage, version);
        currentPackage = null;
      }
    }
  }

  // Match top-level deps with their resolved versions
  for (const [name, declaredVersion] of topLevelDeps) {
    const version = resolvedVersions.get(name) || declaredVersion;
    out.push({ name, version, ecosystem: 'npm' });
  }

  return out;
}
