# Vulnerability Scanner - Usage Guide

## Overview

The CLI scanner is a comprehensive vulnerability scanning tool that can detect and report security issues in your projects across multiple ecosystems (npm, Go, Rust, Python, etc.).

## Quick Start

### Single Project Scan

```bash
# Scan current directory
node cli/bin/scanner.js .

# Scan specific directory
node cli/bin/scanner.js /Users/johnferguson/Github/socket-hw

# Scan with output options
node cli/bin/scanner.js /path/to/project --output json

# Include devDependencies
node cli/bin/scanner.js /path/to/project --dev

# Check for unmaintained packages
node cli/bin/scanner.js /path/to/project --check-maintenance
```

### Scan All Projects in ~/Github

```bash
# Run the comprehensive scanner script
cd /Users/johnferguson/Github/socket-hw
./scan-all-projects.sh
```

This will:

1. Find all projects with dependency manifests (package.json, go.mod, Cargo.toml, etc.)
2. Scan each project individually
3. Generate JSON reports in `./scan-results/` directory
4. Display a summary of findings

## Command Options

| Option                | Description                     | Default       |
| --------------------- | ------------------------------- | ------------- |
| `dir`                 | Directory to scan               | `.` (current) |
| `--dev`               | Include devDependencies         | `false`       |
| `--lockfile`          | Lockfile handling mode          | None          |
| `--concurrency`       | Max concurrent OSV queries      | `10`          |
| `--output`            | Output format (console/json)    | `console`     |
| `--ignore-file`       | Path to ignore config file      | None          |
| `--check-maintenance` | Check for unmaintained packages | `false`       |

## Output Formats

### Console Output

Clean, human-readable format with color coding:

- **✓** = No vulnerabilities
- **✗** = Vulnerabilities found
- **ℹ** = Information messages

```
✓ No vulnerabilities found in 636 packages
```

### JSON Output

Structured format for programmatic use:

```json
{
  "summary": {
    "scanned": 636,
    "vulnerable": 0,
    "totalVulnerabilities": 0,
    "scanDuration": "45000ms",
    "timestamp": "2025-11-08T15:30:00.000Z"
  },
  "packages": [
    {
      "name": "package-name",
      "version": "1.0.0",
      "vulnerabilities": []
    }
  ]
}
```

## Examples

### Example 1: Quick scan with maintenance check

```bash
node cli/bin/scanner.js /Users/johnferguson/Github/socket-hw --check-maintenance
```

### Example 2: Validate lockfile before scanning

```bash
node cli/bin/scanner.js /path/to/project --lockfile check
```

### Example 3: Refresh lockfile and scan latest versions

```bash
node cli/bin/scanner.js /path/to/project --lockfile refresh
```

### Example 4: Scan multiple projects

```bash
for project in /Users/johnferguson/Github/*/; do
  echo "Scanning $project"
  node cli/bin/scanner.js "$project" --output json
done
```

### Example 5: Get detailed JSON results

```bash
node cli/bin/scanner.js /path/to/project --output json | jq '.summary'
```

### Example 6: Ignore known vulnerabilities

```bash
node cli/bin/scanner.js /path/to/project --ignore-file .vuln-ignore.json
```

### Example 2: Scan multiple projects

```bash
for project in /Users/johnferguson/Github/*/; do
  echo "Scanning $project"
  node cli/bin/scanner.js "$project" --output json
done
```

### Example 3: Get detailed JSON results

```bash
node cli/bin/scanner.js /path/to/project --output json | jq '.summary'
```

### Example 4: Ignore known vulnerabilities

```bash
node cli/bin/scanner.js /path/to/project --ignore-file .vuln-ignore.json
```

## Scanning Multiple Ecosystems

The scanner automatically detects and handles:

- **JavaScript/Node.js**: `package.json` + `pnpm-lock.yaml`, `yarn.lock`, `package-lock.json`
- **Go**: `go.mod` + `go.sum`
- **Rust**: `Cargo.toml` + `Cargo.lock`
- **Python**: `requirements.txt`, `Pipfile`, `poetry.lock`, etc.
- **Ruby**: `Gemfile` + `Gemfile.lock`
- **PHP**: `composer.json` + `composer.lock`
- **Java**: `pom.xml`, `build.gradle`, etc.

## Results & Reports

### Scan Results Directory

Results are saved to `./scan-results/` with timestamp:

```
scan-results/
├── socket-hw_20251108_154200.json
├── coolify-mcp-server_20251108_154205.json
├── ogdrip_20251108_154210.json
└── ...
```

### Parse Results

```bash
# View all vulnerable packages
jq '.packages[] | select(.vulnerabilities | length > 0)' scan-results/*.json

# Count total vulnerabilities
jq -s 'map(.summary.totalVulnerabilities) | add' scan-results/*.json

# Find HIGH severity issues
jq '.packages[] | select(.vulnerabilities[] | select(.severity == "HIGH"))' scan-results/*.json
```

## Testing & Development

### Run Scanner Tests

```bash
cd cli
pnpm test
```

### Build Scanner

```bash
cd cli
pnpm build
```

### Debug Mode

```bash
# With detailed logging
DEBUG=* node cli/bin/scanner.js /path/to/project
```

## Integration Options

### GitHub Actions

```yaml
- name: Scan vulnerabilities
  run: node cli/bin/scanner.js . --output json > scan-results.json

- name: Check for critical vulnerabilities
  run: |
    CRITICAL=$(jq '.packages[] | select(.vulnerabilities[] | select(.severity == "CRITICAL")) | .name' scan-results.json | wc -l)
    if [ $CRITICAL -gt 0 ]; then exit 1; fi
```

### Pre-commit Hook

```bash
#!/bin/bash
node ./cli/bin/scanner.js . --output json > /tmp/scan.json
VULNS=$(jq '.summary.totalVulnerabilities' /tmp/scan.json)
if [ "$VULNS" -gt 0 ]; then
  echo "Vulnerabilities found, blocking commit"
  exit 1
fi
```

## Troubleshooting

### No dependencies found

- Ensure the directory contains a valid manifest file (package.json, go.mod, etc.)
- Check that the scanner can read the manifest file

### Slow scans

- Use `--concurrency` to adjust parallel requests: `--concurrency 5`
- Exclude devDependencies with `--dev false`

### JSON parse errors

- Ensure `jq` is installed: `brew install jq`
- Check the raw output without piping to jq first

## Performance Notes

- **First run**: Slower due to OSV database initialization
- **Typical scan**: 30-60 seconds for medium projects (100-200 packages)
- **Large projects**: 1-2 minutes for projects with 500+ packages

## Security Notes

- Scan results contain vulnerability information - handle appropriately
- Use `--ignore-file` to whitelist known acceptable risks
- Keep the scanner updated: rebuilds are fast and safe

## Support

For issues or questions:

- Check existing test cases in `cli/test/`
- Review the source code in `cli/src/`
- Build commands: `cd cli && pnpm build`
