# Testing Best Practices Guide

This document outlines testing standards and best practices for the vulnerability scanner CLI.

## Table of Contents

- [Test Organization](#test-organization)
- [Test Structure](#test-structure)
- [Naming Conventions](#naming-conventions)
- [Test Helpers](#test-helpers)
- [Mocking Best Practices](#mocking-best-practices)
- [Coverage Goals](#coverage-goals)
- [Common Patterns](#common-patterns)

## Test Organization

### File Structure

Tests are organized to mirror the source code structure:

```
cli/
├── src/
│   ├── providers/
│   │   ├── go/index.ts
│   │   └── node/index.ts
│   └── core/scan.ts
└── test/
    ├── providers/
    │   ├── go.test.ts          # Tests for go provider
    │   └── node.test.ts        # Tests for node provider
    ├── core/
    │   └── scan.test.ts        # Tests for scan logic
    └── helpers/
        └── test-utils.ts       # Shared test utilities
```

### Test File Naming

- Test files should end with `.test.ts`
- Match the source file name: `index.ts` → `index.test.ts` or use descriptive names like `go.test.ts`
- E2E tests use `.e2e.test.ts` suffix

## Test Structure

### Standard Test Organization

Use nested `describe` blocks to organize tests by functionality:

```typescript
describe('ProviderName', () => {
  // Setup
  let provider: Provider;

  beforeEach(() => {
    provider = new Provider();
  });

  describe('methodName', () => {
    it('should handle normal case', () => {
      // Arrange
      const input = 'test';

      // Act
      const result = provider.methodName(input);

      // Assert
      expect(result).toBe('expected');
    });

    it('should handle error case', () => {
      expect(() => provider.methodName(null)).toThrow('error message');
    });
  });

  describe('anotherMethod', () => {
    // More tests...
  });
});
```

### AAA Pattern (Arrange-Act-Assert)

Always structure tests using the AAA pattern:

```typescript
it('should parse go.mod file', async () => {
  // Arrange - Set up test data and conditions
  await withTempDir(async (dir) => {
    createFile(dir, 'go.mod', GoFixtures.singleRequire('pkg', 'v1.0.0'));

    // Act - Execute the code under test
    const deps = await provider.gatherDependencies(dir, {});

    // Assert - Verify the results
    expect(deps).toHaveLength(1);
    expect(deps[0].name).toBe('pkg');
    expect(deps[0].version).toBe('1.0.0');
  });
});
```

## Naming Conventions

### Test Descriptions

Use clear, descriptive test names that explain:
1. What is being tested
2. Under what conditions
3. What the expected outcome is

**Good:**
```typescript
it('returns null when go.mod does not exist')
it('excludes indirect dependencies by default')
it('includes indirect dependencies when includeDev is true')
```

**Bad:**
```typescript
it('works')
it('test 1')
it('should return something')
```

### Group Related Tests

```typescript
describe('gatherDependencies', () => {
  describe('go.sum parsing', () => {
    it('parses basic go.sum format')
    it('handles malformed lines')
    it('deduplicates entries')
  });

  describe('go.mod parsing', () => {
    it('parses require blocks')
    it('parses single-line requires')
    it('excludes indirect dependencies')
  });

  describe('error handling', () => {
    it('throws error when neither file exists')
    it('prefers go.sum over go.mod')
  });
});
```

## Test Helpers

### Use Shared Utilities

Import from `test/helpers/test-utils.ts`:

```typescript
import {
  withTempDir,
  createFile,
  GoFixtures,
  NodeFixtures,
  TestAssertions,
} from '../helpers/test-utils.js';

it('should parse dependencies', async () => {
  await withTempDir(async (dir) => {
    createFile(dir, 'go.mod', GoFixtures.minimalGoMod);
    // ... test logic
  });
});
```

### Available Helpers

#### `withTempDir(fn)`
Creates and cleans up temporary test directories automatically.

#### `createFile(dir, filename, content)`
Creates files in test directories with less boilerplate.

#### Fixtures
Pre-defined test data for common scenarios:
- `GoFixtures.minimalGoMod`
- `GoFixtures.singleRequire(module, version)`
- `GoFixtures.requireBlock(requires[])`
- `NodeFixtures.packageJsonWithDeps(deps, devDeps?)`

#### Assertions
Common assertion patterns:
- `TestAssertions.hasDependency(deps, name, version?)`
- `TestAssertions.allHaveRequiredFields(deps)`
- `TestAssertions.noDuplicates(deps)`

## Mocking Best Practices

### Mock at the Right Level

```typescript
// Good: Mock external dependencies
vi.mock('../../src/api/osv.js', () => ({
  queryOsv: vi.fn(),
}));

// Bad: Mock internal implementation details
vi.mock('../../src/utils/parse.js'); // Too granular
```

### Clean Up Mocks

Always reset mocks between tests:

```typescript
beforeEach(() => {
  vi.clearAllMocks();
  vi.resetAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});
```

### Use Mock Helpers for Console Methods

```typescript
import { MockHelpers } from '../helpers/test-utils.js';

it('should warn when file missing', () => {
  const mockWarn = MockHelpers.mockConsoleWarn();

  provider.checkFile('nonexistent');

  expect(mockWarn.spy).toHaveBeenCalledWith(
    expect.stringContaining('not found')
  );

  mockWarn.restore();
});
```

## Coverage Goals

### Target Coverage

| Component | Target | Current | Status |
|-----------|--------|---------|--------|
| Providers | 95%+ | 98%+ | ✅ |
| Core Logic | 95%+ | 96%+ | ✅ |
| Utils | 90%+ | 85%+ | ⚠️ |
| Overall | 85%+ | 86%+ | ✅ |

### What to Test

**Always test:**
- ✅ Happy path (normal operation)
- ✅ Error cases (invalid input, missing files, etc.)
- ✅ Edge cases (empty input, null, undefined, etc.)
- ✅ Boundary conditions (min/max values, empty arrays, etc.)

**Example:**
```typescript
describe('parseVersion', () => {
  it('parses standard version', () => {
    expect(parseVersion('v1.2.3')).toBe('1.2.3');
  });

  it('handles version without v prefix', () => {
    expect(parseVersion('1.2.3')).toBe('1.2.3');
  });

  it('handles pseudo-versions', () => {
    expect(parseVersion('v0.0.0-20230101-abc123')).toBe('0.0.0-20230101-abc123');
  });

  it('throws on invalid version', () => {
    expect(() => parseVersion('')).toThrow('Invalid version');
  });

  it('handles null gracefully', () => {
    expect(() => parseVersion(null)).toThrow();
  });
});
```

## Common Patterns

### Testing File System Operations

```typescript
import { withTempDir, createFile } from '../helpers/test-utils.js';

it('should read configuration file', async () => {
  await withTempDir(async (dir) => {
    // Create test files
    createFile(dir, 'config.json', JSON.stringify({ foo: 'bar' }));

    // Test logic
    const config = readConfig(dir);

    // Assertions
    expect(config.foo).toBe('bar');
  });
  // Directory automatically cleaned up
});
```

### Testing Async Operations

```typescript
it('should fetch data asynchronously', async () => {
  const mockFetch = vi.fn().mockResolvedValue({ data: 'test' });

  const result = await fetchData();

  expect(mockFetch).toHaveBeenCalledTimes(1);
  expect(result.data).toBe('test');
});
```

### Testing Error Handling

```typescript
it('should throw meaningful error', async () => {
  await expect(
    provider.parse('invalid-input')
  ).rejects.toThrow('Expected format: module@version');
});

// For synchronous code
it('should throw on invalid input', () => {
  expect(() => parse('bad')).toThrow(/invalid format/i);
});
```

### Testing with Fixtures

```typescript
import { GoFixtures } from '../helpers/test-utils.js';

it('should parse require block', async () => {
  await withTempDir(async (dir) => {
    const goMod = GoFixtures.requireBlock([
      { module: 'github.com/pkg/errors', version: 'v0.9.1' },
      { module: 'golang.org/x/sync', version: 'v0.1.0', indirect: true },
    ]);

    createFile(dir, 'go.mod', goMod);

    const deps = await provider.gatherDependencies(dir, {});

    expect(deps).toHaveLength(1); // Indirect excluded by default
    expect(deps[0].name).toBe('github.com/pkg/errors');
  });
});
```

### Testing Provider Detection

```typescript
describe('detect', () => {
  it('returns null when manifest missing', async () => {
    await withTempDir(async (dir) => {
      expect(provider.detect(dir)).toBeNull();
    });
  });

  it('detects project when manifest exists', async () => {
    await withTempDir(async (dir) => {
      createFile(dir, 'go.mod', GoFixtures.minimalGoMod);

      const result = provider.detect(dir);

      expect(result).not.toBeNull();
      expect(result.providerId).toBe('go');
      expect(result.confidence).toBe(1.0);
    });
  });
});
```

## Running Tests

```bash
# Run all tests
pnpm test

# Run with coverage
pnpm test --coverage

# Run specific test file
pnpm test providers/go.test.ts

# Run in watch mode
pnpm test --watch

# Run with specific test name pattern
pnpm test -t "should parse"
```

## Debugging Tests

### Use test.only for focused testing

```typescript
it.only('should debug this specific test', () => {
  // Only this test will run
});
```

### Add console.log for debugging

```typescript
it('should process data', () => {
  const result = processData(input);
  console.log('Debug result:', JSON.stringify(result, null, 2));
  expect(result).toBeDefined();
});
```

### Use --reporter verbose

```bash
pnpm test --reporter=verbose
```

## CI/CD Considerations

- Tests must pass before merging
- Coverage must not decrease
- All async operations must have timeouts
- No test.only or describe.only in committed code
- Clean up all temporary files and resources

## Review Checklist

Before submitting tests:

- [ ] All tests pass locally
- [ ] Coverage meets or exceeds targets
- [ ] Used shared helpers where applicable
- [ ] Test names are clear and descriptive
- [ ] Edge cases are covered
- [ ] Mocks are properly cleaned up
- [ ] No `.only` or `.skip` in committed code
- [ ] Temporary files/directories are cleaned up
- [ ] Async operations have proper await/async
