import { Hono } from "hono";
import type { Env } from "../env";
import { requireRole } from "../middleware/auth";
import { jsonResponse, errors } from "../lib/response";
import type { DataSourceListItem, DataSourceStatus, DataSourceWithLanes } from "@steed/shared";

const dataSources = new Hono<{ Bindings: Env }>();

// Default and max limits for pagination
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

/**
 * GET /data-sources - List all Data Sources with filtering
 * Requires: dashboard role
 * Query params: host_id, lane_id, status, limit, cursor
 */
dataSources.get("/", requireRole("dashboard"), async (c) => {
  const hostId = c.req.query("host_id");
  const laneId = c.req.query("lane_id");
  const status = c.req.query("status");
  const limitParam = c.req.query("limit");
  const cursor = c.req.query("cursor");

  // Parse and validate limit
  let limit = DEFAULT_LIMIT;
  if (limitParam) {
    const parsed = parseInt(limitParam, 10);
    if (!isNaN(parsed) && parsed > 0) {
      limit = Math.min(parsed, MAX_LIMIT);
    }
  }

  // Build query with optional filters
  const conditions: string[] = [];
  const params: unknown[] = [];

  // For lane_id filter, we need to check data_source_lanes table
  const needsLaneJoin = !!laneId;

  if (hostId) {
    conditions.push("ds.host_id = ?");
    params.push(hostId);
  }
  if (laneId) {
    conditions.push("dsl.lane_id = ?");
    params.push(laneId);
  }
  if (status) {
    conditions.push("ds.status = ?");
    params.push(status);
  }
  if (cursor) {
    conditions.push("ds.id > ?");
    params.push(cursor);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  // Fetch limit+1 to determine if there's a next page
  params.push(limit + 1);

  // Build query - use JOIN for lane_id filter, otherwise simple select
  let sql: string;
  if (needsLaneJoin) {
    sql = `
      SELECT DISTINCT ds.id, ds.host_id, ds.type, ds.name, ds.version,
             ds.auth_status, ds.status, ds.created_at, ds.last_seen_at
      FROM data_sources ds
      INNER JOIN data_source_lanes dsl ON ds.id = dsl.data_source_id
      ${whereClause}
      ORDER BY ds.id ASC
      LIMIT ?
    `;
  } else {
    sql = `
      SELECT ds.id, ds.host_id, ds.type, ds.name, ds.version,
             ds.auth_status, ds.status, ds.created_at, ds.last_seen_at
      FROM data_sources ds
      ${whereClause}
      ORDER BY ds.id ASC
      LIMIT ?
    `;
  }

  const result = await c.env.DB.prepare(sql)
    .bind(...params)
    .all<{
      id: string;
      host_id: string;
      type: string;
      name: string;
      version: string | null;
      auth_status: string;
      status: string;
      created_at: string;
      last_seen_at: string | null;
    }>();

  const rows = result.results ?? [];
  const hasMore = rows.length > limit;
  const data = hasMore ? rows.slice(0, limit) : rows;
  const nextCursor = hasMore ? data[data.length - 1]?.id ?? null : null;

  // Map to DataSourceListItem (metadata omitted)
  const dataSourcesList: DataSourceListItem[] = data.map((row) => ({
    id: row.id,
    host_id: row.host_id,
    type: row.type as DataSourceListItem["type"],
    name: row.name,
    version: row.version,
    auth_status: row.auth_status as DataSourceListItem["auth_status"],
    status: row.status as DataSourceStatus,
    created_at: row.created_at,
    last_seen_at: row.last_seen_at,
  }));

  return jsonResponse(c, {
    data: dataSourcesList,
    next_cursor: nextCursor,
  });
});

/**
 * GET /data-sources/:id - Get single Data Source details
 * Requires: dashboard role
 */
dataSources.get("/:id", requireRole("dashboard"), async (c) => {
  const id = c.req.param("id");

  // Fetch data source
  const result = await c.env.DB.prepare(
    `SELECT id, host_id, type, name, version, auth_status, status,
            metadata, created_at, last_seen_at
     FROM data_sources WHERE id = ?`
  )
    .bind(id)
    .first<{
      id: string;
      host_id: string;
      type: string;
      name: string;
      version: string | null;
      auth_status: string;
      status: string;
      metadata: string;
      created_at: string;
      last_seen_at: string | null;
    }>();

  if (!result) {
    return errors.notFound(c, "Data Source");
  }

  // Fetch lane assignments
  const lanesResult = await c.env.DB.prepare(
    `SELECT lane_id FROM data_source_lanes WHERE data_source_id = ?`
  )
    .bind(id)
    .all<{ lane_id: string }>();

  const laneIds = (lanesResult.results ?? []).map((r) => r.lane_id);

  // Parse metadata JSON
  let metadata: Record<string, unknown> = {};
  try {
    metadata = JSON.parse(result.metadata || "{}");
  } catch {
    // Keep empty object on parse error
  }

  const dataSource: DataSourceWithLanes = {
    id: result.id,
    host_id: result.host_id,
    type: result.type as DataSourceWithLanes["type"],
    name: result.name,
    version: result.version,
    auth_status: result.auth_status as DataSourceWithLanes["auth_status"],
    status: result.status as DataSourceStatus,
    metadata,
    created_at: result.created_at,
    last_seen_at: result.last_seen_at,
    lane_ids: laneIds,
  };

  return jsonResponse(c, dataSource);
});

/**
 * PATCH /data-sources/:id - Update Data Source metadata
 * Requires: dashboard role
 * Supports: metadata (shallow merge)
 */
dataSources.patch("/:id", requireRole("dashboard"), async (c) => {
  return errors.notImplemented(c);
});

/**
 * PUT /data-sources/:id/lanes - Set Data Source Lane assignments
 * Requires: dashboard role
 * Full replacement of lane assignments
 */
dataSources.put("/:id/lanes", requireRole("dashboard"), async (c) => {
  return errors.notImplemented(c);
});

export { dataSources };
