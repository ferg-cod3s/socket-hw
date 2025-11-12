import { execSync } from 'child_process';

let cachedToken: string | undefined;

/**
 * Get GitHub token from environment or gh CLI
 * Priority: GITHUB_TOKEN env var > gh CLI token
 */
export function getGitHubToken(): string | undefined {
  // First, try the cachedToken
  if (cachedToken) return cachedToken;

  const envToken = process.env.GITHUB_TOKEN;
  if (envToken) {
    cachedToken = envToken;
    return envToken;
  }

  // Fallback to gh CLI authentication
  try {
    const ghToken = execSync('gh auth token', { encoding: 'utf8', stdio: 'pipe' }).trim();
    cachedToken = ghToken;
    if (ghToken) return ghToken;
  } catch (err) {
    // gh CLI not installed or not authenticated
  }

  return undefined;
}

/**
 * Clear cached token (for testing)
 */
export function clearCachedToken(): void {
  cachedToken = undefined;
}

/**
 * Validate and get GitHub token with helpful error message
 */
export function requireGitHubToken(): string {
  const token = getGitHubToken();
  if (!token) {
    throw new Error('GitHub token required. Set GITHUB_TOKEN environment variable or run `gh auth login`');
  }
  return token;
}
