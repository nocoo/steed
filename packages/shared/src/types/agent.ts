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
 * Agent list item — omits metadata/extra for list responses
 * Use GET /agents/:id for full details including metadata/extra
 */
export interface AgentListItem {
  id: string;
  host_id: string;
  match_key: string;
  nickname: string | null;
  role: string | null;
  lane_id: LaneId | null;
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

/**
 * Request to create a new Agent
 */
export interface CreateAgentRequest {
  host_id?: string; // Required for dashboard role, ignored for host role
  match_key: string;
  nickname?: string;
  role?: string;
}

/**
 * Request to update Agent metadata
 */
export interface UpdateAgentRequest {
  nickname?: string | null;
  role?: string | null;
  lane_id?: string | null;
  metadata?: Record<string, unknown>;
}

/**
 * Query parameters for listing agents
 */
export interface ListAgentsQuery {
  host_id?: string;
  lane_id?: string;
  status?: AgentStatus;
  limit?: number;
  cursor?: string;
}

/**
 * Response for listing agents with pagination
 */
export interface ListAgentsResponse {
  data: AgentListItem[];
  next_cursor: string | null;
}
