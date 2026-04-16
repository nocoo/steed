import type { RegisteredAgent, LocalAgentSnapshot } from "../../config/schema.js";
import { isProcessRunning, runCommand } from "../../lib/process.js";
import { getVersion } from "../../lib/version.js";
import { expandPath } from "../../lib/path.js";
import { fileExists } from "../../config/permissions.js";

/**
 * Agent scanner - detects registered agents
 */
export class AgentScanner {
  /**
   * Scan all registered agents
   */
  async scan(agents: RegisteredAgent[]): Promise<LocalAgentSnapshot[]> {
    const results: LocalAgentSnapshot[] = [];

    for (const agent of agents) {
      const snapshot = await this.scanOne(agent);
      if (snapshot) {
        results.push(snapshot);
      }
    }

    return results;
  }

  /**
   * Scan a single agent
   * Returns null if agent should not be included in snapshot
   */
  async scanOne(agent: RegisteredAgent): Promise<LocalAgentSnapshot | null> {
    const { match_key, detection } = agent;

    // Extract runtime_app from match_key
    const runtime_app = this.extractRuntimeApp(match_key);
    if (!runtime_app) {
      return null;
    }

    // Detect status based on method
    let status: "running" | "stopped" | null;
    try {
      status = await this.detectStatus(detection);
    } catch {
      // Detection failed, don't include in snapshot
      return null;
    }

    if (status === null) {
      // Agent not detected, Worker will mark as missing
      return null;
    }

    // Get version if configured
    let runtime_version: string | null = null;
    if (detection.version_command) {
      runtime_version = await getVersion(detection.version_command);
    }

    return {
      match_key,
      runtime_app,
      runtime_version,
      status,
    };
  }

  /**
   * Extract runtime_app from match_key
   */
  private extractRuntimeApp(matchKey: string): string | null {
    const colonIndex = matchKey.indexOf(":");
    if (colonIndex === -1) {
      return null;
    }
    const app = matchKey.slice(0, colonIndex);
    return app || null;
  }

  /**
   * Detect agent status based on detection method
   */
  private async detectStatus(
    detection: RegisteredAgent["detection"]
  ): Promise<"running" | "stopped" | null> {
    const { method, pattern } = detection;

    switch (method) {
      case "process":
        return this.detectByProcess(pattern);
      case "config_file":
        return this.detectByConfigFile(pattern);
      case "custom":
        return this.detectByCustom(pattern);
    }
  }

  /**
   * Detect by process pattern
   * Running if process found, stopped if not
   */
  private async detectByProcess(
    pattern: string
  ): Promise<"running" | "stopped"> {
    const running = await isProcessRunning(pattern);
    return running ? "running" : "stopped";
  }

  /**
   * Detect by config file existence
   * Stopped if file exists (installed but can't tell if running)
   * Null if file doesn't exist (not installed)
   */
  private async detectByConfigFile(
    path: string
  ): Promise<"stopped" | null> {
    const expandedPath = expandPath(path);
    const exists = await fileExists(expandedPath);
    return exists ? "stopped" : null;
  }

  /**
   * Detect by custom command
   * Exit 0 = running, Exit 1 = stopped, Exit 2+ = null (not included)
   */
  private async detectByCustom(
    command: string
  ): Promise<"running" | "stopped" | null> {
    const { exitCode } = await runCommand(command);

    if (exitCode === 0) {
      return "running";
    }
    if (exitCode === 1) {
      return "stopped";
    }
    return null;
  }
}
