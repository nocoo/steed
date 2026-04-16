import type { Command } from "commander";
import { loadConfig } from "../config/index.js";
import { Scanner } from "../service/scanner/index.js";
import { Reporter } from "../service/reporter.js";
import { StateManager } from "../service/state.js";
import { success, error, warn, info, spinner } from "../lib/output.js";

/**
 * Options for report command
 */
interface ReportOptions {
  dryRun?: boolean;
}

/**
 * Run the report command
 */
export async function runReport(options: ReportOptions): Promise<number> {
  // Load config
  const config = await loadConfig();
  if (!config) {
    warn("No config found. Run 'steed init' first.");
    return 1;
  }

  const spin = spinner("Scanning...").start();

  // Run scan
  const scanner = new Scanner();
  const scanResult = await scanner.scan(config);

  spin.text = "Scan complete";
  spin.succeed();

  // Display scan summary
  info(
    `Found ${scanResult.agents.length} agents, ${scanResult.dataSources.length} data sources`
  );

  // Dry run - just show what would be sent (no side effects)
  if (options.dryRun) {
    info("\nDry run - payload that would be sent:");
    console.log(
      JSON.stringify(
        {
          agents: scanResult.agents,
          data_sources: scanResult.dataSources,
        },
        null,
        2
      )
    );
    return 0;
  }

  // Send report
  const stateManager = new StateManager();
  await stateManager.updateScanResults(scanResult.agents, scanResult.dataSources);

  const reportSpin = spinner(
    `Reporting to ${config.worker_url}/api/v1/snapshot...`
  ).start();

  const reporter = new Reporter(config.worker_url, config.api_key);
  const result = await reporter.report(scanResult.agents, scanResult.dataSources);

  if (!result.success) {
    reportSpin.fail();

    // Record error in state
    await stateManager.recordError(
      result.error?.message ?? "Unknown error",
      "report"
    );

    if (result.error?.type === "auth") {
      error("Authentication failed. Check your API key.");
    } else if (result.error?.type === "network") {
      error(`Network error: ${result.error.message}`);
    } else {
      error(`API error: ${result.error?.message}`);
    }

    return 1;
  }

  reportSpin.succeed();

  // Update state with report results
  if (result.response) {
    await stateManager.updateReportResults(result.response);
  }
  await stateManager.clearError();

  // Display results
  success("Report sent successfully");
  const res = result.response;
  if (res) {
    info(`  - Agents updated: ${res.agents_updated}`);
    info(`  - Agents missing: ${res.agents_missing}`);
    info(`  - Data sources updated: ${res.data_sources_updated}`);
    info(`  - Data sources created: ${res.data_sources_created}`);
    info(`  - Data sources missing: ${res.data_sources_missing}`);
  }

  return 0;
}

/**
 * Create and configure the report command
 */
export function createReportCommand(program: Command): void {
  program
    .command("report")
    .description("Send a snapshot report to the Worker")
    .option("--dry-run", "Show what would be reported without sending")
    .action(async (options: ReportOptions) => {
      const exitCode = await runReport(options);
      process.exitCode = exitCode;
    });
}
