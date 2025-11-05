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
import { parseNpmLock } from './parsers/npm-lock.js';
import { parsePnpmLock } from './parsers/pnpm-lock.js';
import { parseYarnClassic, parseYarnBerry } from './parsers/yarn-lock.js';

const execFileAsync = promisify(execFile);

type PackageManagerName = 'pnpm' | 'npm' | 'yarn';
type YarnVariant = 'classic' | 'berry';

interface DetectedPm {
  name: PackageManagerName;
  variant?: YarnVariant;
}

export class NodeProvider implements EcosystemProvider {
  supportedManifests: string[] = [
      'package.json',
      'package-lock.json',
      'npm-shrinkwrap.json',
      'pnpm-lock.yaml',
      'pnpm-workspace.yaml',
      'yarn.lock',
    ];

  getSupportedManifests(): string[] {
    return this.supportedManifests;
  }

  detect(dir: string): DetectionResult | null {
    // Check for Node.js manifest
    if (!existsSync(join(dir, 'package.json'))) {
      return null;
    }

    const pm = this.detectPackageManager(dir);
    return {
      providerId: 'node',
      name: pm.name,
      variant: pm.variant,
      confidence: 1.0,
    };
  }

  async ensureLockfile(dir: string, opts: LockfileOptions): Promise<void> {
    const pm = this.detectPackageManager(dir);
    const hasPnpmLock = existsSync(join(dir, 'pnpm-lock.yaml'));
    const hasYarnLock = existsSync(join(dir, 'yarn.lock'));
    const hasNpmLock =
      existsSync(join(dir, 'package-lock.json')) ||
      existsSync(join(dir, 'npm-shrinkwrap.json'));

    const hasLock =
      pm.name === 'pnpm'
        ? hasPnpmLock
        : pm.name === 'yarn'
          ? hasYarnLock
          : hasNpmLock;

    // Force options
    if (opts.forceRefresh) {
      await this.runRefresh(dir, pm);
      return;
    }
    if (opts.forceValidate) {
      await this.runValidate(dir, pm);
      return;
    }

    if (!hasLock && opts.createIfMissing) {
      await this.runCreate(dir, pm);
      return;
    }

    if (hasLock && opts.validateIfPresent) {
      await this.runValidate(dir, pm);
    }
  }

  async gatherDependencies(
    dir: string,
    opts: GatherDepsOptions
  ): Promise<Dependency[]> {
    // Try lockfile parsing first for resolved versions and transitive deps
    try {
      // If a standalone lockfile path is provided, use it directly
      if (opts.standaloneLockfile) {
        const lockContent = readFileSync(opts.standaloneLockfile, 'utf8');
        const filename = opts.standaloneLockfile.split('/').pop() || '';

        // Determine parser from filename
        if (filename.endsWith('pnpm-lock.yaml')) {
          return parsePnpmLock(lockContent, opts.includeDev ?? false);
        } else if (filename.endsWith('package-lock.json') || filename.endsWith('npm-shrinkwrap.json')) {
          return parseNpmLock(lockContent);
        } else if (filename.endsWith('yarn.lock')) {
          // Detect yarn variant from lockfile content
          const isYarnBerry = lockContent.includes('__metadata:');
          return isYarnBerry
            ? parseYarnBerry(lockContent)
            : parseYarnClassic(lockContent);
        }

        // Unsupported standalone file types that need directory context
        if (filename.endsWith('package.json')) {
          throw new Error(
            'package.json requires a lockfile for accurate dependency resolution. ' +
            'Please upload the lockfile (package-lock.json, pnpm-lock.yaml, or yarn.lock) instead, ' +
            'or scan the directory containing both files.'
          );
        }

        if (filename.endsWith('pnpm-workspace.yaml')) {
          throw new Error(
            'pnpm-workspace.yaml only defines workspace structure, not dependencies. ' +
            'Please upload pnpm-lock.yaml from the workspace root for dependency scanning.'
          );
        }
      }

      // For directory-based scanning, detect package manager
      const pm = this.detectPackageManager(dir);

      // Otherwise, look for lockfiles in the directory
      if (pm.name === 'npm') {
        const lockPath = join(dir, 'package-lock.json');
        if (existsSync(lockPath)) {
          const lockContent = readFileSync(lockPath, 'utf8');
          return parseNpmLock(lockContent);
        }
      } else if (pm.name === 'pnpm') {
        const lockPath = join(dir, 'pnpm-lock.yaml');
        if (existsSync(lockPath)) {
          const lockContent = readFileSync(lockPath, 'utf8');
          return parsePnpmLock(lockContent, opts.includeDev ?? false);
        }
      } else if (pm.name === 'yarn') {
        const lockPath = join(dir, 'yarn.lock');
        if (existsSync(lockPath)) {
          const lockContent = readFileSync(lockPath, 'utf8');
          return pm.variant === 'berry'
            ? parseYarnBerry(lockContent)
            : parseYarnClassic(lockContent);
        }
      }
    } catch (err) {
      // If we were trying to parse a standalone lockfile, rethrow the error
      // instead of falling back to manifest parsing
      if (opts.standaloneLockfile) {
        throw err;
      }
      // Otherwise, fall back to manifest-only parsing if lockfile parsing fails
      // Silent fallback to avoid noise in tests - error is already logged if needed
    }

    // Fallback to manifest-only parsing (existing code)
    // Note: This requires package.json to exist in the directory
    return this.gatherFromManifest(dir, opts);
  }

  private gatherFromManifest(
    dir: string,
    opts: GatherDepsOptions
  ): Dependency[] {
    const pkgRaw = readFileSync(join(dir, 'package.json'), {
      encoding: 'utf8',
    });
    const pkg = JSON.parse(pkgRaw) as any;
    const out: Dependency[] = [];

    for (const [name, version] of Object.entries(pkg.dependencies ?? {})) {
      out.push({ name, version: String(version), ecosystem: 'npm' });
    }

    if (opts.includeDev) {
      for (const [name, version] of Object.entries(
        pkg.devDependencies ?? {}
      )) {
        out.push({ name, version: String(version), ecosystem: 'npm' });
      }
    }

    return out;
  }

  private detectPackageManager(dir: string): DetectedPm {
    // 1) Lockfiles
    if (existsSync(join(dir, 'pnpm-lock.yaml'))) return { name: 'pnpm' };
    if (existsSync(join(dir, 'yarn.lock')))
      return { name: 'yarn', variant: this.detectYarnVariant(dir) };
    if (
      existsSync(join(dir, 'package-lock.json')) ||
      existsSync(join(dir, 'npm-shrinkwrap.json'))
    )
      return { name: 'npm' };

    // 2) package.json packageManager
    const pkgPath = join(dir, 'package.json');
    if (existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as any;
        if (typeof pkg?.packageManager === 'string') {
          if (pkg.packageManager.startsWith('pnpm@'))
            return { name: 'pnpm' };
          if (pkg.packageManager.startsWith('yarn@'))
            return {
              name: 'yarn',
              variant: this.detectYarnVariant(dir, pkg.packageManager),
            };
          if (pkg.packageManager.startsWith('npm@')) return { name: 'npm' };
        }
      } catch {
        // ignore
      }
    }

    // 3) workspace hint
    if (existsSync(join(dir, 'pnpm-workspace.yaml')))
      return { name: 'pnpm' };

    // 4) default
    return { name: 'npm' };
  }

  private detectYarnVariant(
    dir: string,
    packageManagerField?: string
  ): YarnVariant {
    try {
      if (packageManagerField) {
        const ver = packageManagerField.split('@')[1];
        if (ver && Number.parseInt(ver, 10) >= 2) return 'berry';
      }
    } catch {
      // noop
    }
    return 'classic';
  }

  private async runCreate(dir: string, pm: DetectedPm): Promise<void> {
    if (pm.name === 'pnpm') {
      await execFileAsync('pnpm', ['install', '--lockfile-only'], {
        cwd: dir,
      });
      return;
    }
    if (pm.name === 'npm') {
      await execFileAsync('npm', ['install', '--package-lock-only'], {
        cwd: dir,
      });
      return;
    }
    // yarn
    if (pm.variant === 'berry') {
      await execFileAsync('yarn', ['install', '--mode=update-lockfile'], {
        cwd: dir,
      });
    } else {
      await execFileAsync('yarn', ['install'], { cwd: dir });
    }
  }

  private async runRefresh(dir: string, pm: DetectedPm): Promise<void> {
    await this.runCreate(dir, pm);
  }

  private async runValidate(dir: string, pm: DetectedPm): Promise<void> {
    if (pm.name === 'pnpm') {
      await execFileAsync('pnpm', ['install', '--frozen-lockfile'], {
        cwd: dir,
      });
      return;
    }
    if (pm.name === 'npm') {
      await execFileAsync('npm', ['ci', '--dry-run'], { cwd: dir });
      return;
    }
    // yarn
    if (pm.variant === 'berry') {
      await execFileAsync('yarn', ['install', '--immutable'], { cwd: dir });
    } else {
      await execFileAsync('yarn', ['install', '--frozen-lockfile'], {
        cwd: dir,
      });
    }
  }
}

