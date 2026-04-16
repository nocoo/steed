import { z } from "zod";

// ============== Agent Detection ==============

/**
 * Agent detection method
 */
export type AgentDetectionMethod = "process" | "config_file" | "custom";

/**
 * Agent detection configuration
 */
export interface AgentDetection {
  /** Detection method */
  method: AgentDetectionMethod;
  /**
   * Detection pattern:
   * - process: process name pattern for pgrep
   * - config_file: path to config file
   * - custom: command to run (exit 0 = running, exit 1 = stopped)
   */
  pattern: string;
  /** Optional command to get version */
  version_command?: string;
}

/**
 * Registered agent configuration
 */
export interface RegisteredAgent {
  /** Stable identifier for matching (e.g., "openclaw:/home/agent/workspace") */
  match_key: string;
  /** How to detect this agent */
  detection: AgentDetection;
}

// ============== Data Source Scanning ==============

/**
 * Auth check method
 */
export type AuthCheckMethod = "config_exists" | "config_field" | "command";

/**
 * Auth check configuration
 */
export interface AuthCheck {
  /** Detection method */
  method: AuthCheckMethod;
  /**
   * Pattern:
   * - config_field: JSON path to check
   * - command: command to run (exit 0 = authenticated)
   */
  pattern?: string;
}

/**
 * CLI scanner type
 */
export type CliScannerType = "personal_cli" | "third_party_cli";

/**
 * CLI scanner configuration
 */
export interface CliScannerConfig {
  /** CLI name (e.g., "nmem", "wrangler") */
  name: string;
  /** Type: personal_cli or third_party_cli */
  type: CliScannerType;
  /** Binary name to check in PATH */
  binary: string;
  /** Optional: config file path to check for auth status */
  config_path?: string;
  /** Optional: command to get version (default: "{binary} --version") */
  version_command?: string;
  /** Optional: how to determine auth status */
  auth_check?: AuthCheck;
}

/**
 * MCP scanner configuration
 */
export interface McpScannerConfig {
  /** MCP service name */
  name: string;
  /** Health check endpoint */
  endpoint: string;
}

/**
 * Data source scanning configuration
 */
export interface DataSourceConfig {
  /** Known CLI tools to scan */
  cli_scanners: CliScannerConfig[];
  /** MCP services to check (future) */
  mcp_scanners: McpScannerConfig[];
}

// ============== Host Config ==============

/**
 * Host configuration (stored in ~/.steed/config.json)
 */
export interface HostConfig {
  /** Worker API endpoint */
  worker_url: string;
  /** Host API Key (obtained from Dashboard registration) */
  api_key: string;
  /** Registered agents for matching */
  agents: RegisteredAgent[];
  /** Data source scan settings */
  data_sources: DataSourceConfig;
}

// ============== Host State ==============

/**
 * Agent snapshot data
 */
export interface LocalAgentSnapshot {
  match_key: string;
  runtime_app: string;
  runtime_version: string | null;
  status: "running" | "stopped";
}

/**
 * Data source snapshot data
 */
export interface LocalDataSourceSnapshot {
  type: CliScannerType;
  name: string;
  version: string | null;
  auth_status: "authenticated" | "unauthenticated" | "unknown";
}

/**
 * Snapshot response from Worker
 */
export interface LocalSnapshotResponse {
  host_id: string;
  agents_updated: number;
  agents_missing: number;
  data_sources_updated: number;
  data_sources_created: number;
  data_sources_missing: number;
}

/**
 * Error type in state
 */
export type StateErrorType = "scan" | "report" | "config";

/**
 * Error record in state
 */
export interface StateError {
  timestamp: string;
  message: string;
  type: StateErrorType;
}

/**
 * Host state (stored in ~/.steed/state.json)
 */
export interface HostState {
  /** Last successful scan timestamp (ISO 8601) */
  last_scan_at: string | null;
  /** Last successful report timestamp (ISO 8601) */
  last_report_at: string | null;
  /** Last scan results */
  last_scan: {
    agents: LocalAgentSnapshot[];
    data_sources: LocalDataSourceSnapshot[];
  } | null;
  /** Last report response from Worker */
  last_report_response: LocalSnapshotResponse | null;
  /** Service PID (written on startup, cleared on shutdown) */
  service_pid: number | null;
  /** Last error (if any) */
  last_error: StateError | null;
}

// ============== Zod Schemas ==============

export const agentDetectionSchema = z.object({
  method: z.enum(["process", "config_file", "custom"]),
  pattern: z.string().min(1),
  version_command: z.string().optional(),
});

export const registeredAgentSchema = z.object({
  match_key: z.string().min(1),
  detection: agentDetectionSchema,
});

export const authCheckSchema = z.object({
  method: z.enum(["config_exists", "config_field", "command"]),
  pattern: z.string().optional(),
});

export const cliScannerConfigSchema = z.object({
  name: z.string().min(1),
  type: z.enum(["personal_cli", "third_party_cli"]),
  binary: z.string().min(1),
  config_path: z.string().optional(),
  version_command: z.string().optional(),
  auth_check: authCheckSchema.optional(),
});

export const mcpScannerConfigSchema = z.object({
  name: z.string().min(1),
  endpoint: z.string().url(),
});

export const dataSourceConfigSchema = z.object({
  cli_scanners: z.array(cliScannerConfigSchema),
  mcp_scanners: z.array(mcpScannerConfigSchema),
});

export const hostConfigSchema = z.object({
  worker_url: z.string().url(),
  api_key: z.string().startsWith("sk_host_"),
  agents: z.array(registeredAgentSchema),
  data_sources: dataSourceConfigSchema,
});

export const localAgentSnapshotSchema = z.object({
  match_key: z.string(),
  runtime_app: z.string(),
  runtime_version: z.string().nullable(),
  status: z.enum(["running", "stopped"]),
});

export const localDataSourceSnapshotSchema = z.object({
  type: z.enum(["personal_cli", "third_party_cli"]),
  name: z.string(),
  version: z.string().nullable(),
  auth_status: z.enum(["authenticated", "unauthenticated", "unknown"]),
});

export const localSnapshotResponseSchema = z.object({
  host_id: z.string(),
  agents_updated: z.number(),
  agents_missing: z.number(),
  data_sources_updated: z.number(),
  data_sources_created: z.number(),
  data_sources_missing: z.number(),
});

export const stateErrorSchema = z.object({
  timestamp: z.string(),
  message: z.string(),
  type: z.enum(["scan", "report", "config"]),
});

export const hostStateSchema = z.object({
  last_scan_at: z.string().nullable(),
  last_report_at: z.string().nullable(),
  last_scan: z
    .object({
      agents: z.array(localAgentSnapshotSchema),
      data_sources: z.array(localDataSourceSnapshotSchema),
    })
    .nullable(),
  last_report_response: localSnapshotResponseSchema.nullable(),
  service_pid: z.number().nullable(),
  last_error: stateErrorSchema.nullable(),
});

/**
 * Create an empty host state
 */
export function createEmptyState(): HostState {
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
 * Create an empty data source config
 */
export function createEmptyDataSourceConfig(): DataSourceConfig {
  return {
    cli_scanners: [],
    mcp_scanners: [],
  };
}
