import type {
  HostConfig,
  LocalAgentSnapshot,
  LocalDataSourceSnapshot,
} from "../../config/schema.js";
import { AgentScanner } from "./agent.js";
import { DataSourceScanner } from "./data-source.js";

/**
 * Full scan result
 */
export interface ScanResult {
  agents: LocalAgentSnapshot[];
  dataSources: LocalDataSourceSnapshot[];
  scannedAt: string;
}

/**
 * Scanner orchestrator - coordinates all scanning activities
 */
export class Scanner {
  private agentScanner: AgentScanner;
  private dataSourceScanner: DataSourceScanner;

  constructor() {
    this.agentScanner = new AgentScanner();
    this.dataSourceScanner = new DataSourceScanner();
  }

  /**
   * Run a full scan based on config
   *
   * Individual scanner failures do not block others — run agent and
   * data-source scans in parallel and collect results independently.
   * If a scanner throws, its bucket is returned as empty and the error
   * is re-thrown only if both failed (so the caller still sees a real
   * failure when the whole scan is broken).
   */
  async scan(config: HostConfig): Promise<ScanResult> {
    const [agentsResult, dataSourcesResult] = await Promise.allSettled([
      this.agentScanner.scan(config.agents),
      this.dataSourceScanner.scan(config.data_sources),
    ]);

    const agents =
      agentsResult.status === "fulfilled" ? agentsResult.value : [];
    const dataSources =
      dataSourcesResult.status === "fulfilled" ? dataSourcesResult.value : [];

    if (
      agentsResult.status === "rejected" &&
      dataSourcesResult.status === "rejected"
    ) {
      // Both scanners failed — surface the agent error (caller can see
      // this as a scan failure rather than an empty-but-successful scan).
      throw agentsResult.reason instanceof Error
        ? agentsResult.reason
        : new Error(String(agentsResult.reason));
    }

    return {
      agents,
      dataSources,
      scannedAt: new Date().toISOString(),
    };
  }
}
