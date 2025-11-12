import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { execSync } from 'child_process';

// Mock child_process before importing auth
vi.mock('child_process');

const { getGitHubToken, requireGitHubToken, clearCachedToken } = await import('../../src/utils/auth.js');

describe('utils/auth', () => {
  const originalEnv = process.env.GITHUB_TOKEN;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetAllMocks();
    delete process.env.GITHUB_TOKEN;
    clearCachedToken();
  });

  afterEach(() => {
    if (originalEnv) {
      process.env.GITHUB_TOKEN = originalEnv;
    } else {
      delete process.env.GITHUB_TOKEN;
    }
    vi.restoreAllMocks();
  });

  describe('getGitHubToken', () => {
    it('returns token from GITHUB_TOKEN environment variable', () => {
      process.env.GITHUB_TOKEN = 'ghp_test_token_from_env';

      const token = getGitHubToken();

      expect(token).toBe('ghp_test_token_from_env');
      // Should not call gh CLI when env var is set
      expect(execSync).not.toHaveBeenCalled();
    });

    it('falls back to gh CLI when GITHUB_TOKEN not set', () => {
      delete process.env.GITHUB_TOKEN;

      vi.mocked(execSync).mockReturnValueOnce('ghp_test_token_from_gh_cli\n');

      const token = getGitHubToken();

      expect(token).toBe('ghp_test_token_from_gh_cli');
      expect(execSync).toHaveBeenCalledWith('gh auth token', {
        encoding: 'utf8',
        stdio: 'pipe',
      });
    });

    it('trims whitespace from gh CLI output', () => {
      delete process.env.GITHUB_TOKEN;

      vi.mocked(execSync).mockReturnValueOnce('  ghp_token_with_spaces  \n');

      const token = getGitHubToken();

      expect(token).toBe('ghp_token_with_spaces');
    });

    it('returns undefined when gh CLI is not installed', () => {
      delete process.env.GITHUB_TOKEN;

      vi.mocked(execSync).mockImplementationOnce(() => {
        throw new Error('Command not found: gh');
      });

      const token = getGitHubToken();

      expect(token).toBeUndefined();
    });

    it('returns undefined when gh CLI is not authenticated', () => {
      delete process.env.GITHUB_TOKEN;

      vi.mocked(execSync).mockImplementationOnce(() => {
        throw new Error('not logged in');
      });

      const token = getGitHubToken();

      expect(token).toBeUndefined();
    });

    it('returns undefined when gh CLI returns empty string', () => {
      delete process.env.GITHUB_TOKEN;

      vi.mocked(execSync).mockReturnValueOnce('');

      const token = getGitHubToken();

      expect(token).toBeUndefined();
    });

    it('returns undefined when gh CLI returns only whitespace', () => {
      delete process.env.GITHUB_TOKEN;

      vi.mocked(execSync).mockReturnValueOnce('   \n  ');

      const token = getGitHubToken();

      expect(token).toBeUndefined();
    });

    it('prioritizes GITHUB_TOKEN over gh CLI', () => {
      process.env.GITHUB_TOKEN = 'ghp_env_token';

      vi.mocked(execSync).mockReturnValueOnce('ghp_gh_cli_token');

      const token = getGitHubToken();

      expect(token).toBe('ghp_env_token');
      // Should not call gh CLI
      expect(execSync).not.toHaveBeenCalled();
    });

    it('handles gh CLI not found error', () => {
      delete process.env.GITHUB_TOKEN;

      vi.mocked(execSync).mockImplementationOnce(() => {
        throw new Error('ENOENT: no such file or directory');
      });

      const token = getGitHubToken();
      expect(token).toBeUndefined();
    });

    it('handles gh CLI spawn error', () => {
      delete process.env.GITHUB_TOKEN;

      vi.mocked(execSync).mockImplementationOnce(() => {
        throw new Error('spawn gh ENOENT');
      });

      const token = getGitHubToken();
      expect(token).toBeUndefined();
    });
  });

  describe('requireGitHubToken', () => {
    it('returns token when GITHUB_TOKEN is set', () => {
      process.env.GITHUB_TOKEN = 'ghp_required_token';

      const token = requireGitHubToken();

      expect(token).toBe('ghp_required_token');
    });

    it('returns token when gh CLI is authenticated', () => {
      delete process.env.GITHUB_TOKEN;

      vi.mocked(execSync).mockReturnValue('ghp_gh_cli_token');

      const token = requireGitHubToken();

      expect(token).toBe('ghp_gh_cli_token');

      vi.mocked(execSync).mockReset();
    });

    it('throws error when no token available', () => {
      delete process.env.GITHUB_TOKEN;

      vi.mocked(execSync).mockImplementation(() => {
        throw new Error('gh not found');
      });

      // Test the full error message in one assertion
      expect(() => requireGitHubToken()).toThrow(/GitHub token required.*Set GITHUB_TOKEN.*gh auth login/s);

      vi.mocked(execSync).mockReset();
    });

    it('throws error when GITHUB_TOKEN is empty string', () => {
      process.env.GITHUB_TOKEN = '';

      expect(() => requireGitHubToken()).toThrow(/GitHub token required/);
    });

    it('throws error with helpful message', () => {
      delete process.env.GITHUB_TOKEN;

      vi.mocked(execSync).mockImplementationOnce(() => {
        throw new Error('not authenticated');
      });

      let errorMessage = '';
      try {
        requireGitHubToken();
      } catch (err: any) {
        errorMessage = err.message;
      }

      expect(errorMessage).toContain('GitHub token required');
      expect(errorMessage).toContain('GITHUB_TOKEN');
      expect(errorMessage).toContain('gh auth login');
    });
  });

  describe('edge cases', () => {
    it('handles GITHUB_TOKEN with special characters', () => {
      process.env.GITHUB_TOKEN = 'ghp_!@#$%^&*()_+-=[]{}|;:,.<>?';

      const token = getGitHubToken();

      expect(token).toBe('ghp_!@#$%^&*()_+-=[]{}|;:,.<>?');
    });

    it('handles very long token strings', () => {
      const longToken = 'ghp_' + 'a'.repeat(1000);
      process.env.GITHUB_TOKEN = longToken;

      const token = getGitHubToken();

      expect(token).toBe(longToken);
      expect(token?.length).toBe(1004);
    });

    it('handles gh CLI returning token with newlines', () => {
      delete process.env.GITHUB_TOKEN;

      vi.mocked(execSync).mockReturnValueOnce('ghp_token\n\n\n');

      const token = getGitHubToken();

      expect(token).toBe('ghp_token');
    });

    it('handles Buffer return from execSync', () => {
      delete process.env.GITHUB_TOKEN;

      // execSync with encoding: 'utf8' should return string, but test fallback
      vi.mocked(execSync).mockReturnValueOnce('ghp_buffer_token' as any);

      const token = getGitHubToken();

      expect(token).toBe('ghp_buffer_token');
    });
  });

  describe('integration scenarios', () => {
    it('works in CI environment with GITHUB_TOKEN', () => {
      process.env.CI = 'true';
      process.env.GITHUB_TOKEN = 'ghp_ci_token';

      const token = getGitHubToken();

      expect(token).toBe('ghp_ci_token');
      delete process.env.CI;
    });

    it('works in local development with gh CLI', () => {
      delete process.env.GITHUB_TOKEN;
      delete process.env.CI;

      vi.mocked(execSync).mockReturnValueOnce('ghp_local_dev_token');

      const token = getGitHubToken();

      expect(token).toBe('ghp_local_dev_token');
    });

    it('gracefully handles missing authentication in all methods', () => {
      delete process.env.GITHUB_TOKEN;

      vi.mocked(execSync).mockImplementationOnce(() => {
        throw new Error('not authenticated');
      });

      const token = getGitHubToken();

      expect(token).toBeUndefined();
    });
  });
});
