import { statSync, existsSync, readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import type { DetectionResult, Dependency } from '../providers/index.js';
import { selectProvider, getSupportedFilenames } from '../providers/index.js';
import { queryOsv, queryOsvBatch, type OsvBatchQuery, type OsvVuln } from '../api/osv.js';
import { queryGhsa, type GhsaAdvisory } from '../api/ghsa.js';
import { satisfies } from 'semver';
import { logger } from '../utils/logger.js';
import type { UnifiedAdvisory } from '../index.js';
import { findIgnoreConfig, loadIgnoreConfig, filterAdvisories } from '../utils/ignore.js';
import { checkMaintenanceBatch, type MaintenanceInfo } from '../utils/maintenance.js';

export interface ScanOptions {
  includeDev?: boolean;
  validateLock?: boolean;
  refreshLock?: boolean;
  concurrency?: number;
  ignoreFile?: string;
  checkMaintenance?: boolean;
}

export interface ScanResult {
  deps: Dependency[];
  advisoriesByPackage: Record<string, UnifiedAdvisory[]>;
  scanDurationMs: number;
  detection: DetectionResult;
  maintenanceInfo?: Map<string, MaintenanceInfo>;
}

export async function scanPath(inputPath: string, opts: ScanOptions = {}): Promise<ScanResult> {
  const start = Date.now();
  const pathStat = statSync(inputPath);

  let dir = inputPath;
  let standaloneLockfile: string | null = null;

  if (pathStat.isFile()) {
    const file = basename(inputPath);
    const supportedSet = getSupportedFilenames();

    // Check if filename matches exactly OR ends with a supported filename
    // This handles temp files like "8a161a-pnpm-lock.yaml"
    const isSupported = supportedSet.has(file) ||
      Array.from(supportedSet).some(supported => file.endsWith(supported));

    if (!isSupported) {
      const supported = Array.from(supportedSet).join(', ');
      throw new Error(
        `Unsupported file: ${file}. Supported files: ${supported}`
      );
    }

    // If scanning a standalone lockfile (not a manifest), remember the full path for direct parsing
    // Manifests like package.json, pyproject.toml, requirements.txt should use directory-based detection
    const manifestFiles = ['package.json', 'pyproject.toml', 'requirements.txt', 'go.mod'];
    const isManifest = manifestFiles.includes(file);

    if (!isManifest) {
      standaloneLockfile = inputPath;
    }
    dir = dirname(inputPath);
  }

  const { provider, detection } = selectProvider(dir, standaloneLockfile);

  // Ensure/validate lockfile per options. Default to no-ops to avoid spawning package managers in tests.
  await provider.ensureLockfile(dir, {
    forceRefresh: opts.refreshLock ?? false,
    forceValidate: opts.validateLock ?? false,
    createIfMissing: false,
    validateIfPresent: false,
  });

  const deps = await provider.gatherDependencies(dir, {
    includeDev: opts.includeDev ?? false,
    standaloneLockfile,
  });

  if (deps.length === 0) {
    return {
      deps,
      advisoriesByPackage: {},
      scanDurationMs: Date.now() - start,
      detection,
    };
  }

  let advisoriesByPackage = await scanPackages(deps, {
    concurrency: opts.concurrency ?? 10,
  });

  // Apply ignore list filtering if configured
  const ignoreFilePath = findIgnoreConfig(dir, opts.ignoreFile);
  if (ignoreFilePath) {
    const ignoreConfig = loadIgnoreConfig(ignoreFilePath);
    if (ignoreConfig) {
      advisoriesByPackage = filterAdvisories(advisoriesByPackage, deps, ignoreConfig);
    }
  }

  // Check maintenance status if requested
  let maintenanceInfo: Map<string, MaintenanceInfo> | undefined;
  if (opts.checkMaintenance) {
    logger.info('Checking package maintenance status...');
    maintenanceInfo = await checkMaintenanceBatch(deps, opts.concurrency ?? 5);
    const unmaintainedCount = Array.from(maintenanceInfo.values()).filter(
      (info) => info.isUnmaintained
    ).length;
    if (unmaintainedCount > 0) {
      logger.info(`Found ${unmaintainedCount} unmaintained package(s)`);
    }
  }

  return {
    deps,
    advisoriesByPackage,
    scanDurationMs: Date.now() - start,
    detection,
    maintenanceInfo,
  };
}

async function scanPackages(
  packages: Dependency[],
  opts: { concurrency: number }
): Promise<Record<string, UnifiedAdvisory[]>> {
  const results: Record<string, UnifiedAdvisory[]> = {};

  if (packages.length === 0) {
    return results;
  }

  // Step 1: Batch query OSV (up to 50 packages per batch)
  const MAX_BATCH_SIZE = 50;
  const osvResults = new Map<string, UnifiedAdvisory[]>();

  // Process OSV queries in batches
  for (let i = 0; i < packages.length; i += MAX_BATCH_SIZE) {
    const batch = packages.slice(i, i + MAX_BATCH_SIZE);

    try {
      const batchQueries: OsvBatchQuery[] = batch.map((pkg) => ({
        package: { ecosystem: pkg.ecosystem, name: pkg.name },
        version: pkg.version,
      }));

      const batchResponse = await queryOsvBatch(batchQueries);

      // Map batch results back to packages
      batchResponse.results.forEach((result, index) => {
        const pkg = batch[index];
        const advisories: UnifiedAdvisory[] = [];

        for (const vuln of result.vulns ?? []) {
          advisories.push({
            id: vuln.id,
            source: 'osv',
            severity: getSeverity(vuln),
            summary: vuln.summary,
            details: vuln.details,
            references: vuln.references?.map((r) => r.url),
            firstPatchedVersion: extractFirstPatchedVersionFromOsv(vuln),
            cveIds: extractCveIds(vuln),
          });
        }

        if (advisories.length > 0) {
          osvResults.set(pkg.name, advisories);
        }
      });
    } catch (err) {
      logger.debug({ err, batchSize: batch.length }, 'OSV batch query failed');
      // Fallback to individual queries for this batch
      for (const pkg of batch) {
        try {
          const osvResult = await queryOsv({
            package: { ecosystem: pkg.ecosystem, name: pkg.name },
            version: pkg.version,
          });

          const advisories: UnifiedAdvisory[] = [];
          for (const vuln of osvResult.vulns ?? []) {
            advisories.push({
              id: vuln.id,
              source: 'osv',
              severity: getSeverity(vuln),
              summary: vuln.summary,
              details: vuln.details,
              references: vuln.references?.map((r) => r.url),
              firstPatchedVersion: extractFirstPatchedVersionFromOsv(vuln),
              cveIds: extractCveIds(vuln),
            });
          }

          if (advisories.length > 0) {
            osvResults.set(pkg.name, advisories);
          }
        } catch (individualErr) {
          logger.debug({ err: individualErr, package: pkg.name }, 'OSV individual query failed');
        }
      }
    }
  }

  // Step 2: Query GHSA for each package (no batch endpoint available)
  const limit = pLimit(opts.concurrency);
  const ghsaQueries = packages.map((pkg) =>
    limit(async () => {
      try {
        const ghsaResult = await queryGhsa({
          ecosystem: pkg.ecosystem,
          packageName: pkg.name,
        });

        const advisories: UnifiedAdvisory[] = [];
        for (const adv of ghsaResult) {
          const isAffected = adv.vulnerabilities.some((v) =>
            isVersionInRange(pkg.version, v.vulnerableVersionRange, pkg.ecosystem)
          );

          if (isAffected) {
            advisories.push({
              id: adv.id,
              source: 'ghsa',
              severity: adv.severity,
              summary: adv.summary,
              details: adv.description,
              references: adv.references.map((r) => r.url),
              firstPatchedVersion: adv.vulnerabilities[0]?.firstPatchedVersion?.identifier,
              cveIds: extractCveIdsFromGhsa(adv),
            });
          }
        }

        // Merge OSV and GHSA results
        const osvAdvisories = osvResults.get(pkg.name) ?? [];
        const allAdvisories = [...osvAdvisories, ...advisories];
        const deduped = deduplicateAdvisories(allAdvisories);

        if (deduped.length > 0) {
          results[pkg.name] = deduped;
        }
      } catch (err) {
        logger.debug({ err, package: pkg.name }, 'GHSA query failed');

        // If GHSA fails, still include OSV results
        const osvAdvisories = osvResults.get(pkg.name) ?? [];
        if (osvAdvisories.length > 0) {
          results[pkg.name] = osvAdvisories;
        }
      }
    })
  );

  await Promise.all(ghsaQueries);
  return results;
}

function deduplicateAdvisories(advisories: UnifiedAdvisory[]): UnifiedAdvisory[] {
  const seen = new Set<string>();
  return advisories.filter((adv) => {
    if (seen.has(adv.id)) return false;
    seen.add(adv.id);
    return true;
  });
}

function isVersionInRange(version: string, range: string, ecosystem: string): boolean {
  if (ecosystem === 'npm') {
    try {
      return satisfies(version, range);
    } catch {
      return true;
    }
  }
  return true;
}

function extractFirstPatchedVersionFromOsv(vuln: OsvVuln): string | undefined {
  if (!vuln.affected) return undefined;
  for (const aff of vuln.affected) {
    for (const range of aff.ranges ?? []) {
      for (const event of range.events ?? []) {
        if (event.fixed) return event.fixed;
      }
    }
  }
  return undefined;
}

function pLimit(concurrency: number) {
  const queue: (() => void)[] = [];
  let running = 0;
  return <T>(fn: () => Promise<T>): Promise<T> =>
    new Promise((resolve, reject) => {
      const run = async () => {
        running++;
        try {
          const result = await fn();
          resolve(result);
        } catch (err) {
          reject(err);
        } finally {
          running--;
          if (queue.length > 0) queue.shift()?.();
        }
      };
      if (running < concurrency) run(); else queue.push(run);
    });
}

function getSeverity(vuln: OsvVuln & { database_specific?: { severity?: string } }): string {
  if (vuln.database_specific?.severity) return String(vuln.database_specific.severity).toUpperCase();
  if (vuln.severity?.[0]?.score) {
    const score = parseFloat(vuln.severity[0].score);
    if (score >= 9.0) return 'CRITICAL';
    if (score >= 7.0) return 'HIGH';
    if (score >= 4.0) return 'MEDIUM';
    return 'LOW';
  }
  return 'UNKNOWN';
}

function extractCveIds(vuln: OsvVuln): string[] {
  const cveIds: string[] = [];

  // Check if the vulnerability ID itself is a CVE
  if (vuln.id && typeof vuln.id === 'string' && vuln.id.startsWith('CVE-')) {
    cveIds.push(vuln.id);
  }

  // Extract CVEs from aliases array
  if (Array.isArray(vuln.aliases)) {
    for (const alias of vuln.aliases) {
      if (typeof alias === 'string' && alias.startsWith('CVE-') && !cveIds.includes(alias)) {
        cveIds.push(alias);
      }
    }
  }

  return cveIds;
}

function extractCveIdsFromGhsa(adv: GhsaAdvisory): string[] {
  const cveIds: string[] = [];

  // GHSA IDs are not CVEs, but references might contain CVE links
  // Also check the description for CVE mentions
  const textToSearch = [
    adv.id,
    adv.summary || '',
    adv.description || '',
    ...(adv.references || []).map((r) => r.url || '').filter(Boolean),
  ].join(' ');

  // Extract CVE-YYYY-NNNN pattern from text
  const cveRegex = /CVE-\d{4}-\d{4,}/g;
  const matches = textToSearch.match(cveRegex);
  if (matches) {
    for (const match of matches) {
      if (!cveIds.includes(match)) {
        cveIds.push(match);
      }
    }
  }

  return cveIds;
}


