import type { AgentSnapshot } from "./agent";
import type { DataSourceSnapshot } from "./data-source";

/**
 * Snapshot payload from Host Service heartbeat
 */
export interface SnapshotRequest {
  agents: AgentSnapshot[];
  data_sources: DataSourceSnapshot[];
}

/**
 * Snapshot processing result
 */
export interface SnapshotResponse {
  host_id: string;
  agents_updated: number;
  agents_missing: number;
  data_sources_updated: number;
  data_sources_created: number;
  data_sources_missing: number;
}
