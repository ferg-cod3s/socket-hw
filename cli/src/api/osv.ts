export type OsvQuery = {
  package: { ecosystem: string; name: string };
  version?: string;
  commit?: string;
};

export interface OsvVuln {
  id: string;
  summary?: string;
  details?: string;
  aliases?: string[];
  modified: string;
  published?: string;
  references?: { type: string; url: string }[];
  severity?: { type: string; score: string }[];
  affected?: {
    package: { ecosystem: string; name: string };
    ranges?: { type: string; events: { introduced?: string; fixed?: string }[] }[];
    versions?: string[];
  }[];
}

import { fetchWithRetry } from '../utils/retry.js';

export async function queryOsv(q: OsvQuery): Promise<{ vulns: OsvVuln[] }> {
  const res = await fetchWithRetry(
    'https://api.osv.dev/v1/query',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(q),
    },
    {
      retries: 3,
      minTimeout: 1000,
      maxTimeout: 30000,
      timeout: 30000,
    }
  );
  if (!res.ok) throw new Error(`OSV ${res.status}`);
  return res.json() as Promise<{ vulns: OsvVuln[] }>;
}

/**
 * Batch query interface matching OSV.dev API format
 */
export interface OsvBatchQuery {
  package: { ecosystem: string; name: string };
  version?: string;
  commit?: string;
}

/**
 * Batch response interface matching OSV.dev API format
 */
export interface OsvBatchResponse {
  results: Array<{ vulns: OsvVuln[] }>;
}

/**
 * Query OSV.dev batch endpoint with up to 50 queries per request
 * @param queries Array of OSV queries (max 50 per OSV.dev recommendation)
 * @returns Batch response with results array matching query order
 */
export async function queryOsvBatch(
  queries: OsvBatchQuery[]
): Promise<OsvBatchResponse> {
  if (queries.length === 0) {
    return { results: [] };
  }

  // OSV.dev recommends batches of 50, but accepts up to 1000
  // We use 50 as a safe default to avoid rate limits
  const MAX_BATCH_SIZE = 50;

  if (queries.length > MAX_BATCH_SIZE) {
    throw new Error(
      `Batch size ${queries.length} exceeds maximum of ${MAX_BATCH_SIZE}`
    );
  }

  const res = await fetchWithRetry(
    'https://api.osv.dev/v1/querybatch',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ queries }),
    },
    {
      retries: 3,
      minTimeout: 1000,
      maxTimeout: 30000,
      timeout: 30000,
    }
  );

  if (!res.ok) {
    throw new Error(`OSV batch ${res.status}`);
  }

  return res.json() as Promise<OsvBatchResponse>;
}
