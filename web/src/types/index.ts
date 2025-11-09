/**
 * Web UI type definitions
 */

export interface ProgressUpdate {
  stage: 'detecting-ecosystem' | 'gathering-dependencies' | 'scanning-packages' | 'filtering-advisories' | 'finalizing';
  percent: number;
  depsScanned?: number;
  totalDeps?: number;
}
