import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export type PackageManagerName = 'pnpm' | 'npm' | 'yarn';
export type YarnVariant = 'classic' | 'berry';

export interface DetectedPm {
  name: PackageManagerName;
  variant?: YarnVariant;
}

export function detectPackageManager(dir: string): DetectedPm {
  // 1) Lockfiles
  if (existsSync(join(dir, 'pnpm-lock.yaml'))) return { name: 'pnpm' };
  if (existsSync(join(dir, 'yarn.lock'))) return { name: 'yarn', variant: detectYarnVariant(dir) };
  if (existsSync(join(dir, 'package-lock.json')) || existsSync(join(dir, 'npm-shrinkwrap.json'))) return { name: 'npm' };

  // 2) package.json packageManager
  const pkgPath = join(dir, 'package.json');
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as any;
      if (typeof pkg?.packageManager === 'string') {
        if (pkg.packageManager.startsWith('pnpm@')) return { name: 'pnpm' };
        if (pkg.packageManager.startsWith('yarn@')) return { name: 'yarn', variant: detectYarnVariant(dir, pkg.packageManager) };
        if (pkg.packageManager.startsWith('npm@')) return { name: 'npm' };
      }
    } catch {
      // ignore
    }
  }

  // 3) workspace hint
  if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return { name: 'pnpm' };

  // 4) default
  return { name: 'npm' };
}

function detectYarnVariant(dir: string, packageManagerField?: string): YarnVariant {
  // Berry is v2+; Classic is v1
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

export interface EnsureLockOptions {
  forceRefresh?: boolean; // always rewrite lock
  forceValidate?: boolean; // always validate
  createIfMissing?: boolean; // create when no lock
  validateIfPresent?: boolean; // validate when lock exists
}

export async function ensureLockfile(dir: string, pm: DetectedPm, opts: EnsureLockOptions): Promise<void> {
  const hasPnpmLock = existsSync(join(dir, 'pnpm-lock.yaml'));
  const hasYarnLock = existsSync(join(dir, 'yarn.lock'));
  const hasNpmLock = existsSync(join(dir, 'package-lock.json')) || existsSync(join(dir, 'npm-shrinkwrap.json'));

  const hasLock = pm.name === 'pnpm' ? hasPnpmLock : pm.name === 'yarn' ? hasYarnLock : hasNpmLock;

  // Force options
  if (opts.forceRefresh) {
    await runRefresh(dir, pm);
    return;
  }
  if (opts.forceValidate) {
    await runValidate(dir, pm);
    return;
  }

  if (!hasLock && opts.createIfMissing) {
    await runCreate(dir, pm);
    return;
  }

  if (hasLock && opts.validateIfPresent) {
    await runValidate(dir, pm);
  }
}

async function runCreate(dir: string, pm: DetectedPm): Promise<void> {
  if (pm.name === 'pnpm') {
    await execFileAsync('pnpm', ['install', '--lockfile-only'], { cwd: dir });
    return;
  }
  if (pm.name === 'npm') {
    await execFileAsync('npm', ['install', '--package-lock-only'], { cwd: dir });
    return;
  }
  // yarn
  if (pm.variant === 'berry') {
    await execFileAsync('yarn', ['install', '--mode=update-lockfile'], { cwd: dir });
  } else {
    await execFileAsync('yarn', ['install'], { cwd: dir });
  }
}

async function runRefresh(dir: string, pm: DetectedPm): Promise<void> {
  // Same as create for our purposes
  await runCreate(dir, pm);
}

async function runValidate(dir: string, pm: DetectedPm): Promise<void> {
  if (pm.name === 'pnpm') {
    await execFileAsync('pnpm', ['install', '--frozen-lockfile'], { cwd: dir });
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
    await execFileAsync('yarn', ['install', '--frozen-lockfile'], { cwd: dir });
  }
}


