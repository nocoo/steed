import type { Command } from "commander";
import { loadConfig } from "../config/index.js";
import { Scanner, type ScanResult } from "../service/scanner/index.js";
import { StateManager } from "../service/state.js";
import { info, success, warn, table } from "../lib/output.js";

/**
 * Options for scan command
 */
interface ScanOptions {
  agents?: boolean;
  dataSources?: boolean;
  json?: boolean;
}

/**
 * Run the scan command
 */
export async function runScan(options: ScanOptions): Promise<number> {
  // Load config
  const config = await loadConfig();
  if (!config) {
    warn("No config found. Run 'steed init' first.");
    return 1;
  }

  // Run scanner
  const scanner = new Scanner();
  const result = await scanner.scan(config);

  // Update state file with scan results
  const stateManager = new StateManager();
  await stateManager.updateScanResults(result.agents, result.dataSources);

  // Filter results based on options
  const filteredResult = filterResult(result, options);

  // Output results
  if (options.json) {
    console.log(JSON.stringify(filteredResult, null, 2));
  } else {
    displayScanResult(filteredResult, options);
  }

  return 0;
}

/**
 * Filter scan result based on options
 */
function filterResult(result: ScanResult, options: ScanOptions): ScanResult {
  // If no filter specified, return all
  if (!options.agents && !options.dataSources) {
    return result;
  }

  return {
    agents: options.agents ? result.agents : [],
    dataSources: options.dataSources ? result.dataSources : [],
    scannedAt: result.scannedAt,
  };
}

/**
 * Display scan result in human-readable format
 */
function displayScanResult(result: ScanResult, options: ScanOptions): void {
  const showAgents = !options.dataSources || options.agents;
  const showDataSources = !options.agents || options.dataSources;

  // Display agents
  if (showAgents) {
    info("\nAgents:");
    if (result.agents.length === 0) {
      info("  No agents registered.");
    } else {
      const rows = result.agents.map((agent) => [
        agent.match_key,
        formatStatus(agent.status),
        agent.runtime_app,
        agent.runtime_version ?? "-",
      ]);
      table(["match_key", "status", "app", "version"], rows);
    }
  }

  // Display data sources
  if (showDataSources) {
    info("\nData Sources:");
    if (result.dataSources.length === 0) {
      info("  No data sources found.");
    } else {
      const rows = result.dataSources.map((ds) => [
        ds.name,
        ds.type,
        ds.version ?? "-",
        formatAuthStatus(ds.auth_status),
      ]);
      table(["name", "type", "version", "auth_status"], rows);
    }
  }

  success(`\nScanned at: ${result.scannedAt}`);
}

/**
 * Format status with color indicator
 */
function formatStatus(status: "running" | "stopped"): string {
  return status === "running" ? "✓ running" : "○ stopped";
}

/**
 * Format auth status
 */
function formatAuthStatus(
  status: "authenticated" | "unauthenticated" | "unknown"
): string {
  switch (status) {
    case "authenticated":
      return "✓ authenticated";
    case "unauthenticated":
      return "✗ unauthenticated";
    case "unknown":
      return "? unknown";
  }
}

/**
 * Create and configure the scan command
 */
export function createScanCommand(program: Command): void {
  program
    .command("scan")
    .description("Scan for agents and data sources")
    .option("--agents", "Scan only agents")
    .option("--data-sources", "Scan only data sources")
    .option("--json", "Output as JSON")
    .action(async (options: ScanOptions) => {
      const exitCode = await runScan(options);
      process.exitCode = exitCode;
    });
}
