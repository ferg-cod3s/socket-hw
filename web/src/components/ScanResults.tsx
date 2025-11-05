'use client';

import type { ScanResult } from '@/lib/scanner';
import type { UnifiedAdvisory } from '@cli/index';

interface ScanResultsProps {
  result: ScanResult;
  fileName: string;
}

export function ScanResults({ result, fileName }: ScanResultsProps) {
  const { deps, advisoriesByPackage, scanDurationMs } = result;

  // Calculate summary statistics
  const totalDependencies = deps.length;
  const vulnerablePackages = Object.keys(advisoriesByPackage).length;
  const totalVulnerabilities = Object.values(advisoriesByPackage).reduce(
    (sum, advisories) => sum + advisories.length,
    0
  );

  // Group vulnerabilities by severity
  const severityCounts = {
    CRITICAL: 0,
    HIGH: 0,
    MEDIUM: 0,
    LOW: 0,
    UNKNOWN: 0
  };



  Object.values(advisoriesByPackage).forEach(advisories => {
    advisories.forEach(advisory => {
      const severity = advisory.severity?.toUpperCase() || 'UNKNOWN';
      if (severity in severityCounts) {
        severityCounts[severity as keyof typeof severityCounts]++;
      } else {
        severityCounts.UNKNOWN++;
      }
    });
  });

  const percentageVulnerable =
    totalDependencies > 0
      ? ((vulnerablePackages / totalDependencies) * 100).toFixed(1)
      : '0';

  const handleExportJson = () => {
    const dataStr = JSON.stringify(result, null, 2);
    const blob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `scan-${fileName}-${Date.now()}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="w-full max-w-6xl space-y-6">
      {/* Header Card */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
        <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
          Scan Results: {fileName}
        </h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
          Scan completed in {scanDurationMs}ms
        </p>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-4">
          <StatCard
            label="Total Dependencies"
            value={totalDependencies.toString()}
            color="blue"
          />
          <StatCard
            label="Vulnerable"
            value={`${vulnerablePackages} (${percentageVulnerable}%)`}
            color={vulnerablePackages > 0 ? 'red' : 'green'}
          />
          <StatCard
            label="Vulnerabilities"
            value={totalVulnerabilities.toString()}
            color="orange"
          />
          <StatCard
            label="Critical/High"
            value={(severityCounts.CRITICAL + severityCounts.HIGH).toString()}
            color="red"
          />
        </div>
      </div>

      {/* Severity Breakdown */}
      {totalVulnerabilities > 0 && (
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
            Severity Breakdown
          </h3>
          <div className="space-y-3">
            <SeverityBar
              label="Critical"
              count={severityCounts.CRITICAL}
              total={totalVulnerabilities}
              color="bg-red-600"
            />
            <SeverityBar
              label="High"
              count={severityCounts.HIGH}
              total={totalVulnerabilities}
              color="bg-orange-500"
            />
            <SeverityBar
              label="Medium"
              count={severityCounts.MEDIUM}
              total={totalVulnerabilities}
              color="bg-yellow-500"
            />
            <SeverityBar
              label="Low"
              count={severityCounts.LOW}
              total={totalVulnerabilities}
              color="bg-blue-500"
            />
            {severityCounts.UNKNOWN > 0 && (
              <SeverityBar
                label="Unknown"
                count={severityCounts.UNKNOWN}
                total={totalVulnerabilities}
                color="bg-gray-500"
              />
            )}
          </div>
        </div>
      )}

      {/* Vulnerabilities List */}
      {totalVulnerabilities > 0 && (
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
            Vulnerabilities ({totalVulnerabilities})
          </h3>
          <div className="space-y-4">
            {Object.entries(advisoriesByPackage)
              .flatMap(([pkgKey, advisories]) => {
                // Find the package details
                const pkg = deps.find(d => `${d.name}@${d.version}` === pkgKey);
                return advisories.map((advisory, index) => ({
                  pkgKey,
                  advisory,
                  index,
                  packageName: pkg?.name || pkgKey.split('@')[0],
                  packageVersion: pkg?.version || pkgKey.split('@')[1]
                }));
              })
              .sort((a, b) => {
                // Define severity order
                const severityOrder: Record<string, number> = {
                  CRITICAL: 0,
                  HIGH: 1,
                  MEDIUM: 2,
                  MODERATE: 2, // Treat MODERATE same as MEDIUM
                  LOW: 3,
                  UNKNOWN: 4
                };

                const aSeverity = (a.advisory.severity?.toUpperCase() || 'UNKNOWN') as string;
                const bSeverity = (b.advisory.severity?.toUpperCase() || 'UNKNOWN') as string;

                const aOrder = severityOrder[aSeverity] ?? 4;
                const bOrder = severityOrder[bSeverity] ?? 4;

                // Sort by severity first
                if (aOrder !== bOrder) {
                  return aOrder - bOrder;
                }

                // Then by package name
                return a.packageName.localeCompare(b.packageName);
              })
              .map(({ pkgKey, advisory, index, packageName, packageVersion }) => (
                <VulnerabilityCard
                  key={`${pkgKey}-${advisory.id}-${index}`}
                  packageName={packageName}
                  packageVersion={packageVersion}
                  advisory={advisory}
                />
              ))}
          </div>
        </div>
      )}

      {/* No Vulnerabilities Found */}
      {totalVulnerabilities === 0 && (
        <div className="bg-green-50 dark:bg-green-900 rounded-lg shadow p-8 text-center">
          <svg
            className="w-16 h-16 text-green-500 mx-auto mb-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
          <h3 className="text-xl font-semibold text-green-800 dark:text-green-200">
            No vulnerabilities found!
          </h3>
          <p className="text-green-600 dark:text-green-300 mt-2">
            All {totalDependencies} dependencies are secure.
          </p>
        </div>
      )}

      {/* Export Button */}
      <div className="flex justify-end gap-4">
        <button
          onClick={handleExportJson}
          className="px-6 py-3 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors font-medium shadow-sm"
        >
          Export as JSON
        </button>
      </div>
    </div>
  );
}

// Helper Components

function StatCard({
  label,
  value,
  color
}: {
  label: string;
  value: string;
  color: string;
}) {
  const colorClasses = {
    blue: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
    red: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
    green: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
    orange:
      'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200'
  };

  return (
    <div
      className={`p-4 rounded-lg ${colorClasses[color as keyof typeof colorClasses]}`}
    >
      <div className="text-sm font-medium opacity-80">{label}</div>
      <div className="text-2xl font-bold mt-1">{value}</div>
    </div>
  );
}

function SeverityBar({
  label,
  count,
  total,
  color
}: {
  label: string;
  count: number;
  total: number;
  color: string;
}) {
  const percentage = total > 0 ? (count / total) * 100 : 0;

  return (
    <div>
      <div className="flex justify-between text-sm mb-1">
        <span className="font-medium text-gray-700 dark:text-gray-300">
          {label}
        </span>
        <span className="text-gray-600 dark:text-gray-400">
          {count} ({percentage.toFixed(1)}%)
        </span>
      </div>
      <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
        <div
          className={`${color} h-2 rounded-full transition-all duration-300`}
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  );
}

function VulnerabilityCard({
  packageName,
  packageVersion,
  advisory
}: {
  packageName: string;
  packageVersion: string;
  advisory: UnifiedAdvisory;
}) {
  const severity = advisory.severity?.toUpperCase() || 'UNKNOWN';

  const severityColors: Record<string, string> = {
    CRITICAL:
      'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200 border-red-300',
    HIGH: 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200 border-orange-300',
    MEDIUM:
      'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200 border-yellow-300',
    LOW: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200 border-blue-300',
    UNKNOWN:
      'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200 border-gray-300'
  };

  const colorClass =
    severityColors[severity] || severityColors.UNKNOWN;

  return (
    <div className="border border-gray-200 dark:border-gray-700 rounded-lg p-4 hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between mb-2">
        <div className="flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h4 className="font-semibold text-gray-900 dark:text-white">
              {packageName}@{packageVersion}
            </h4>
            <span
              className={`px-2 py-1 text-xs font-medium rounded border ${colorClass}`}
            >
              {severity}
            </span>
            <span className="text-xs text-gray-500 dark:text-gray-400">
              {advisory.source.toUpperCase()}
            </span>
          </div>
          <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
            {advisory.id}
          </p>
        </div>
      </div>

      <p className="text-sm text-gray-700 dark:text-gray-300 mb-3">
        {advisory.summary || advisory.details || 'No description available'}
      </p>

      <div className="flex flex-wrap gap-4 text-sm">
        {advisory.references && advisory.references.length > 0 && (
          <a
            href={advisory.references[0]}
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-600 dark:text-blue-400 hover:underline font-medium"
          >
            View Advisory →
          </a>
        )}

        {advisory.firstPatchedVersion && (
          <div className="text-gray-600 dark:text-gray-400">
            <span className="font-medium">Patched:</span> {advisory.firstPatchedVersion}
          </div>
        )}

        {advisory.cveIds && advisory.cveIds.length > 0 && (
          <div className="text-gray-600 dark:text-gray-400">
            <span className="font-medium">CVEs:</span> {advisory.cveIds.join(', ')}
          </div>
        )}
      </div>
    </div>
  );
}
