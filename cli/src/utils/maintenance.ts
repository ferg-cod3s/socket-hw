import { logger } from './logger.js';
import type { Dependency } from '../providers/index.js';
import { fetchWithRetry } from './retry.js';

export interface MaintenanceInfo {
  /** Package name */
  package: string;
  /** Ecosystem (npm, pypi, etc.) */
  ecosystem: string;
  /** Last release date (ISO format) */
  lastReleaseDate?: string;
  /** Days since last release */
  daysSinceLastRelease?: number;
  /** Whether package is considered unmaintained (no release in 12+ months) */
  isUnmaintained: boolean;
  /** Download statistics (if available) */
  downloads?: {
    /** Downloads in last 7 days */
    weekly?: number;
    /** Downloads in last 30 days */
    monthly?: number;
  };
  /** Error message if fetch failed */
  error?: string;
}

/**
 * Check maintenance status for npm packages
 */
async function checkNpmMaintenance(
  packageName: string
): Promise<Omit<MaintenanceInfo, 'package' | 'ecosystem'>> {
  try {
    // URL encode package name to handle special characters
    const encodedName = encodeURIComponent(packageName);
    const response = await fetchWithRetry(
      `https://registry.npmjs.org/${encodedName}`,
      {},
      {
        retries: 2,
        minTimeout: 1000,
        maxTimeout: 10000,
        timeout: 10000,
      }
    );

    if (!response.ok) {
      if (response.status === 404) {
        return {
          isUnmaintained: false,
          error: 'Package not found',
        };
      }
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json();
    const versions = data.time || {};

    // Get all version release dates
    const releaseDates = Object.entries(versions)
      .filter(([key]) => key !== 'created' && key !== 'modified' && !key.startsWith('unpublished'))
      .map(([, date]) => new Date(date as string))
      .sort((a, b) => b.getTime() - a.getTime()); // Most recent first

    if (releaseDates.length === 0) {
      return {
        isUnmaintained: true,
        error: 'No release dates found',
      };
    }

    const lastRelease = releaseDates[0];
    const daysSinceLastRelease = Math.floor(
      (Date.now() - lastRelease.getTime()) / (1000 * 60 * 60 * 24)
    );

    // Get download stats from npm registry
    let downloads: MaintenanceInfo['downloads'];
    try {
      const encodedName = encodeURIComponent(packageName);
      const downloadResponse = await fetchWithRetry(
        `https://api.npmjs.org/downloads/point/last-week/${encodedName}`,
        {},
        {
          retries: 1,
          minTimeout: 1000,
          maxTimeout: 5000,
          timeout: 5000,
        }
      );
      if (downloadResponse.ok) {
        const downloadData = await downloadResponse.json();
        downloads = {
          weekly: downloadData.downloads || 0,
        };
      }
    } catch (err) {
      // Download stats are optional, ignore errors
      logger.debug({ err, package: packageName }, 'Failed to fetch download stats');
    }

    return {
      lastReleaseDate: lastRelease.toISOString(),
      daysSinceLastRelease,
      isUnmaintained: daysSinceLastRelease >= 365, // 12 months
      downloads,
    };
  } catch (error: any) {
    logger.debug({ err: error, package: packageName }, 'Failed to check npm maintenance');
    return {
      isUnmaintained: false,
      error: error.message || 'Unknown error',
    };
  }
}

/**
 * Check maintenance status for PyPI packages
 */
async function checkPypiMaintenance(
  packageName: string
): Promise<Omit<MaintenanceInfo, 'package' | 'ecosystem'>> {
  try {
    // URL encode package name to handle special characters
    const encodedName = encodeURIComponent(packageName);
    const response = await fetchWithRetry(
      `https://pypi.org/pypi/${encodedName}/json`,
      {},
      {
        retries: 2,
        minTimeout: 1000,
        maxTimeout: 10000,
        timeout: 10000,
      }
    );

    if (!response.ok) {
      if (response.status === 404) {
        return {
          isUnmaintained: false,
          error: 'Package not found',
        };
      }
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json();
    const releases = data.releases || {};

    // Get all release dates
    const releaseDates = Object.values(releases)
      .flat()
      .map((release: any) => new Date(release.upload_time_iso_8601))
      .sort((a: Date, b: Date) => b.getTime() - a.getTime()); // Most recent first

    if (releaseDates.length === 0) {
      return {
        isUnmaintained: true,
        error: 'No release dates found',
      };
    }

    const lastRelease = releaseDates[0];
    const daysSinceLastRelease = Math.floor(
      (Date.now() - lastRelease.getTime()) / (1000 * 60 * 60 * 24)
    );

    // Get download stats from PyPI
    let downloads: MaintenanceInfo['downloads'];
    try {
      const encodedName = encodeURIComponent(packageName);
      const downloadResponse = await fetchWithRetry(
        `https://pypistats.org/api/packages/${encodedName}/recent`,
        {},
        {
          retries: 1,
          minTimeout: 1000,
          maxTimeout: 5000,
          timeout: 5000,
        }
      );
      if (downloadResponse.ok) {
        const downloadData = await downloadResponse.json();
        downloads = {
          weekly: downloadData?.data?.last_week || 0,
          monthly: downloadData?.data?.last_month || 0,
        };
      }
    } catch (err) {
      // Download stats are optional, ignore errors
      logger.debug({ err, package: packageName }, 'Failed to fetch download stats');
    }

    return {
      lastReleaseDate: lastRelease.toISOString(),
      daysSinceLastRelease,
      isUnmaintained: daysSinceLastRelease >= 365, // 12 months
      downloads,
    };
  } catch (error: any) {
    logger.debug({ err: error, package: packageName }, 'Failed to check PyPI maintenance');
    return {
      isUnmaintained: false,
      error: error.message || 'Unknown error',
    };
  }
}

/**
 * Check maintenance status for a package based on ecosystem
 */
export async function checkMaintenance(
  packageName: string,
  ecosystem: string
): Promise<MaintenanceInfo> {
  const baseInfo: MaintenanceInfo = {
    package: packageName,
    ecosystem,
    isUnmaintained: false,
  };

  try {
    let result: Omit<MaintenanceInfo, 'package' | 'ecosystem'>;

    switch (ecosystem.toLowerCase()) {
      case 'npm':
        result = await checkNpmMaintenance(packageName);
        break;
      case 'pypi':
      case 'python':
        result = await checkPypiMaintenance(packageName);
        break;
      default:
        return {
          ...baseInfo,
          error: `Maintenance checking not supported for ecosystem: ${ecosystem}`,
        };
    }

    return {
      ...baseInfo,
      ...result,
    };
  } catch (error: any) {
    return {
      ...baseInfo,
      error: error.message || 'Unknown error',
    };
  }
}

/**
 * Check maintenance for multiple packages
 */
export async function checkMaintenanceBatch(
  packages: Dependency[],
  concurrency: number = 5
): Promise<Map<string, MaintenanceInfo>> {
  const results = new Map<string, MaintenanceInfo>();

  // Process in batches to avoid overwhelming registries
  for (let i = 0; i < packages.length; i += concurrency) {
    const batch = packages.slice(i, i + concurrency);

    await Promise.all(
      batch.map(async (pkg) => {
        const info = await checkMaintenance(pkg.name, pkg.ecosystem);
        results.set(pkg.name, info);
      })
    );
  }

  return results;
}


