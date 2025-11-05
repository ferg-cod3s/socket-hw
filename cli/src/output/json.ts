import type { ScanResultJson } from '../types.js';
import type { Dependency } from '../providers/index.js';
import type { UnifiedAdvisory } from '../index.js';

/**
 * Convert scan results to JSON format per PDF requirements
 * Includes all required fields: package name, version, severity, CVE IDs,
 * description, advisory links, and remediation suggestions
 */
export function formatJsonOutput(
  deps: Dependency[],
  vulnsByPkg: Record<string, UnifiedAdvisory[]>,
  scanDuration: number
): ScanResultJson {
  const totalVulns = Object.values(vulnsByPkg).reduce((sum, v) => sum + v.length, 0);
  const vulnerablePkgs = Object.keys(vulnsByPkg).length;

  // Find package versions from dependencies
  const depMap = new Map<string, Dependency>();
  for (const dep of deps) {
    depMap.set(dep.name, dep);
  }

  const packages = Object.entries(vulnsByPkg).map(([pkgName, vulns]) => {
    const dep = depMap.get(pkgName);
    return {
      name: pkgName,
      version: dep?.version || 'unknown',
      ecosystem: dep?.ecosystem || 'unknown',
      vulnerabilities: vulns.map((v) => ({
        id: v.id,
        source: v.source,
        severity: v.severity || 'UNKNOWN',
        title: v.summary || v.id,
        description: v.details,
        cveIds: v.cveIds || [],
        patchedVersion: v.firstPatchedVersion,
        references: v.references || [],
      })),
    };
  });

  return {
    summary: {
      scanned: deps.length,
      vulnerable: vulnerablePkgs,
      totalVulnerabilities: totalVulns,
      scanDuration: `${scanDuration}ms`,
      timestamp: new Date().toISOString(),
    },
    packages,
  };
}

