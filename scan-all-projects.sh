#!/bin/bash

# Script to scan all projects in ~/Github for vulnerabilities using the CLI scanner
# This is useful for testing the scanner across your entire codebase

SCANNER_PATH="./cli/bin/scanner.js"
GITHUB_PATH="$HOME/Github"
OUTPUT_DIR="./scan-results"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)

# Create output directory
mkdir -p "$OUTPUT_DIR"

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}=== Socket HW Vulnerability Scanner ===${NC}"
echo -e "${BLUE}Scanning all projects in $GITHUB_PATH${NC}"
echo -e "${BLUE}Results will be saved to $OUTPUT_DIR/${NC}\n"

# Find all directories with package.json or go.mod files
PROJECTS=$(find "$GITHUB_PATH" -maxdepth 2 \( -name "package.json" -o -name "go.mod" -o -name "Cargo.toml" \) -type f | sed 's|/[^/]*$||' | sort | uniq)

TOTAL_PROJECTS=0
SCANNED_PROJECTS=0
VULNERABLE_PROJECTS=0
TOTAL_VULNS=0

echo -e "${BLUE}Starting scans...${NC}\n"

# Scan each project
for PROJECT_DIR in $PROJECTS; do
    PROJECT_NAME=$(basename "$PROJECT_DIR")
    TOTAL_PROJECTS=$((TOTAL_PROJECTS + 1))

    echo -ne "${YELLOW}[$TOTAL_PROJECTS] Scanning $PROJECT_NAME...${NC}"

    # Run scanner and capture output
    OUTPUT=$(node "$SCANNER_PATH" "$PROJECT_DIR" --output json 2>&1)
    EXIT_CODE=$?

    if [ $EXIT_CODE -eq 0 ]; then
        # Save JSON results
        echo "$OUTPUT" > "$OUTPUT_DIR/${PROJECT_NAME}_${TIMESTAMP}.json"

        # Parse summary
        SUMMARY=$(echo "$OUTPUT" | jq -r '.summary // empty' 2>/dev/null)
        if [ -n "$SUMMARY" ]; then
            SCANNED=$(echo "$SUMMARY" | jq -r '.scanned // 0' 2>/dev/null)
            VULNERABLE=$(echo "$SUMMARY" | jq -r '.vulnerable // 0' 2>/dev/null)
            VULNS=$(echo "$SUMMARY" | jq -r '.totalVulnerabilities // 0' 2>/dev/null)

            SCANNED_PROJECTS=$((SCANNED_PROJECTS + 1))
            TOTAL_VULNS=$((TOTAL_VULNS + VULNS))

            if [ "$VULNERABLE" -gt 0 ]; then
                echo -e " ${RED}✗ Found $VULNERABLE vulnerable packages with $VULNS issues${NC}"
                VULNERABLE_PROJECTS=$((VULNERABLE_PROJECTS + 1))
            else
                echo -e " ${GREEN}✓ No vulnerabilities found in $SCANNED packages${NC}"
            fi
        else
            echo -e " ${YELLOW}⊘ No dependencies found${NC}"
        fi
    else
        echo -e " ${YELLOW}⊘ Skipped${NC}"
    fi
done

echo ""
echo -e "${BLUE}=== Summary ===${NC}"
echo -e "Total projects found: $TOTAL_PROJECTS"
echo -e "Projects scanned: $SCANNED_PROJECTS"
echo -e "Projects with vulnerabilities: ${RED}$VULNERABLE_PROJECTS${NC}"
echo -e "Total vulnerabilities found: ${RED}$TOTAL_VULNS${NC}"
echo -e "${BLUE}Results saved to: $OUTPUT_DIR/${NC}"
echo ""

if [ $TOTAL_VULNS -gt 0 ]; then
    echo -e "${RED}⚠ Vulnerabilities detected!${NC}"
    exit 1
else
    echo -e "${GREEN}✓ All scans complete!${NC}"
    exit 0
fi
