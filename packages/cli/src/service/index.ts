/**
 * Host Service entry point
 *
 * The Host Service is a resident process that periodically scans
 * local agents and data sources, then reports snapshots to the Worker API.
 */

import { dirname, join } from "node:path";
import type { HostConfig } from "../config/schema.js";
import { ConfigManager } from "../config/index.js";
import { StateManager } from "./state.js";
import { Scanner } from "./scanner/index.js";
import { Reporter } from "./reporter.js";
import { Scheduler } from "./scheduler.js";

/**
 * Host Service options
 */
export interface HostServiceOptions {
  /** Path to config file (default: ~/.steed/config.json) */
  configPath?: string;
  /**
   * Path to state file. If not provided, derived from configPath
   * (state.json alongside config.json) or defaults to ~/.steed/state.json.
   */
  statePath?: string;
  /** Heartbeat interval in milliseconds (default: 10 minutes) */
  intervalMs?: number;
}

/**
 * Host Service class
 *
 * Manages the lifecycle of the heartbeat service:
 * - Loads configuration
 * - Starts periodic scanning and reporting
 * - Handles graceful shutdown
 */
export class HostService {
  private readonly configManager: ConfigManager;
  private readonly stateManager: StateManager;
  private readonly intervalMs: number;
  private scheduler: Scheduler | null = null;
  private config: HostConfig | null = null;
  private stopping = false;

  constructor(options: HostServiceOptions = {}) {
    this.configManager = new ConfigManager(options.configPath);
    // Derive state path: explicit > alongside configPath > default
    const statePath =
      options.statePath ??
      (options.configPath
        ? join(dirname(options.configPath), "state.json")
        : undefined);
    this.stateManager = new StateManager(statePath);
    this.intervalMs = options.intervalMs ?? 600_000; // Default 10 minutes
  }

  /**
   * Start the Host Service
   *
   * 1. Loads configuration
   * 2. Writes PID to state file
   * 3. Runs first heartbeat immediately
   * 4. Starts scheduler for periodic heartbeats
   */
  async start(): Promise<void> {
    // Load configuration
    this.config = await this.configManager.load();
    if (!this.config) {
      throw new Error("No configuration found. Run 'steed init' first.");
    }

    // Write PID to state
    await this.stateManager.updateServicePid(process.pid);

    // Create scheduler
    this.scheduler = new Scheduler(this.intervalMs);

    // Run first heartbeat immediately
    await this.runHeartbeat();

    // Start scheduler for periodic heartbeats
    this.scheduler.start(() => this.runHeartbeat());
  }

  /**
   * Stop the Host Service
   *
   * 1. Stops the scheduler
   * 2. Waits for in-flight heartbeat to complete
   * 3. Clears PID from state
   */
  async stop(): Promise<void> {
    if (this.stopping) {
      return;
    }
    this.stopping = true;

    // Stop scheduler
    if (this.scheduler) {
      this.scheduler.stop();

      // Wait for in-flight heartbeat to complete (with timeout)
      const maxWait = 30_000; // 30 seconds
      const startTime = Date.now();
      while (this.scheduler.isInFlight() && Date.now() - startTime < maxWait) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }

      this.scheduler = null;
    }

    // Clear PID from state
    await this.stateManager.updateServicePid(null);

    this.stopping = false;
  }

  /**
   * Check if the service is running
   */
  isRunning(): boolean {
    return this.scheduler?.isRunning() ?? false;
  }

  /**
   * Run a single heartbeat cycle
   *
   * 1. Scan agents and data sources
   * 2. Report snapshot to Worker
   * 3. Update state file
   */
  async runHeartbeat(): Promise<void> {
    if (!this.config) {
      await this.stateManager.recordError("No configuration loaded", "config");
      return;
    }

    try {
      // Scan
      const scanner = new Scanner();
      const scanResult = await scanner.scan(this.config);

      // Update state with scan results
      await this.stateManager.updateScanResults(
        scanResult.agents,
        scanResult.dataSources
      );

      // Report to Worker
      const reporter = new Reporter(this.config.worker_url, this.config.api_key);
      const result = await reporter.report(scanResult.agents, scanResult.dataSources);

      // Update state with report response
      if (result.success && result.response) {
        await this.stateManager.updateReportResults(result.response);
        await this.stateManager.clearError();
      } else if (result.error) {
        await this.stateManager.recordError(result.error.message, "report");
      }
    } catch (error) {
      // Update state with error
      const message = error instanceof Error ? error.message : String(error);
      const type = this.classifyError(error);
      await this.stateManager.recordError(message, type);
    }
  }

  /**
   * Classify error type for state reporting
   */
  private classifyError(error: unknown): "scan" | "report" | "config" {
    if (error instanceof Error) {
      const msg = error.message.toLowerCase();
      if (msg.includes("config") || msg.includes("configuration")) {
        return "config";
      }
      if (
        msg.includes("network") ||
        msg.includes("fetch") ||
        msg.includes("http") ||
        msg.includes("api")
      ) {
        return "report";
      }
    }
    return "scan";
  }
}

/**
 * Create signal handlers for graceful shutdown
 */
export function setupSignalHandlers(service: HostService): void {
  const handleSignal = (_signal: string) => {
    void (async () => {
      await service.stop();
      process.exit(0);
    })();
  };

  process.on("SIGTERM", () => handleSignal("SIGTERM"));
  process.on("SIGINT", () => handleSignal("SIGINT"));
}
