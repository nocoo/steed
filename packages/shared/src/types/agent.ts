import type { LaneId } from "./lane";

/**
 * Agent status
 * - running: currently active
 * - stopped: not running but registered
 * - missing: not found in latest snapshot
 */
export type AgentStatus = "running" | "stopped" | "missing";

/**
 * Agent — a managed autonomous agent entity on a host
 */
export interface Agent {
  id: string;
  host_id: string;
  match_key: string;
  nickname: string | null;
  role: string | null;
  lane_id: LaneId | null;
  metadata: Record<string, unknown>;
  extra: Record<string, unknown>;
  runtime_app: string | null;
  runtime_version: string | null;
  status: AgentStatus;
  created_at: string;
  last_seen_at: string | null;
}

/**
 * Agent snapshot data from Host Service scan
 */
export interface AgentSnapshot {
  match_key: string;
  runtime_app: string;
  runtime_version: string;
  status: "running" | "stopped";
}
