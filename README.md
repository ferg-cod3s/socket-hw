# socket-hw Monorepo

## Scanner CLI

A multi-ecosystem vulnerability scanner that auto-detects project type, ensures lockfiles, and queries OSV for security issues.

### Usage

```bash
# Build
pnpm -F cli build

# Scan current directory
scanner

# Scan a specific directory
scanner /path/to/project

# Scan by passing a manifest or lockfile directly (resolves to parent directory)
scanner /path/to/project/package.json
scanner /path/to/project/pnpm-lock.yaml
scanner /path/to/project/pyproject.toml
scanner /path/to/project/requirements.txt

# Include devDependencies
scanner --dev

# Force lockfile validation (fail if drift)
scanner --validate-lock

# Use custom ignore file
scanner --ignore-file .vuln-ignore.json

# Check for unmaintained packages
scanner --check-maintenance

# Force lockfile refresh
scanner --refresh-lock

# Control concurrency (default: 10)
scanner --concurrency 5

# Output JSON format for CI/CD integration
scanner --output json
```

### Features

- **Multi-ecosystem support** via provider abstraction
  - **Node.js**: npm, pnpm, yarn (classic and berry)
  - **Python**: Poetry projects with `pyproject.toml`, pip `requirements.txt`
  - **Go**: `go.mod` and `go.sum` support (bonus feature)
- **Transitive dependency resolution** via lockfile parsing
  - Extracts all dependencies from lockfiles (package-lock.json, pnpm-lock.yaml, yarn.lock, poetry.lock, go.sum)
  - Falls back to manifest-only parsing when lockfiles unavailable
- **Dual vulnerability databases**
  - Query both OSV.dev and GitHub Security Advisories (GHSA)
  - Results merged and deduplicated automatically
- **High-performance batch queries**
  - OSV.dev batch endpoint (up to 50 queries per request)
  - **50x faster** for large projects (500 packages: ~2.5min → ~3s)
  - Automatic retry with exponential backoff for reliability
- **Auto-detects ecosystem** from manifest and lockfile presence
- **Ensures/validates lockfiles** before scanning (creates if missing, validates if present)
- **Parallel vulnerability scanning** with configurable concurrency
- **Flexible output formats**
  - Console output (default): Human-readable, colored output with severity indicators
  - JSON output: Machine-readable format for CI/CD integration (`--output json`)
- **Remediation suggestions** showing patched versions
- **Advisory links** included in output
- **Advisory suppression/ignore list** (bonus feature): Suppress false positives or known issues via `.vuln-ignore.json`
- **Unmaintained package detection** (bonus feature): Flag packages with no releases in 12+ months
- **Extensible architecture** for adding new language ecosystems
- **Web UI** (bonus feature): Upload lockfiles via web interface for quick scanning

### Examples

#### Node.js Project
```bash
# Scan a Node.js project
scanner /path/to/node-project

# With JSON output for CI/CD
scanner /path/to/node-project --output json
```

#### Python Poetry Project
```bash
# Scan a Poetry project (uses pyproject.toml and poetry.lock)
scanner /path/to/python-project
```

#### Python pip Project
```bash
# Scan a pip project with requirements.txt
scanner /path/to/python-project

# Or scan the requirements file directly
scanner /path/to/python-project/requirements.txt
```

#### Go Project
```bash
# Scan a Go project (uses go.mod and go.sum)
scanner /path/to/go-project
```

#### Mixed Output Examples
```bash
# Include dev dependencies
scanner --dev

# Control API concurrency (useful for rate-limited environments)
scanner --concurrency 5

# Force lockfile validation
scanner --validate-lock

# Force lockfile refresh before scanning
scanner --refresh-lock

# Use ignore list to suppress false positives
scanner --ignore-file .vuln-ignore.json

# Check for unmaintained packages (npm/PyPI only)
scanner --check-maintenance
```

### Known Limitations

#### Python Version Range Parsing

The scanner currently supports **exact version specifiers only** (`==`) in `requirements.txt` files.

**✅ Supported**:
```txt
django==3.1.0
requests==2.25.0
flask==1.1.2
numpy==1.19.0
```

**❌ Not Supported** (will be skipped with a warning):
```txt
django>=3.0,<4.0        # Version ranges
requests~=2.25          # Compatible release operator
flask>=1.0              # Minimum version
numpy!=1.19.0           # Excluded version
pandas>=1.0,<2.0        # Compound ranges
```

**Workarounds**:

1. **Use Poetry lockfile** (recommended):
   ```bash
   poetry lock
   scanner /path/to/project  # Will use poetry.lock automatically
   ```

2. **Use Pipfile.lock**:
   ```bash
   pipenv lock
   scanner /path/to/project  # Will use Pipfile.lock automatically
   ```

3. **Generate exact versions**:
   ```bash
   pip freeze > requirements-lock.txt
   scanner /path/to/project/requirements-lock.txt
   ```

4. **Use pyproject.toml with Poetry**:
   - Poetry projects with `pyproject.toml` are fully supported
   - Lockfile parsing provides accurate dependency resolution

**Why this limitation?**
- Version ranges (>=, ~=, etc.) require resolving which exact version is installed
- Lockfiles (`poetry.lock`, `Pipfile.lock`) contain the resolved versions
- For accurate vulnerability scanning, we need exact package versions
- Scanning `requirements.txt` with ranges may miss vulnerabilities in versions not explicitly listed

#### Advisory Suppression/Ignore List

The scanner supports suppressing false positives or known issues via a `.vuln-ignore.json` file:

**Example `.vuln-ignore.json`**:
```json
{
  "version": "1.0",
  "ignores": [
    {
      "id": "CVE-2024-1234",
      "reason": "False positive - not applicable to our use case",
      "expires": "2025-12-31"
    },
    {
      "package": "lodash",
      "packageVersion": "4.17.21",
      "reason": "Known issue, upgrading in next release",
      "expires": "2025-06-30"
    },
    {
      "package": "legacy-package",
      "reason": "Legacy package, will be removed in Q2 2025"
    }
  ]
}
```

**Ignore rules support**:
- By CVE ID or advisory ID (e.g., `CVE-2024-1234`, `GHSA-xxxx`)
- By package name (all versions)
- By package name and version (specific version)
- Expiration dates for temporary ignores
- Custom reasons for documentation

**Usage**:
```bash
# Auto-detects .vuln-ignore.json in project directory
scanner /path/to/project

# Use custom ignore file
scanner --ignore-file /path/to/custom-ignore.json
```

#### Unmaintained Package Detection

Check for packages with no releases in 12+ months:

```bash
scanner --check-maintenance /path/to/project
```

**Features**:
- Queries npm/PyPI registries for last release date
- Flags packages with no releases in 12+ months
- Shows download statistics (weekly/monthly)
- Displays days since last release
- Supports npm and PyPI ecosystems

**Example output**:
```
⚠ Unmaintained Packages (2):
  • old-package (last release: 450 days ago)
    Weekly downloads: 1,234
  • abandoned-lib (last release: 600 days ago)
    Weekly downloads: 567
```

#### Test Coverage

The scanner has comprehensive test coverage for:
- ✅ Lockfile parsing (npm, pnpm, yarn, poetry, pip, go)
- ✅ Provider auto-detection
- ✅ API query handling (OSV, GHSA)
- ✅ Error handling and retry logic
- ✅ Output formatting (console, JSON)
- ✅ Ignore list filtering (18 test cases)
- ✅ Maintenance checking

Known gaps:
- ⚠️ Large-scale performance testing (1000+ packages)
- ⚠️ Edge cases in lockfile formats (corrupted files, unusual structures)

## Docs

- Architecture: docs/architecture.md
- Objectives: docs/objectives.md

## Web UI

The project includes a Next.js web interface for scanning lockfiles via browser.

```bash
# Start the web UI
pnpm --filter web dev

# Access at http://localhost:3000
```

Features:
- Upload lockfiles (file or directory)
- Real-time vulnerability scanning
- Dashboard view of results
- Support for all ecosystems (Node.js, Python, Go)
