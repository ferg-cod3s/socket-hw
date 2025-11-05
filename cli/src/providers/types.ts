/**
 * Provider interface for multi-ecosystem dependency scanning
 */

export interface DetectionResult {
  /** Provider identifier (e.g., 'node', 'python-poetry') */
  providerId: string;
  /** Human-readable name (e.g., 'npm', 'Poetry') */
  name: string;
  /** Optional variant/version info */
  variant?: string;
  /** Confidence score 0-1 */
  confidence: number;
}

export interface LockfileOptions {
  /** Force refresh/recreate lockfile */
  forceRefresh?: boolean;
  /** Force validation (fail if invalid) */
  forceValidate?: boolean;
  /** Create lockfile if missing */
  createIfMissing?: boolean;
  /** Validate lockfile if present */
  validateIfPresent?: boolean;
}

export interface Dependency {
  /** Package name */
  name: string;
  /** Version (semver range or resolved) */
  version: string;
  /** OSV ecosystem identifier */
  ecosystem: string;
}

export interface GatherDepsOptions {
  /** Include dev/optional dependencies */
  includeDev?: boolean;
  /** Path to standalone lockfile for direct parsing (bypasses directory detection) */
  standaloneLockfile?: string | null;
}

export interface EcosystemProvider {
  supportedManifests: string[];

  /**
   * Attempt to detect if this provider should handle the given directory.
   * Returns null if not detected, otherwise a detection result.
   */
  detect(dir: string): DetectionResult | null;

  /**
   * Ensure lockfile exists and is valid according to options.
   * May invoke package manager commands.
   */
  ensureLockfile(dir: string, opts: LockfileOptions): Promise<void>;

  /**
   * Gather dependencies from manifest/lockfile.
   * Returns normalized dependency list for OSV scanning.
   */
  gatherDependencies(dir: string, opts: GatherDepsOptions): Promise<Dependency[]>;

  /**
   * Returns the set of filenames that are considered valid inputs across providers
   * when a user passes a file path instead of a directory. This centralizes the
   * supported names close to provider implementations.
   */
  getSupportedManifests(): string[];
}

