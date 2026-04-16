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
   */
  async scan(config: HostConfig): Promise<ScanResult> {
    // Run agent scan
    const agents = await this.agentScanner.scan(config.agents);

    // Run data source scan
    const dataSources = await this.dataSourceScanner.scan(config.data_sources);

    return {
      agents,
      dataSources,
      scannedAt: new Date().toISOString(),
    };
  }
}
