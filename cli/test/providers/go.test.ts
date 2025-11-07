/**
 * Test suite for Go provider
 *
 * This file tests the Go modules provider which handles:
 * - Detection of Go projects (go.mod presence)
 * - Parsing go.mod files (require blocks and single-line requires)
 * - Parsing go.sum files (checksums and resolved versions)
 * - Handling indirect dependencies
 * - Standalone file scanning
 *
 * Coverage: 98.87%
 * Tests: 32
 */

import {
  describe,
  it,
  expect,
  beforeEach,
  vi,
  withTempDir,
  createFile,
  GoFixtures,
  MockHelpers,
  writeFileSync,
  join,
} from '../helpers/test-utils.js';

describe('GoProvider', () => {
  let GoProvider: any;
  let provider: any;

  beforeEach(async () => {
    ({ GoProvider } = await import('../../src/providers/go/index.js'));
    provider = new GoProvider();
  });

  describe('detect', () => {
    it('returns null when go.mod does not exist', async () => {
      await withTempDir(async (dir) => {
        // Arrange: Empty directory

        // Act & Assert
        expect(provider.detect(dir)).toBeNull();
      });
    });

    it('detects Go project when go.mod exists', async () => {
      await withTempDir(async (dir) => {
        // Arrange
        createFile(dir, 'go.mod', GoFixtures.minimalGoMod);

        // Act
        const result = provider.detect(dir);

        // Assert
        expect(result).not.toBeNull();
        expect(result.providerId).toBe('go');
        expect(result.name).toBe('Go modules');
        expect(result.confidence).toBe(1.0);
      });
    });

    it('detects Go project even without go.sum', async () => {
      await withTempDir(async (dir) => {
        // Arrange
        createFile(dir, 'go.mod', GoFixtures.minimalGoMod);

        // Act
        const result = provider.detect(dir);

        // Assert
        expect(result).not.toBeNull();
      });
    });
  });

  describe('ensureLockfile', () => {
    it('throws error when go.mod not found', async () => {
      await withTempDir(async (dir) => {
        await expect(provider.ensureLockfile(dir, {})).rejects.toThrow(
          'go.mod not found'
        );
      });
    });

    it('succeeds when go.mod exists and no validation requested', async () => {
      await withTempDir(async (dir) => {
        writeFileSync(join(dir, 'go.mod'), 'module example.com/test\n');

        await expect(
          provider.ensureLockfile(dir, {})
        ).resolves.toBeUndefined();
      });
    });

    it('warns when go.sum missing and forceValidate is true', async () => {
      await withTempDir(async (dir) => {
        // Arrange
        createFile(dir, 'go.mod', GoFixtures.minimalGoMod);
        const mockWarn = MockHelpers.mockConsoleWarn();

        // Act
        await provider.ensureLockfile(dir, { forceValidate: true });

        // Assert
        expect(mockWarn.spy).toHaveBeenCalledWith(
          expect.stringContaining('go.sum not found')
        );

        mockWarn.restore();
      });
    });

    it('does not warn when go.sum exists and forceValidate is true', async () => {
      await withTempDir(async (dir) => {
        // Arrange
        createFile(dir, 'go.mod', GoFixtures.minimalGoMod);
        createFile(dir, 'go.sum', '');
        const mockWarn = MockHelpers.mockConsoleWarn();

        // Act
        await provider.ensureLockfile(dir, { forceValidate: true });

        // Assert
        expect(mockWarn.spy).not.toHaveBeenCalled();

        mockWarn.restore();
      });
    });

    it('does not validate when forceValidate is false', async () => {
      await withTempDir(async (dir) => {
        // Arrange
        createFile(dir, 'go.mod', GoFixtures.minimalGoMod);
        const mockWarn = MockHelpers.mockConsoleWarn();

        // Act
        await provider.ensureLockfile(dir, { forceValidate: false });

        // Assert
        expect(mockWarn.spy).not.toHaveBeenCalled();

        mockWarn.restore();
      });
    });
  });

  /**
   * Tests for go.sum parsing
   *
   * go.sum is the lockfile format for Go modules containing checksums.
   * These tests verify:
   * - Basic parsing of go.sum format
   * - Version prefix handling (v prefix removal)
   * - Filtering of go.mod entries (checksums only)
   * - Deduplication of duplicate entries
   * - Handling of malformed lines
   */
  describe('gatherDependencies - go.sum parsing', () => {
    it('parses go.sum file from directory', async () => {
      await withTempDir(async (dir) => {
        const goSumContent = `github.com/pkg/errors v0.9.1 h1:FEBLx1zS214owpjy7qsBeixbURkuhQAwrK5UwLGTwt4=
github.com/pkg/errors v0.9.1/go.mod h1:bwawxfHBFNV+L2hUp1rHADufV3IMtnDRdf1r5NINEl0=
golang.org/x/sync v0.1.0 h1:wsuoTGHzEhffawBOhz5CYhcrV4IdKZbEyZjBMuTp12o=
`;
        writeFileSync(join(dir, 'go.sum'), goSumContent);

        const deps = await provider.gatherDependencies(dir, {});

        expect(deps.length).toBeGreaterThanOrEqual(2);
        expect(deps.some((d) => d.name === 'github.com/pkg/errors')).toBe(true);
        expect(deps.some((d) => d.name === 'golang.org/x/sync')).toBe(true);
      });
    });

    it('removes v prefix from versions in go.sum', async () => {
      await withTempDir(async (dir) => {
        const goSumContent = `github.com/pkg/errors v0.9.1 h1:hash
`;
        writeFileSync(join(dir, 'go.sum'), goSumContent);

        const deps = await provider.gatherDependencies(dir, {});

        expect(deps[0].version).toBe('0.9.1');
      });
    });

    it('skips go.mod entries in go.sum', async () => {
      await withTempDir(async (dir) => {
        const goSumContent = `github.com/pkg/errors v0.9.1 h1:hash
github.com/pkg/errors v0.9.1/go.mod h1:hash2
`;
        writeFileSync(join(dir, 'go.sum'), goSumContent);

        const deps = await provider.gatherDependencies(dir, {});

        expect(deps).toHaveLength(1);
        expect(deps[0].name).toBe('github.com/pkg/errors');
      });
    });

    it('deduplicates entries in go.sum', async () => {
      await withTempDir(async (dir) => {
        const goSumContent = `github.com/pkg/errors v0.9.1 h1:hash1
github.com/pkg/errors v0.9.1 h1:hash2
`;
        writeFileSync(join(dir, 'go.sum'), goSumContent);

        const deps = await provider.gatherDependencies(dir, {});

        expect(deps).toHaveLength(1);
      });
    });

    it('handles empty lines in go.sum', async () => {
      await withTempDir(async (dir) => {
        const goSumContent = `
github.com/pkg/errors v0.9.1 h1:hash

golang.org/x/sync v0.1.0 h1:hash2

`;
        writeFileSync(join(dir, 'go.sum'), goSumContent);

        const deps = await provider.gatherDependencies(dir, {});

        expect(deps).toHaveLength(2);
      });
    });

    it('handles malformed lines in go.sum', async () => {
      await withTempDir(async (dir) => {
        const goSumContent = `github.com/pkg/errors v0.9.1 h1:hash
github.com/stretchr/testify v1.8.0 h1:hash
justoneword
`;
        writeFileSync(join(dir, 'go.sum'), goSumContent);

        const deps = await provider.gatherDependencies(dir, {});

        // Lines with only one word are skipped (need at least module + version)
        expect(deps).toHaveLength(2);
        expect(deps.some((d) => d.name === 'github.com/pkg/errors')).toBe(true);
        expect(deps.some((d) => d.name === 'github.com/stretchr/testify')).toBe(true);
      });
    });
  });

  /**
   * Tests for go.mod parsing
   *
   * go.mod is the manifest file for Go modules.
   * These tests verify:
   * - Parsing when go.sum is absent (fallback)
   * - Handling indirect dependencies (excluded by default)
   * - Single-line require statements
   * - Multi-line require blocks
   * - Mixed formats (single-line and blocks)
   * - Deduplication across formats
   * - Comment handling
   */
  describe('gatherDependencies - go.mod parsing', () => {
    it('parses go.mod file when go.sum does not exist', async () => {
      await withTempDir(async (dir) => {
        const goModContent = `module example.com/myproject

require github.com/pkg/errors v0.9.1
`;
        writeFileSync(join(dir, 'go.mod'), goModContent);

        const deps = await provider.gatherDependencies(dir, {});

        expect(deps).toHaveLength(1);
        expect(deps[0].name).toBe('github.com/pkg/errors');
        expect(deps[0].version).toBe('0.9.1');
      });
    });

    it('excludes indirect dependencies by default', async () => {
      await withTempDir(async (dir) => {
        // Arrange
        const goMod = GoFixtures.requireBlock([
          { module: 'github.com/pkg/errors', version: 'v0.9.1' },
          { module: 'golang.org/x/sync', version: 'v0.1.0', indirect: true },
        ]);
        createFile(dir, 'go.mod', goMod);

        // Act
        const deps = await provider.gatherDependencies(dir, {});

        // Assert - indirect dependencies excluded by default
        expect(deps).toHaveLength(1);
        expect(deps[0].name).toBe('github.com/pkg/errors');
      });
    });

    it('includes indirect dependencies when includeDev is true', async () => {
      await withTempDir(async (dir) => {
        // Arrange
        const goMod = GoFixtures.requireBlock([
          { module: 'github.com/pkg/errors', version: 'v0.9.1' },
          { module: 'golang.org/x/sync', version: 'v0.1.0', indirect: true },
        ]);
        createFile(dir, 'go.mod', goMod);

        // Act
        const deps = await provider.gatherDependencies(dir, { includeDev: true });

        // Assert - both direct and indirect dependencies included
        expect(deps).toHaveLength(2);
        expect(deps.some((d) => d.name === 'github.com/pkg/errors')).toBe(true);
        expect(deps.some((d) => d.name === 'golang.org/x/sync')).toBe(true);
      });
    });

    it('parses single-line require statements', async () => {
      await withTempDir(async (dir) => {
        const goModContent = `module example.com/myproject

require github.com/pkg/errors v0.9.1
require golang.org/x/sync v0.1.0
`;
        writeFileSync(join(dir, 'go.mod'), goModContent);

        const deps = await provider.gatherDependencies(dir, {});

        expect(deps).toHaveLength(2);
      });
    });

    it('parses multiple require blocks', async () => {
      await withTempDir(async (dir) => {
        const goModContent = `module example.com/myproject

require (
	github.com/pkg/errors v0.9.1
)

require (
	github.com/stretchr/testify v1.8.0
)
`;
        writeFileSync(join(dir, 'go.mod'), goModContent);

        const deps = await provider.gatherDependencies(dir, {});

        expect(deps).toHaveLength(2);
        expect(deps.some((d) => d.name === 'github.com/pkg/errors')).toBe(true);
        expect(deps.some((d) => d.name === 'github.com/stretchr/testify')).toBe(true);
      });
    });

    it('removes v prefix from versions in go.mod', async () => {
      await withTempDir(async (dir) => {
        const goModContent = `module example.com/myproject

require github.com/pkg/errors v0.9.1
`;
        writeFileSync(join(dir, 'go.mod'), goModContent);

        const deps = await provider.gatherDependencies(dir, {});

        expect(deps[0].version).toBe('0.9.1');
      });
    });

    it('skips comment lines in require blocks', async () => {
      await withTempDir(async (dir) => {
        const goModContent = `module example.com/myproject

require (
	// This is a comment
	github.com/pkg/errors v0.9.1
	// Another comment
)
`;
        writeFileSync(join(dir, 'go.mod'), goModContent);

        const deps = await provider.gatherDependencies(dir, {});

        expect(deps).toHaveLength(1);
      });
    });

    it('deduplicates dependencies in go.mod', async () => {
      await withTempDir(async (dir) => {
        // Test deduplication within a single require block
        const goModContent = `module example.com/myproject

require (
	github.com/pkg/errors v0.9.1
	github.com/pkg/errors v0.9.1
)
`;
        writeFileSync(join(dir, 'go.mod'), goModContent);

        const deps = await provider.gatherDependencies(dir, {});

        expect(deps).toHaveLength(1);
      });
    });

    it('correctly handles mixed single-line and block requires', async () => {
      await withTempDir(async (dir) => {
        const goModContent = `module example.com/myproject

require github.com/pkg/errors v0.9.1

require (
	github.com/stretchr/testify v1.8.0
)
`;
        writeFileSync(join(dir, 'go.mod'), goModContent);

        const deps = await provider.gatherDependencies(dir, {});

        expect(deps).toHaveLength(2);
        expect(deps.some((d) => d.name === 'github.com/pkg/errors')).toBe(true);
        expect(deps.some((d) => d.name === 'github.com/stretchr/testify')).toBe(true);
      });
    });

    it('deduplicates across single-line and block requires', async () => {
      await withTempDir(async (dir) => {
        const goModContent = `module example.com/myproject

require github.com/pkg/errors v0.9.1

require (
	github.com/pkg/errors v0.9.1
)
`;
        writeFileSync(join(dir, 'go.mod'), goModContent);

        const deps = await provider.gatherDependencies(dir, {});

        expect(deps).toHaveLength(1);
        expect(deps[0].name).toBe('github.com/pkg/errors');
      });
    });
  });

  describe('gatherDependencies - standalone file scanning', () => {
    it('parses standalone go.sum file', async () => {
      await withTempDir(async (dir) => {
        const goSumPath = join(dir, 'go.sum');
        const goSumContent = `github.com/pkg/errors v0.9.1 h1:hash
`;
        writeFileSync(goSumPath, goSumContent);

        const deps = await provider.gatherDependencies(dir, {
          standaloneLockfile: goSumPath,
        });

        expect(deps).toHaveLength(1);
        expect(deps[0].name).toBe('github.com/pkg/errors');
      });
    });

    it('parses standalone go.mod file', async () => {
      await withTempDir(async (dir) => {
        const goModPath = join(dir, 'go.mod');
        const goModContent = `module test

require github.com/pkg/errors v0.9.1
`;
        writeFileSync(goModPath, goModContent);

        const deps = await provider.gatherDependencies(dir, {
          standaloneLockfile: goModPath,
        });

        expect(deps).toHaveLength(1);
        expect(deps[0].name).toBe('github.com/pkg/errors');
      });
    });
  });

  describe('gatherDependencies - error handling', () => {
    it('throws error when neither go.sum nor go.mod exists', async () => {
      await withTempDir(async (dir) => {
        await expect(provider.gatherDependencies(dir, {})).rejects.toThrow(
          'Neither go.sum nor go.mod found'
        );
      });
    });

    it('prefers go.sum over go.mod when both exist', async () => {
      await withTempDir(async (dir) => {
        const goSumContent = `github.com/pkg/errors v0.9.1 h1:hash
`;
        const goModContent = `module test

require github.com/stretchr/testify v1.8.0
`;
        writeFileSync(join(dir, 'go.sum'), goSumContent);
        writeFileSync(join(dir, 'go.mod'), goModContent);

        const deps = await provider.gatherDependencies(dir, {});

        // Should use go.sum, not go.mod
        expect(deps).toHaveLength(1);
        expect(deps[0].name).toBe('github.com/pkg/errors');
      });
    });
  });

  describe('complex go.mod scenarios', () => {
    it('handles replace directives', async () => {
      await withTempDir(async (dir) => {
        const goModContent = `module example.com/myproject

require github.com/pkg/errors v0.9.1

replace github.com/old/package => github.com/new/package v1.0.0
`;
        writeFileSync(join(dir, 'go.mod'), goModContent);

        const deps = await provider.gatherDependencies(dir, {});

        // Should parse require, replace directives are not dependencies
        expect(deps.some((d) => d.name === 'github.com/pkg/errors')).toBe(true);
      });
    });

    it('handles modules with nested paths', async () => {
      await withTempDir(async (dir) => {
        const goModContent = `module example.com/myproject

require (
	github.com/aws/aws-sdk-go/service/s3 v1.44.0
	golang.org/x/crypto/ssh v0.5.0
)
`;
        writeFileSync(join(dir, 'go.mod'), goModContent);

        const deps = await provider.gatherDependencies(dir, {});

        expect(deps).toHaveLength(2);
        expect(deps[0].name).toBe('github.com/aws/aws-sdk-go/service/s3');
        expect(deps[1].name).toBe('golang.org/x/crypto/ssh');
      });
    });

    it('handles pseudo-versions', async () => {
      await withTempDir(async (dir) => {
        const goModContent = `module example.com/myproject

require github.com/example/package v0.0.0-20230101120000-abcdef123456
`;
        writeFileSync(join(dir, 'go.mod'), goModContent);

        const deps = await provider.gatherDependencies(dir, {});

        expect(deps[0].version).toBe('0.0.0-20230101120000-abcdef123456');
      });
    });
  });

  describe('getSupportedManifests', () => {
    it('returns list of supported manifest files', () => {
      const manifests = provider.getSupportedManifests();

      expect(manifests).toContain('go.mod');
      expect(manifests).toContain('go.sum');
    });
  });
});
