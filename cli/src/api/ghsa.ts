import { getGitHubToken } from '../utils/auth.js';
import { fetchWithRetry } from '../utils/retry.js';
import { AbortError } from 'p-retry';

interface GhsaQuery {
  ecosystem: string; // GITHUB, NPM, PIP, etc.
  packageName: string;
}

export interface GhsaAdvisory {
  id: string; // GHSA-xxxx-xxxx-xxxx
  summary: string;
  description?: string;
  severity: 'LOW' | 'MODERATE' | 'HIGH' | 'CRITICAL';
  publishedAt: string;
  updatedAt: string;
  vulnerabilities: {
    package: { name: string; ecosystem: string };
    vulnerableVersionRange: string;
    firstPatchedVersion?: { identifier: string };
  }[];
  references: { url: string }[];
  cvss?: { score: number; vectorString: string };
}

export async function queryGhsa(q: GhsaQuery): Promise<GhsaAdvisory[]> {
  const token = getGitHubToken();
  if (!token) {
    throw new Error('GitHub token required for GHSA queries (set GITHUB_TOKEN or run `gh auth login`)');
  }

  const query = `
    query($ecosystem: SecurityAdvisoryEcosystem!, $package: String!) {
      securityVulnerabilities(first: 100, ecosystem: $ecosystem, package: $package) {
        nodes {
          advisory {
            ghsaId
            summary
            description
            severity
            publishedAt
            updatedAt
            references { url }
            cvss { score vectorString }
          }
          package { name ecosystem }
          vulnerableVersionRange
          firstPatchedVersion { identifier }
        }
        pageInfo { hasNextPage endCursor }
      }
    }
  `;

  const ecosystem = mapToGhsaEcosystem(q.ecosystem);

  let response: Response;
  try {
    response = await fetchWithRetry(
      'https://api.github.com/graphql',
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          query,
          variables: { ecosystem, package: q.packageName },
        }),
      },
      {
        retries: 3,
        minTimeout: 1000,
        maxTimeout: 30000,
        timeout: 30000,
      }
    );
  } catch (error: any) {
    // Catch errors from retry wrapper and reformat for GHSA API
    // Check if error message contains HTTP status code
    const statusMatch = error?.message?.match(/HTTP (\d+): (.+)/);
    if (statusMatch) {
      throw new Error(`GHSA API error: ${statusMatch[1]} ${statusMatch[2]}`);
    }
    throw error;
  }

  if (!response.ok) {
    // Retry wrapper already handles retryable errors, so this should only happen
    // for non-retryable errors or after all retries are exhausted
    throw new Error(`GHSA API error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();

  if (data.errors) {
    throw new Error(`GHSA GraphQL errors: ${JSON.stringify(data.errors)}`);
  }

  // Map and group by advisory (ghsaId)
  const vulnNodes = data.data?.securityVulnerabilities?.nodes ?? [];
  const byGhsa: Record<string, GhsaAdvisory> = {};
  for (const n of vulnNodes) {
    const adv = n.advisory ?? {};
    const ghsaId = adv.ghsaId;
    if (!ghsaId) continue;
    if (!byGhsa[ghsaId]) {
      byGhsa[ghsaId] = {
        id: ghsaId,
        summary: adv.summary,
        description: adv.description,
        severity: adv.severity,
        publishedAt: adv.publishedAt,
        updatedAt: adv.updatedAt,
        references: adv.references ?? [],
        cvss: adv.cvss,
        vulnerabilities: [],
      };
    }
    byGhsa[ghsaId].vulnerabilities.push({
      package: n.package,
      vulnerableVersionRange: n.vulnerableVersionRange,
      firstPatchedVersion: n.firstPatchedVersion,
    });
  }
  return Object.values(byGhsa);
}

function mapToGhsaEcosystem(osvEcosystem: string): string {
  const mapping: Record<string, string> = {
    'npm': 'NPM',
    'PyPI': 'PIP',
    'Maven': 'MAVEN',
    'RubyGems': 'RUBYGEMS',
    'Go': 'GO',
    'NuGet': 'NUGET',
    'Packagist': 'COMPOSER',
    'crates.io': 'RUST',
  };

  return mapping[osvEcosystem] ?? osvEcosystem.toUpperCase();
}

