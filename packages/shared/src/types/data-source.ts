/**
 * Data Source type
 */
export type DataSourceType = "personal_cli" | "third_party_cli" | "mcp";

/**
 * Data Source auth status
 */
export type DataSourceAuthStatus = "authenticated" | "unauthenticated" | "unknown";

/**
 * Data Source status
 * - active: found in latest snapshot
 * - missing: not found in latest snapshot
 */
export type DataSourceStatus = "active" | "missing";

/**
 * Data Source — a discoverable external resource on a host
 */
export interface DataSource {
  id: string;
  host_id: string;
  type: DataSourceType;
  name: string;
  version: string | null;
  auth_status: DataSourceAuthStatus;
  status: DataSourceStatus;
  metadata: Record<string, unknown>;
  created_at: string;
  last_seen_at: string | null;
}

/**
 * Data Source snapshot data from Host Service scan
 */
export interface DataSourceSnapshot {
  type: DataSourceType;
  name: string;
  version: string;
  auth_status: DataSourceAuthStatus;
}
