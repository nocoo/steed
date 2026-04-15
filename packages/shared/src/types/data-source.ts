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
 * Data Source with lane assignments (for detail view)
 */
export interface DataSourceWithLanes extends DataSource {
  lane_ids: string[];
}

/**
 * Data Source list item — omits metadata for list responses
 * Use GET /data-sources/:id for full details including metadata
 */
export interface DataSourceListItem {
  id: string;
  host_id: string;
  type: DataSourceType;
  name: string;
  version: string | null;
  auth_status: DataSourceAuthStatus;
  status: DataSourceStatus;
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

/**
 * Request to update Data Source metadata
 */
export interface UpdateDataSourceRequest {
  metadata?: Record<string, unknown>;
}

/**
 * Request to set Data Source lane assignments
 */
export interface SetLanesRequest {
  lane_ids: string[];
}

/**
 * Response for setting Data Source lane assignments
 */
export interface SetLanesResponse {
  data_source_id: string;
  lane_ids: string[];
}

/**
 * Query parameters for listing data sources
 */
export interface ListDataSourcesQuery {
  host_id?: string;
  lane_id?: string;
  status?: DataSourceStatus;
  limit?: number;
  cursor?: string;
}

/**
 * Response for listing data sources with pagination
 */
export interface ListDataSourcesResponse {
  data: DataSourceListItem[];
  next_cursor: string | null;
}
