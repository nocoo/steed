import { Hono } from "hono";
import { generateId } from "@steed/shared";
import type { Env } from "../env";
import { requireRole } from "../middleware/auth";
import { jsonResponse, errors } from "../lib/response";
import type { Agent, AgentStatus, CreateAgentRequest } from "@steed/shared";
import type { LaneId } from "@steed/shared";

const agents = new Hono<{ Bindings: Env }>();

/**
 * POST /agents - Register a new Agent
 * Requires: dashboard or host role
 * - host role: uses auth.hostId, ignores body.host_id
 * - dashboard role: uses body.host_id (required)
 */
agents.post("/", requireRole("dashboard", "host"), async (c) => {
  const auth = c.get("auth");
  const body = await c.req.json<CreateAgentRequest>().catch(() => null);

  if (!body) {
    return errors.invalidRequest(c, "Invalid JSON body");
  }

  // Validate match_key
  if (typeof body.match_key !== "string" || body.match_key.length === 0) {
    return errors.invalidRequest(c, "match_key is required");
  }

  // Determine host_id based on role
  let hostId: string;
  if (auth.role === "host" && auth.hostId) {
    // Host role: use authenticated host's ID
    hostId = auth.hostId;
  } else if (auth.role === "host") {
    // Host role but no hostId (shouldn't happen with valid auth)
    return errors.internalError(c);
  } else {
    // Dashboard role: require host_id in body
    if (typeof body.host_id !== "string" || body.host_id.length === 0) {
      return errors.invalidRequest(c, "host_id is required for dashboard role");
    }
    hostId = body.host_id;

    // Verify host exists
    const host = await c.env.DB.prepare("SELECT id FROM hosts WHERE id = ?")
      .bind(hostId)
      .first<{ id: string }>();
    if (!host) {
      return errors.notFound(c, "Host");
    }
  }

  const id = generateId("agent");
  const now = new Date().toISOString();

  try {
    await c.env.DB.prepare(
      `INSERT INTO agents (id, host_id, match_key, nickname, role, status, metadata, extra, created_at)
       VALUES (?, ?, ?, ?, ?, 'stopped', '{}', '{}', ?)`
    )
      .bind(
        id,
        hostId,
        body.match_key,
        body.nickname ?? null,
        body.role ?? null,
        now
      )
      .run();

    const agent: Agent = {
      id,
      host_id: hostId,
      match_key: body.match_key,
      nickname: body.nickname ?? null,
      role: body.role ?? null,
      lane_id: null,
      metadata: {},
      extra: {},
      runtime_app: null,
      runtime_version: null,
      status: "stopped",
      created_at: now,
      last_seen_at: null,
    };

    return jsonResponse(c, agent, 201);
  } catch (error) {
    // Handle unique constraint violation
    if (error instanceof Error && error.message.includes("UNIQUE")) {
      return errors.conflict(c, "Agent with this match_key already exists on this host");
    }
    return errors.internalError(c);
  }
});

// Default and max limits for pagination
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

/**
 * GET /agents - List all Agents with filtering
 * Requires: dashboard role
 * Query params: host_id, lane_id, status, limit, cursor
 */
agents.get("/", requireRole("dashboard"), async (c) => {
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

  if (hostId) {
    conditions.push("host_id = ?");
    params.push(hostId);
  }
  if (laneId) {
    conditions.push("lane_id = ?");
    params.push(laneId);
  }
  if (status) {
    conditions.push("status = ?");
    params.push(status);
  }
  if (cursor) {
    // Cursor is the last seen id (assumes id-based pagination)
    conditions.push("id > ?");
    params.push(cursor);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  // Fetch limit+1 to determine if there's a next page
  params.push(limit + 1);

  const result = await c.env.DB.prepare(
    `SELECT id, host_id, match_key, nickname, role, lane_id,
            runtime_app, runtime_version, status, created_at, last_seen_at
     FROM agents ${whereClause}
     ORDER BY id ASC
     LIMIT ?`
  )
    .bind(...params)
    .all<{
      id: string;
      host_id: string;
      match_key: string;
      nickname: string | null;
      role: string | null;
      lane_id: string | null;
      runtime_app: string | null;
      runtime_version: string | null;
      status: string;
      created_at: string;
      last_seen_at: string | null;
    }>();

  const rows = result.results ?? [];
  const hasMore = rows.length > limit;
  const data = hasMore ? rows.slice(0, limit) : rows;
  const nextCursor = hasMore ? data[data.length - 1]?.id ?? null : null;

  // Map to Agent type (without metadata/extra for list view)
  const agentsData: Agent[] = data.map((row) => ({
    id: row.id,
    host_id: row.host_id,
    match_key: row.match_key,
    nickname: row.nickname,
    role: row.role,
    lane_id: row.lane_id as LaneId | null,
    metadata: {}, // Not included in list view
    extra: {}, // Not included in list view
    runtime_app: row.runtime_app,
    runtime_version: row.runtime_version,
    status: row.status as AgentStatus,
    created_at: row.created_at,
    last_seen_at: row.last_seen_at,
  }));

  return jsonResponse(c, {
    data: agentsData,
    next_cursor: nextCursor,
  });
});

/**
 * GET /agents/:id - Get single Agent details
 * Requires: dashboard role
 */
agents.get("/:id", requireRole("dashboard"), async (c) => {
  const id = c.req.param("id");

  const result = await c.env.DB.prepare(
    `SELECT id, host_id, match_key, nickname, role, lane_id,
            metadata, extra, runtime_app, runtime_version, status,
            created_at, last_seen_at
     FROM agents WHERE id = ?`
  )
    .bind(id)
    .first<{
      id: string;
      host_id: string;
      match_key: string;
      nickname: string | null;
      role: string | null;
      lane_id: string | null;
      metadata: string;
      extra: string;
      runtime_app: string | null;
      runtime_version: string | null;
      status: string;
      created_at: string;
      last_seen_at: string | null;
    }>();

  if (!result) {
    return errors.notFound(c, "Agent");
  }

  // Parse JSON fields
  let metadata: Record<string, unknown> = {};
  let extra: Record<string, unknown> = {};
  try {
    metadata = JSON.parse(result.metadata || "{}");
    extra = JSON.parse(result.extra || "{}");
  } catch {
    // Keep empty objects on parse error
  }

  const agent: Agent = {
    id: result.id,
    host_id: result.host_id,
    match_key: result.match_key,
    nickname: result.nickname,
    role: result.role,
    lane_id: result.lane_id as LaneId | null,
    metadata,
    extra,
    runtime_app: result.runtime_app,
    runtime_version: result.runtime_version,
    status: result.status as AgentStatus,
    created_at: result.created_at,
    last_seen_at: result.last_seen_at,
  };

  return jsonResponse(c, agent);
});

/**
 * PATCH /agents/:id - Update Agent metadata
 * Requires: dashboard role
 */
agents.patch("/:id", requireRole("dashboard"), async (c) => {
  return jsonResponse(c, { error: "Not implemented" }, 501);
});

export { agents };
