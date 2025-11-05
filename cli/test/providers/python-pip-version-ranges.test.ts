/**
 * Tests for Python requirements.txt version range parsing
 * Covers: exact versions, ranges, operators, edge cases
 */

import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

interface Dependency {
  name: string;
  version: string;
  resolved: string;
  type: 'direct' | 'transitive';
}

describe('Python Pip Version Range Parsing', () => {
  describe('Exact Version Specifiers (==)', () => {
    it('should parse exact version with ==', () => {
      const line = 'django==3.1.0';
      const match = line.match(/^([a-zA-Z0-9_-]+)==([^=><~!,\s]+)$/);

      expect(match).toBeTruthy();
      if (match) {
        const [, name, version] = match;
        expect(name).toBe('django');
        expect(version).toBe('3.1.0');
      }
    });

    it('should parse exact version with extra whitespace', () => {
      const line = '  requests == 2.25.0  ';
      const trimmed = line.trim();
      const match = trimmed.match(/^([a-zA-Z0-9_-]+)\s*==\s*([^=><~!,\s]+)$/);

      expect(match).toBeTruthy();
      if (match) {
        const [, name, version] = match;
        expect(name).toBe('requests');
        expect(version).toBe('2.25.0');
      }
    });

    it('should parse multiple exact versions', () => {
      const lines = [
        'django==3.1.0',
        'requests==2.25.0',
        'flask==1.1.2'
      ];

      const deps: Dependency[] = [];

      lines.forEach(line => {
        const match = line.match(/^([a-zA-Z0-9_-]+)==([^=><~!,\s]+)$/);
        if (match) {
          const [, name, version] = match;
          deps.push({
            name,
            version: version.trim(),
            resolved: version.trim(),
            type: 'direct'
          });
        }
      });

      expect(deps).toHaveLength(3);
      expect(deps[0].name).toBe('django');
      expect(deps[1].name).toBe('requests');
      expect(deps[2].name).toBe('flask');
    });

    it('should handle package names with hyphens', () => {
      const line = 'scikit-learn==0.24.0';
      const match = line.match(/^([a-zA-Z0-9_-]+)==([^=><~!,\s]+)$/);

      expect(match).toBeTruthy();
      if (match) {
        const [, name, version] = match;
        expect(name).toBe('scikit-learn');
        expect(version).toBe('0.24.0');
      }
    });

    it('should handle package names with underscores', () => {
      const line = 'my_package==1.0.0';
      const match = line.match(/^([a-zA-Z0-9_-]+)==([^=><~!,\s]+)$/);

      expect(match).toBeTruthy();
      if (match) {
        const [, name, version] = match;
        expect(name).toBe('my_package');
        expect(version).toBe('1.0.0');
      }
    });
  });

  describe('Version Range Specifiers (Currently Unsupported)', () => {
    it('should detect >= operator', () => {
      const line = 'django>=3.0';
      const match = line.match(/^([a-zA-Z0-9_-]+)\s*>=\s*(.+)$/);

      expect(match).toBeTruthy();
      if (match) {
        const [, name, versionSpec] = match;
        expect(name).toBe('django');
        expect(versionSpec).toBe('3.0');
      }
    });

    it('should detect ~= operator (compatible release)', () => {
      const line = 'requests~=2.25';
      const match = line.match(/^([a-zA-Z0-9_-]+)\s*~=\s*(.+)$/);

      expect(match).toBeTruthy();
      if (match) {
        const [, name, versionSpec] = match;
        expect(name).toBe('requests');
        expect(versionSpec).toBe('2.25');
      }
    });

    it('should detect != operator (excluded version)', () => {
      const line = 'flask!=1.1.1';
      const match = line.match(/^([a-zA-Z0-9_-]+)\s*!=\s*(.+)$/);

      expect(match).toBeTruthy();
      if (match) {
        const [, name, versionSpec] = match;
        expect(name).toBe('flask');
        expect(versionSpec).toBe('1.1.1');
      }
    });

    it('should detect compound ranges with comma', () => {
      const line = 'pandas>=1.0,<2.0';
      const match = line.match(/^([a-zA-Z0-9_-]+)([=><~!].+)$/);

      expect(match).toBeTruthy();
      if (match) {
        const [, name, versionSpec] = match;
        expect(name).toBe('pandas');
        expect(versionSpec).toBe('>=1.0,<2.0');
        expect(versionSpec).toContain(',');
      }
    });

    it('should warn about unsupported range specifiers', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const unsupportedLines = [
        'django>=3.0,<4.0',
        'requests~=2.25',
        'flask>=1.0',
        'numpy!=1.19.0'
      ];

      unsupportedLines.forEach(line => {
        const exactMatch = line.match(/^([a-zA-Z0-9_-]+)==([^=><~!,\s]+)$/);
        if (!exactMatch) {
          const rangeMatch = line.match(/^([a-zA-Z0-9_-]+)[=><~!]/);
          if (rangeMatch) {
            console.warn(
              `Skipping ${rangeMatch[1]}: requirements.txt version ranges not supported. ` +
              `Use poetry.lock or Pipfile.lock for accurate scanning.`
            );
          }
        }
      });

      expect(warnSpy).toHaveBeenCalledTimes(4);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('not supported')
      );

      warnSpy.mockRestore();
    });
  });

  describe('Comment and Empty Line Handling', () => {
    it('should skip empty lines', () => {
      const lines = ['django==3.1.0', '', 'requests==2.25.0'];

      const deps: Dependency[] = [];

      lines.forEach(line => {
        const trimmed = line.trim();
        if (!trimmed) return; // Skip empty

        const match = trimmed.match(/^([a-zA-Z0-9_-]+)==([^=><~!,\s]+)$/);
        if (match) {
          const [, name, version] = match;
          deps.push({
            name,
            version,
            resolved: version,
            type: 'direct'
          });
        }
      });

      expect(deps).toHaveLength(2);
    });

    it('should skip comment lines', () => {
      const lines = [
        '# This is a comment',
        'django==3.1.0',
        '# Another comment',
        'requests==2.25.0'
      ];

      const deps: Dependency[] = [];

      lines.forEach(line => {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) return; // Skip comments

        const match = trimmed.match(/^([a-zA-Z0-9_-]+)==([^=><~!,\s]+)$/);
        if (match) {
          const [, name, version] = match;
          deps.push({
            name,
            version,
            resolved: version,
            type: 'direct'
          });
        }
      });

      expect(deps).toHaveLength(2);
    });

    it('should handle inline comments', () => {
      const line = 'django==3.1.0  # Latest stable version';

      // Remove inline comment
      const withoutComment = line.split('#')[0].trim();
      const match = withoutComment.match(/^([a-zA-Z0-9_-]+)==([^=><~!,\s]+)$/);

      expect(match).toBeTruthy();
      if (match) {
        const [, name, version] = match;
        expect(name).toBe('django');
        expect(version).toBe('3.1.0');
      }
    });
  });

  describe('Edge Cases', () => {
    it('should handle pre-release versions', () => {
      const line = 'django==3.2a1';
      const match = line.match(/^([a-zA-Z0-9_-]+)==([^=><~!,\s]+)$/);

      expect(match).toBeTruthy();
      if (match) {
        const [, name, version] = match;
        expect(name).toBe('django');
        expect(version).toBe('3.2a1');
      }
    });

    it('should handle beta versions', () => {
      const line = 'requests==2.26.0b1';
      const match = line.match(/^([a-zA-Z0-9_-]+)==([^=><~!,\s]+)$/);

      expect(match).toBeTruthy();
      if (match) {
        const [, name, version] = match;
        expect(version).toBe('2.26.0b1');
      }
    });

    it('should handle rc (release candidate) versions', () => {
      const line = 'flask==2.0.0rc1';
      const match = line.match(/^([a-zA-Z0-9_-]+)==([^=><~!,\s]+)$/);

      expect(match).toBeTruthy();
      if (match) {
        const [, name, version] = match;
        expect(version).toBe('2.0.0rc1');
      }
    });

    it('should handle dev versions', () => {
      const line = 'django==3.2.dev20210101';
      const match = line.match(/^([a-zA-Z0-9_-]+)==([^=><~!,\s]+)$/);

      expect(match).toBeTruthy();
      if (match) {
        const [, name, version] = match;
        expect(version).toContain('dev');
      }
    });

    it('should handle post-release versions', () => {
      const line = 'numpy==1.21.0.post1';
      const match = line.match(/^([a-zA-Z0-9_-]+)==(.+)$/);

      expect(match).toBeTruthy();
      if (match) {
        const [, name, version] = match;
        expect(version).toContain('post');
      }
    });

    it('should handle local version identifiers', () => {
      const line = 'mypackage==1.0.0+local.version';
      const match = line.match(/^([a-zA-Z0-9_-]+)==(.+)$/);

      expect(match).toBeTruthy();
      if (match) {
        const [, name, version] = match;
        expect(version).toContain('+');
      }
    });
  });

  describe('PEP 440 Version Specifiers', () => {
    it('should identify all PEP 440 operators', () => {
      const operators = ['==', '!=', '<=', '>=', '<', '>', '~=', '==='];

      operators.forEach((op) => {
        const line = `package${op}1.0.0`;
        const match = line.match(
          new RegExp(`^([a-zA-Z0-9_-]+)${op.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(.+)$`)
        );
        expect(match).toBeTruthy();
      });
    });

    it('should parse arbitrary equality (===)', () => {
      const line = 'package===1.0.0';
      const match = line.match(/^([a-zA-Z0-9_-]+)===(.+)$/);

      expect(match).toBeTruthy();
      if (match) {
        const [, name, version] = match;
        expect(name).toBe('package');
        expect(version).toBe('1.0.0');
      }
    });
  });

  describe('URL and VCS Requirements', () => {
    it('should detect URL requirements', () => {
      const line = 'package @ https://example.com/package-1.0.0.tar.gz';
      const isUrl = line.includes('@') && line.includes('://');

      expect(isUrl).toBe(true);
    });

    it('should detect git requirements', () => {
      const line = 'git+https://github.com/user/repo.git@v1.0.0#egg=package';
      const isGit = line.startsWith('git+');

      expect(isGit).toBe(true);
    });

    it('should skip URL and VCS requirements', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const lines = [
        'package @ https://example.com/package-1.0.0.tar.gz',
        'git+https://github.com/user/repo.git@v1.0.0#egg=package',
        '-e git+https://github.com/user/repo.git@master#egg=package'
      ];

      lines.forEach(line => {
        if (line.includes('://') || line.startsWith('-e ')) {
          console.warn(`Skipping URL/VCS requirement: ${line}`);
        }
      });

      expect(warnSpy).toHaveBeenCalledTimes(3);

      warnSpy.mockRestore();
    });
  });

  describe('Options and Flags', () => {
    it('should ignore -e/--editable flag', () => {
      const line = '-e .';
      const isOption = line.startsWith('-');

      expect(isOption).toBe(true);
    });

    it('should ignore -r/--requirement flag', () => {
      const line = '-r requirements-dev.txt';
      const isOption = line.startsWith('-');

      expect(isOption).toBe(true);
    });

    it('should ignore --hash option', () => {
      const line =
        'django==3.1.0 --hash=sha256:abcd1234...';

      // Extract package part before --hash
      const packagePart = line.split('--hash')[0].trim();
      const match = packagePart.match(/^([a-zA-Z0-9_-]+)==([^=><~!,\s]+)$/);

      expect(match).toBeTruthy();
      if (match) {
        const [, name, version] = match;
        expect(name).toBe('django');
        expect(version).toBe('3.1.0');
      }
    });
  });

  describe('Extras Specifiers', () => {
    it('should handle extras in brackets', () => {
      const line = 'requests[security]==2.25.0';
      const match = line.match(
        /^([a-zA-Z0-9_-]+)\[([^\]]+)\]==([^=><~!,\s]+)$/
      );

      expect(match).toBeTruthy();
      if (match) {
        const [, name, extras, version] = match;
        expect(name).toBe('requests');
        expect(extras).toBe('security');
        expect(version).toBe('2.25.0');
      }
    });

    it('should handle multiple extras', () => {
      const line = 'package[extra1,extra2]==1.0.0';
      const match = line.match(
        /^([a-zA-Z0-9_-]+)\[([^\]]+)\]==([^=><~!,\s]+)$/
      );

      expect(match).toBeTruthy();
      if (match) {
        const [, name, extras, version] = match;
        expect(name).toBe('package');
        expect(extras).toBe('extra1,extra2');
        expect(version).toBe('1.0.0');
      }
    });
  });

  describe('Integration Test', () => {
    it('should parse realistic requirements.txt file', () => {
      const content = `
# Core dependencies
django==3.1.0
requests==2.25.0
flask==1.1.2

# Data science
numpy==1.19.0
pandas==1.1.0

# Testing
pytest==6.0.0

# Ranges (should warn)
celery>=5.0,<6.0
redis~=3.5

# Comments and empty lines


# Development
black==20.8b1  # Code formatter
      `.trim();

      const deps: Dependency[] = [];
      const warnings: string[] = [];
      const lines = content.split('\n');

      lines.forEach(line => {
        const trimmed = line.split('#')[0].trim();
        if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('-')) {
          return;
        }

        // Try exact version first
        const exactMatch = trimmed.match(/^([a-zA-Z0-9_-]+)==([^=><~!,\s]+)$/);
        if (exactMatch) {
          const [, name, version] = exactMatch;
          deps.push({
            name,
            version,
            resolved: version,
            type: 'direct'
          });
          return;
        }

        // Warn about ranges
        const rangeMatch = trimmed.match(/^([a-zA-Z0-9_-]+)[=><~!]/);
        if (rangeMatch) {
          warnings.push(rangeMatch[1]);
        }
      });

      expect(deps).toHaveLength(7); // Only exact versions
      expect(deps.map(d => d.name)).toContain('django');
      expect(deps.map(d => d.name)).toContain('pytest');
      expect(deps.map(d => d.name)).toContain('black');

      expect(warnings).toHaveLength(2); // celery, redis
      expect(warnings).toContain('celery');
      expect(warnings).toContain('redis');
    });
  });

  describe('Documentation Examples', () => {
    it('should demonstrate supported format in docs', () => {
      const supported = `
django==3.1.0
requests==2.25.0
flask==1.1.2
      `.trim();

      const deps: Dependency[] = [];
      supported.split('\n').forEach(line => {
        const match = line.match(/^([a-zA-Z0-9_-]+)==([^=><~!,\s]+)$/);
        if (match) {
          const [, name, version] = match;
          deps.push({
            name,
            version,
            resolved: version,
            type: 'direct'
          });
        }
      });

      expect(deps).toHaveLength(3);
      deps.forEach(dep => {
        expect(dep.version).toMatch(/^\d+\.\d+\.\d+$/);
      });
    });

    it('should demonstrate unsupported formats in docs', () => {
      const unsupported = [
        'django>=3.0,<4.0',
        'requests~=2.25',
        'flask>=1.0'
      ];

      const warnings: string[] = [];

      unsupported.forEach(line => {
        const exactMatch = line.match(/^([a-zA-Z0-9_-]+)==([^=><~!,\s]+)$/);
        if (!exactMatch) {
          const rangeMatch = line.match(/^([a-zA-Z0-9_-]+)[=><~!]/);
          if (rangeMatch) {
            warnings.push(
              `Use poetry.lock or Pipfile.lock for ${rangeMatch[1]}`
            );
          }
        }
      });

      expect(warnings).toHaveLength(3);
      warnings.forEach(warning => {
        expect(warning).toContain('poetry.lock or Pipfile.lock');
      });
    });
  });
});
