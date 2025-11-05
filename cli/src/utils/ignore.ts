import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { logger } from './logger.js';
import type { UnifiedAdvisory } from '../index.js';

/**
 * Ignore rule configuration
 */
export interface IgnoreRule {
  /** CVE ID or advisory ID to ignore (e.g., "CVE-2024-1234" or "GHSA-xxxx") */
  id?: string;
  /** Package name to ignore (e.g., "lodash") */
  package?: string;
  /** Package version pattern to ignore (e.g., "4.17.21") */
  packageVersion?: string;
  /** Expiration date in ISO format (e.g., "2025-12-31") */
  expires?: string;
  /** Reason for ignoring this advisory */
  reason?: string;
}

/**
 * Ignore list configuration file format
 */
export interface IgnoreConfig {
  /** Version of the ignore config format */
  version?: string;
  /** List of ignore rules */
  ignores: IgnoreRule[];
}

/**
 * Load and parse ignore configuration from file
 */
export function loadIgnoreConfig(ignoreFilePath: string): IgnoreConfig | null {
  if (!existsSync(ignoreFilePath)) {
    return null;
  }

  try {
    const content = readFileSync(ignoreFilePath, 'utf-8');
    const config: IgnoreConfig = JSON.parse(content);

    // Validate structure
    if (!config.ignores || !Array.isArray(config.ignores)) {
      logger.warn(`Invalid ignore config: missing 'ignores' array`);
      return null;
    }

    logger.info(`Loaded ${config.ignores.length} ignore rule(s) from ${ignoreFilePath}`);
    return config;
  } catch (error: any) {
    logger.warn(`Failed to load ignore config from ${ignoreFilePath}: ${error.message}`);
    return null;
  }
}

/**
 * Find ignore config file in directory hierarchy
 */
export function findIgnoreConfig(projectPath: string, customPath?: string): string | null {
  // If custom path provided, use it
  if (customPath) {
    return customPath;
  }

  // Look for .vuln-ignore.json in project directory
  const defaultPath = join(projectPath, '.vuln-ignore.json');
  if (existsSync(defaultPath)) {
    return defaultPath;
  }

  return null;
}

/**
 * Check if an advisory should be ignored based on ignore rules
 */
export function shouldIgnoreAdvisory(
  advisory: UnifiedAdvisory,
  packageName: string,
  packageVersion: string,
  ignoreConfig: IgnoreConfig | null
): boolean {
  if (!ignoreConfig) {
    return false;
  }

  const now = new Date();

  for (const rule of ignoreConfig.ignores) {
    // Check expiration
    if (rule.expires) {
      const expiresDate = new Date(rule.expires);
      if (now > expiresDate) {
        continue; // Rule expired, skip it
      }
    }

    // Check advisory ID match
    if (rule.id) {
      // Match exact advisory ID
      if (advisory.id === rule.id) {
        return true;
      }

      // Match CVE IDs if present
      if (advisory.cveIds && advisory.cveIds.includes(rule.id)) {
        return true;
      }
    }

    // Check package name match
    if (rule.package && packageName === rule.package) {
      // If package version specified, check it matches
      if (rule.packageVersion) {
        if (packageVersion === rule.packageVersion) {
          return true;
        }
      } else {
        // Package name only, ignore all versions
        return true;
      }
    }

    // Check package@version format if rule.id is in that format
    if (rule.id && rule.id.includes('@')) {
      const [rulePackage, ruleVersion] = rule.id.split('@');
      if (packageName === rulePackage && packageVersion === ruleVersion) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Filter advisories based on ignore rules
 */
export function filterAdvisories(
  advisoriesByPackage: Record<string, UnifiedAdvisory[]>,
  deps: Array<{ name: string; version: string }>,
  ignoreConfig: IgnoreConfig | null
): Record<string, UnifiedAdvisory[]> {
  if (!ignoreConfig) {
    return advisoriesByPackage;
  }

  const filtered: Record<string, UnifiedAdvisory[]> = {};
  let ignoredCount = 0;

  // Build dependency map for quick lookup
  const depMap = new Map<string, { name: string; version: string }>();
  for (const dep of deps) {
    depMap.set(dep.name, dep);
  }

  for (const [pkgKey, advisories] of Object.entries(advisoriesByPackage)) {
    // Parse package key (format: "packageName@version" or just "packageName")
    const [pkgName, pkgVersion] = pkgKey.includes('@')
      ? pkgKey.split('@')
      : [pkgKey, depMap.get(pkgKey)?.version || 'unknown'];

    const filteredAdvisories = advisories.filter((advisory) => {
      const shouldIgnore = shouldIgnoreAdvisory(
        advisory,
        pkgName,
        pkgVersion,
        ignoreConfig
      );

      if (shouldIgnore) {
        ignoredCount++;
      }

      return !shouldIgnore;
    });

    if (filteredAdvisories.length > 0) {
      filtered[pkgKey] = filteredAdvisories;
    }
  }

  if (ignoredCount > 0) {
    logger.info(`Ignored ${ignoredCount} advisory(ies) based on ignore rules`);
  }

  return filtered;
}


