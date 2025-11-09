import chalk from 'chalk';
import type { UnifiedAdvisory } from '../index.js';
import type { Dependency } from '../providers/index.js';
import type { MaintenanceInfo } from '../utils/maintenance.js';

/**
 * Format scan results for console output
 * Uses chalk for colored, human-readable formatting
 */
export function formatConsoleOutput(
  deps: Dependency[],
  vulnsByPkg: Record<string, UnifiedAdvisory[]>,
  scanDuration: number,
  maintenanceInfo?: Map<string, MaintenanceInfo>
): void {
  const totalVulns = Object.values(vulnsByPkg).reduce((sum, v) => sum + v.length, 0);
  const vulnerablePkgs = Object.keys(vulnsByPkg).length;

  if (totalVulns === 0) {
    console.log(chalk.green(`✓ No vulnerabilities found in ${deps.length} packages`));
    return;
  }

  console.log(
    chalk.yellow(
      `Found ${totalVulns} vulnerabilit${totalVulns !== 1 ? 'ies' : 'y'} in ${vulnerablePkgs} package${vulnerablePkgs !== 1 ? 's' : ''}`
    )
  );

  // Build a map of package names to versions for quick lookup
  const depMap = new Map<string, string>();
  for (const dep of deps) {
    depMap.set(dep.name, dep.version);
  }

  for (const [pkgName, vulns] of Object.entries(vulnsByPkg)) {
    if (vulns.length === 0) continue;
    const pkgVersion = depMap.get(pkgName) || 'unknown';
    console.log(chalk.cyan(`\n${pkgName}@${pkgVersion}:`));
    for (const v of vulns) {
      const severityColor = severityToColor(v.severity);
      // Handle comma-separated sources (when advisory found in multiple sources)
      const sourceLabel = chalk.dim(`[${v.source.toUpperCase()}]`);
      const title = v.summary?.trim();
      const displayTitle = title && title.length > 0 ? title : v.id;
      console.log(`  ${chalk.red('●')} ${displayTitle} ${severityColor(`[${v.severity}]`)} ${sourceLabel}`);

      if (title && title.length > 0 && title !== v.id) {
        console.log(chalk.dim(`    Advisory ID: ${v.id}`));
      }

      console.log(chalk.dim(`    Title: ${displayTitle}`));

      // Show CVE IDs if available
      if (v.cveIds && v.cveIds.length > 0) {
        console.log(chalk.dim(`    CVE IDs: ${v.cveIds.join(', ')}`));
      }

      // Show description if available
      if (v.details) {
        const description = v.details.length > 200
          ? v.details.substring(0, 200) + '...'
          : v.details;
        console.log(chalk.dim(`    Description: ${description}`));
      }

      if (v.firstPatchedVersion) {
        console.log(chalk.dim(`    Fix available: upgrade to ${v.firstPatchedVersion}`));
      }

      // Show advisory links if available
      if (v.references && v.references.length > 0) {
        const primaryLink = v.references[0];
        console.log(chalk.dim(`    Advisory: ${primaryLink}`));
      }
    }
  }

  // Show maintenance information if available
  if (maintenanceInfo && maintenanceInfo.size > 0) {
    const unmaintained = Array.from(maintenanceInfo.values()).filter(
      (info) => info.isUnmaintained
    );

    if (unmaintained.length > 0) {
      console.log(chalk.yellow(`\n⚠ Unmaintained Packages (${unmaintained.length}):`));
      for (const info of unmaintained) {
        const daysText = info.daysSinceLastRelease
          ? `${info.daysSinceLastRelease} days ago`
          : 'unknown';
        console.log(chalk.yellow(`  • ${info.package} (last release: ${daysText})`));

        if (info.downloads?.weekly) {
          console.log(chalk.dim(`    Weekly downloads: ${info.downloads.weekly.toLocaleString()}`));
        }
      }
    }
  }
}

function severityToColor(sev: string): (s: string) => string {
  if (sev === 'CRITICAL' || sev === 'HIGH') return chalk.red;
  if (sev === 'MEDIUM' || sev === 'MODERATE') return chalk.yellow;
  if (sev === 'LOW') return chalk.green;
  return chalk.dim;
}

