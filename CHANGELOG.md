# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

### Added
- **Provider Abstraction**: Multi-ecosystem support via provider pattern
  - Provider interface (`cli/src/providers/types.ts`) with `detect()`, `ensureLockfile()`, `gatherDependencies()`
  - Provider registry and selection logic (`cli/src/providers/index.ts`)
  - **Node.js Provider** (`cli/src/providers/node/index.ts`)
    - Supports npm, pnpm, yarn (classic and berry)
    - Auto-detects from lockfiles, `package.json`, or workspace config
    - PM-specific lockfile commands
  - **Python Poetry Provider** (`cli/src/providers/python-poetry/index.ts`)
    - Detects Poetry projects from `pyproject.toml`
    - Parses `poetry.lock` for resolved versions
    - Falls back to `pyproject.toml` for declared versions
    - Supports `--dev` for dev dependencies
- **Scanner CLI**: Single-command multi-ecosystem vulnerability scanner
  - Works across Node.js and Python Poetry projects
  - Auto-detects ecosystem and manages lockfiles
  - Parallel OSV vulnerability scanning with correct ecosystem identifiers
  - Colored output with severity indicators (CRITICAL/HIGH/MEDIUM/LOW)
  - Options: `--dev`, `--validate-lock`, `--refresh-lock`, `--concurrency`
- **Comprehensive test coverage** (37/37 tests passing)
  - Provider selection tests
  - Node provider unit tests
  - Poetry provider unit tests with lockfile/pyproject.toml parsing
  - Node.js end-to-end tests
  - Python Poetry end-to-end tests
  - Legacy PM and dependency tests

### Changed
- **CLI Core** (`cli/src/index.ts`): Refactored to use provider abstraction
- **Documentation**: Updated for multi-ecosystem support
  - README.md: Added Poetry support and provider architecture
  - docs/scanner-implementation.md: Comprehensive provider documentation


