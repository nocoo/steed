import { readFile, writeFile, rename, unlink } from "node:fs/promises";
import { join, dirname } from "node:path";
import { randomUUID } from "node:crypto";
import {
  STATE_FILE,
  FILE_MODE,
  ensureDir,
  fileExists,
} from "../config/permissions.js";
import {
  type HostState,
  type LocalAgentSnapshot,
  type LocalDataSourceSnapshot,
  type LocalSnapshotResponse,
  type StateError,
  hostStateSchema,
} from "../config/schema.js";

/**
 * Default empty state
 */
function createEmptyState(): HostState {
  return {
    last_scan_at: null,
    last_report_at: null,
    last_scan: null,
    last_report_response: null,
    service_pid: null,
    last_error: null,
  };
}

/**
 * State manager for Host Service state
 */
export class StateManager {
  private statePath: string;

  constructor(statePath?: string) {
    this.statePath = statePath ?? STATE_FILE;
  }

  /**
   * Get the state file path
   */
  getPath(): string {
    return this.statePath;
  }

  /**
   * Check if state file exists
   */
  async exists(): Promise<boolean> {
    return fileExists(this.statePath);
  }

  /**
   * Load state from file
   * Returns empty state if file doesn't exist
   */
  async load(): Promise<HostState> {
    if (!(await this.exists())) {
      return createEmptyState();
    }

    const content = await readFile(this.statePath, "utf-8");

    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      // Invalid JSON - return empty state
      return createEmptyState();
    }

    // Validate
    const result = hostStateSchema.safeParse(parsed);
    if (!result.success) {
      // Invalid schema - return empty state
      return createEmptyState();
    }

    return result.data;
  }

  /**
   * Save state to file
   */
  async save(state: HostState): Promise<void> {
    // Ensure directory exists
    const dir = dirname(this.statePath);
    await ensureDir(dir);

    // Write atomically
    const tempPath = join(dir, `.state-${randomUUID()}.tmp`);
    const content = JSON.stringify(state, null, 2) + "\n";

    try {
      await writeFile(tempPath, content, { mode: FILE_MODE });
      await rename(tempPath, this.statePath);
    } catch (err) {
      try {
        await unlink(tempPath);
      } catch {
        // Ignore cleanup errors
      }
      throw err;
    }
  }

  /**
   * Update scan results in state
   */
  async updateScanResults(
    agents: LocalAgentSnapshot[],
    dataSources: LocalDataSourceSnapshot[]
  ): Promise<void> {
    const state = await this.load();
    state.last_scan_at = new Date().toISOString();
    state.last_scan = {
      agents,
      data_sources: dataSources,
    };
    await this.save(state);
  }

  /**
   * Update report results in state
   */
  async updateReportResults(response: LocalSnapshotResponse): Promise<void> {
    const state = await this.load();
    state.last_report_at = new Date().toISOString();
    state.last_report_response = response;
    await this.save(state);
  }

  /**
   * Update service PID
   */
  async updateServicePid(pid: number | null): Promise<void> {
    const state = await this.load();
    state.service_pid = pid;
    await this.save(state);
  }

  /**
   * Update last error
   */
  async updateError(error: StateError | null): Promise<void> {
    const state = await this.load();
    state.last_error = error;
    await this.save(state);
  }

  /**
   * Record an error
   */
  async recordError(
    message: string,
    type: StateError["type"]
  ): Promise<void> {
    await this.updateError({
      timestamp: new Date().toISOString(),
      message,
      type,
    });
  }

  /**
   * Clear error
   */
  async clearError(): Promise<void> {
    await this.updateError(null);
  }
}
