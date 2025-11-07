import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import chalk from "chalk";
import ora from "ora";
import { logger } from "./utils/logger.js";
import { formatConsoleOutput } from "./output/console.js";
import { formatJsonOutput } from "./output/json.js";
import { scanPath } from "./core/scan.js";
import { getSupportedFilenames } from "./providers/index.js";

// Re-export for programmatic usage
export { scanPath } from "./core/scan.js";
export { getSupportedFilenames } from "./providers/index.js";
export type { ScanResult, ScanOptions } from "./core/scan.js";

export function createCli(argv?: string[]) {
  const y = yargs(argv ?? hideBin(process.argv))
    .scriptName("scanner")
    .version("0.0.1")
    .command(
      "$0 [dir]",
      "Scan dependencies for vulnerabilities",
      (y) =>
        y
          .positional("dir", {
            type: "string",
            default: ".",
            describe: "Directory containing project manifest",
          })
          .option("dev", {
            type: "boolean",
            default: false,
            describe: "Include devDependencies in scan",
          })
          .option("validate-lock", {
            type: "boolean",
            default: false,
            describe: "Force lockfile validation",
          })
          .option("refresh-lock", {
            type: "boolean",
            default: false,
            describe: "Force lockfile refresh/rewrite",
          })
          .option("concurrency", {
            type: "number",
            default: 10,
            describe: "Max concurrent OSV queries",
          })
          .option("output", {
            type: "string",
            choices: ["console", "json"],
            default: "console",
            describe: "Output format (console or json)",
          })
          .option("ignore-file", {
            type: "string",
            describe: "Path to ignore configuration file (.vuln-ignore.json)",
          })
          .option("check-maintenance", {
            type: "boolean",
            default: false,
            describe: "Check for unmaintained packages (no releases in 12+ months)",
          }),
      async (args) => {
        const inputPath = String(args.dir);
        const startTime = Date.now();
        const spinner = ora("Detecting ecosystem...").start();

        try {
          const result = await scanPath(inputPath, {
            includeDev: args.dev,
            validateLock: args.validateLock,
            refreshLock: args.refreshLock,
            concurrency: args.concurrency,
            ignoreFile: args.ignoreFile,
            checkMaintenance: args.checkMaintenance,
          });

          spinner.text = `Using ${result.detection.name}${result.detection.variant ? ` (${result.detection.variant})` : ""}`;

          spinner.start("Reading dependencies...");
          spinner.text = `Found ${result.deps.length} package${result.deps.length !== 1 ? "s" : ""}`;

          if (result.deps.length === 0) {
            spinner.info("No dependencies to scan");
            if (args.output === "json") {
              console.log(JSON.stringify({
                summary: {
                  scanned: 0,
                  vulnerable: 0,
                  totalVulnerabilities: 0,
                  scanDuration: `${Date.now() - startTime}ms`,
                  timestamp: new Date().toISOString(),
                },
                packages: [],
              }, null, 2));
            }
            return;
          }

          const vulnsByPkg = result.advisoriesByPackage;
          const scanDuration = result.scanDurationMs;

          spinner.stop();

          // Format output based on requested format
          if (args.output === "json") {
            const jsonOutput = formatJsonOutput(result.deps, vulnsByPkg, scanDuration);
            console.log(JSON.stringify(jsonOutput, null, 2));
          } else {
            formatConsoleOutput(result.deps, vulnsByPkg, scanDuration, result.maintenanceInfo);
          }
        } catch (err: any) {
          spinner.fail("Scan failed");
          logger.error({ err }, 'Scan failed');
          throw err;
        }
      }
    )
    .help()
    .strict();

  return y;
}

// Export UnifiedAdvisory for use in output modules
export interface UnifiedAdvisory {
  id: string;
  source: 'osv' | 'ghsa';
  severity: string;
  summary?: string;
  details?: string;
  references?: string[];
  firstPatchedVersion?: string;
  cveIds?: string[];
}

function severityToColor(sev: string): (s: string) => string {
  if (sev === "CRITICAL" || sev === "HIGH") return chalk.red;
  if (sev === "MEDIUM" || sev === "MODERATE") return chalk.yellow;
  if (sev === "LOW") return chalk.green;
  return chalk.dim;
}

async function main() {
  const argv = await createCli().parseAsync();
  return argv;
}

main().catch((err) => {
  logger.error({ err }, 'CLI error');
  console.error("Error:", err?.message ?? err);
  process.exit(1);
});
