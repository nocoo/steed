import type { Command } from "commander";
import { loadConfig, CONFIG_FILE } from "../config/index.js";
import { StateManager } from "../service/state.js";
import { isPidRunning } from "../lib/process.js";
import { success, error, info, warn, formatTimestamp } from "../lib/output.js";
import type { HostState } from "../config/schema.js";

/**
 * Options for status command
 */
interface StatusOptions {
  json?: boolean;
}

/**
 * Run the status command
 */
export async function runStatus(options: StatusOptions): Promise<number> {
  // Load config first to check if initialized
  const config = await loadConfig();

  // Load state
  const stateManager = new StateManager();
  const state = await stateManager.load();

  // Output as JSON if requested
  if (options.json) {
    const jsonOutput = {
      initialized: config !== null,
      state,
      configPath: CONFIG_FILE,
      workerUrl: config?.worker_url ?? null,
    };
    console.log(JSON.stringify(jsonOutput, null, 2));
    return 0;
  }

  // Check if no state (never scanned)
  const hasState =
    state.last_scan_at !== null ||
    state.last_report_at !== null ||
    state.service_pid !== null;

  if (!config) {
    warn("Not initialized. Run 'steed init' first.");
    return 0;
  }

  if (!hasState) {
    warn("No state file found. Run 'steed scan' or start the service.");
    return 0;
  }

  // Display status
  await displayStatus(state, config.worker_url);

  return 0;
}

/**
 * Display status in human-readable format
 */
async function displayStatus(state: HostState, workerUrl: string): Promise<void> {
  // Service status
  if (state.service_pid !== null) {
    const isRunning = await isPidRunning(state.service_pid);
    if (isRunning) {
      success(`Host Service: running (PID ${state.service_pid})`);
    } else {
      warn(`Host Service: not running (stale PID ${state.service_pid})`);
    }
  } else {
    info("Host Service: not running");
  }

  // Last heartbeat/report
  if (state.last_report_at) {
    info(`Last report: ${formatTimestamp(state.last_report_at)}`);
  } else {
    info("Last report: never");
  }

  // Agents summary
  if (state.last_scan?.agents) {
    const agents = state.last_scan.agents;
    const total = agents.length;
    const running = agents.filter((a) => a.status === "running").length;
    const stopped = total - running;
    info(`\nAgents: ${total} registered, ${running} running, ${stopped} stopped`);
  } else {
    info("\nAgents: no scan data");
  }

  // Data sources summary
  if (state.last_scan?.data_sources) {
    const sources = state.last_scan.data_sources;
    const total = sources.length;
    const authenticated = sources.filter(
      (s) => s.auth_status === "authenticated"
    ).length;
    info(`Data Sources: ${total} detected, ${authenticated} authenticated`);
  } else {
    info("Data Sources: no scan data");
  }

  // Last error
  if (state.last_error) {
    error(`\nLast error (${state.last_error.type}): ${state.last_error.message}`);
    info(`  at ${formatTimestamp(state.last_error.timestamp)}`);
  }

  // Config info
  info(`\nConfig: ${CONFIG_FILE}`);
  info(`Worker: ${workerUrl}`);
}

/**
 * Create and configure the status command
 */
export function createStatusCommand(program: Command): void {
  program
    .command("status")
    .description("Show current status of resources and service health")
    .option("--json", "Output as JSON")
    .action(async (options: StatusOptions) => {
      const exitCode = await runStatus(options);
      process.exitCode = exitCode;
    });
}
