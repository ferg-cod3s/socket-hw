/**
 * JSON output schema for vulnerability scan results
 * Matches PDF requirements for structured output
 */
export interface ScanResultJson {
  summary: {
    scanned: number;
    vulnerable: number;
    totalVulnerabilities: number;
    scanDuration: string;
    timestamp: string;
  };
  packages: {
    name: string;
    version: string;
    ecosystem: string;
    vulnerabilities: {
      id: string;
      source: 'osv' | 'ghsa';
      severity: string;
      title: string;
      description?: string;
      cveIds: string[];
      patchedVersion?: string;
      references: string[];
    }[];
  }[];
}
