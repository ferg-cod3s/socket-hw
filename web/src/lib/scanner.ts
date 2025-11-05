/**
 * Scanner library wrapper
 * Connects web interface to CLI scanner
 */

import { scanPath as cliScanPath } from '@cli/index';
import type { ScanResult, ScanOptions } from '@cli/index';

/**
 * Scan a lockfile and return vulnerability results
 * @param path - Path to lockfile
 * @param options - Scan options
 * @returns Scan results with vulnerabilities
 */
export async function scanPath(
  path: string,
  options?: Partial<ScanOptions>
): Promise<ScanResult> {
  // Call CLI scanner programmatically
  return await cliScanPath(path, options || {});
}

// Re-export types for convenience
export type { ScanResult, ScanOptions };
