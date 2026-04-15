import { Hono } from "hono";
import type { Env } from "../env";
import { requireRole } from "../middleware/auth";
import { jsonResponse, errors } from "../lib/response";
import type { Binding } from "@steed/shared";

const bindings = new Hono<{ Bindings: Env }>();

// Default and max limits for pagination
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

/**
 * GET /bindings - List all bindings with filtering
 * Requires: dashboard role
 * Query params: agent_id, data_source_id, limit, cursor
 */
bindings.get("/", requireRole("dashboard"), async (c) => {
  const agentId = c.req.query("agent_id");
  const dataSourceId = c.req.query("data_source_id");
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

  if (agentId) {
    conditions.push("agent_id = ?");
    params.push(agentId);
  }
  if (dataSourceId) {
    conditions.push("data_source_id = ?");
    params.push(dataSourceId);
  }
  if (cursor) {
    // Cursor format: agent_id:data_source_id
    const [cursorAgentId, cursorDataSourceId] = cursor.split(":");
    if (cursorAgentId && cursorDataSourceId) {
      conditions.push("(agent_id, data_source_id) > (?, ?)");
      params.push(cursorAgentId, cursorDataSourceId);
    }
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  // Fetch limit+1 to determine if there's a next page
  params.push(limit + 1);

  const sql = `
    SELECT agent_id, data_source_id, created_at
    FROM agent_data_source_bindings
    ${whereClause}
    ORDER BY agent_id ASC, data_source_id ASC
    LIMIT ?
  `;

  const result = await c.env.DB.prepare(sql)
    .bind(...params)
    .all<{
      agent_id: string;
      data_source_id: string;
      created_at: string;
    }>();

  const rows = result.results ?? [];
  const hasMore = rows.length > limit;
  const data = hasMore ? rows.slice(0, limit) : rows;
  const lastItem = data[data.length - 1];
  const nextCursor = hasMore && lastItem
    ? `${lastItem.agent_id}:${lastItem.data_source_id}`
    : null;

  const bindingsList: Binding[] = data.map((row) => ({
    agent_id: row.agent_id,
    data_source_id: row.data_source_id,
    created_at: row.created_at,
  }));

  return jsonResponse(c, {
    data: bindingsList,
    next_cursor: nextCursor,
  });
});

/**
 * POST /bindings - Create a new binding
 * Requires: dashboard role
 * Validates: Agent and DataSource must exist and belong to same host
 */
bindings.post("/", requireRole("dashboard"), async (c) => {
  const body = await c.req.json<{
    agent_id?: string;
    data_source_id?: string;
  }>().catch(() => null);

  if (!body || typeof body !== "object") {
    return errors.invalidRequest(c, "Invalid JSON body");
  }

  const { agent_id, data_source_id } = body;

  // Validate required fields
  if (!agent_id || typeof agent_id !== "string") {
    return errors.invalidRequest(c, "agent_id is required");
  }
  if (!data_source_id || typeof data_source_id !== "string") {
    return errors.invalidRequest(c, "data_source_id is required");
  }

  // Fetch agent and data source to validate existence and same host
  const [agentResult, dataSourceResult] = await Promise.all([
    c.env.DB.prepare("SELECT id, host_id FROM agents WHERE id = ?")
      .bind(agent_id)
      .first<{ id: string; host_id: string }>(),
    c.env.DB.prepare("SELECT id, host_id FROM data_sources WHERE id = ?")
      .bind(data_source_id)
      .first<{ id: string; host_id: string }>(),
  ]);

  if (!agentResult) {
    return errors.notFound(c, "Agent");
  }
  if (!dataSourceResult) {
    return errors.notFound(c, "Data Source");
  }

  // Cross-host binding is forbidden
  if (agentResult.host_id !== dataSourceResult.host_id) {
    return errors.forbidden(c, "Cross-host binding is not allowed");
  }

  // Check for existing binding
  const existingBinding = await c.env.DB.prepare(
    "SELECT 1 FROM agent_data_source_bindings WHERE agent_id = ? AND data_source_id = ?"
  )
    .bind(agent_id, data_source_id)
    .first();

  if (existingBinding) {
    return errors.conflict(c, "Binding already exists");
  }

  // Create the binding
  await c.env.DB.prepare(
    "INSERT INTO agent_data_source_bindings (agent_id, data_source_id) VALUES (?, ?)"
  )
    .bind(agent_id, data_source_id)
    .run();

  // Fetch the created binding
  const created = await c.env.DB.prepare(
    "SELECT agent_id, data_source_id, created_at FROM agent_data_source_bindings WHERE agent_id = ? AND data_source_id = ?"
  )
    .bind(agent_id, data_source_id)
    .first<{ agent_id: string; data_source_id: string; created_at: string }>();

  return jsonResponse(c, created, 201);
});

/**
 * DELETE /bindings - Delete a binding
 * Requires: dashboard role
 * Query params: agent_id, data_source_id (both required)
 */
bindings.delete("/", requireRole("dashboard"), async (c) => {
  const agentId = c.req.query("agent_id");
  const dataSourceId = c.req.query("data_source_id");

  if (!agentId) {
    return errors.invalidRequest(c, "agent_id query param is required");
  }
  if (!dataSourceId) {
    return errors.invalidRequest(c, "data_source_id query param is required");
  }

  // Check if binding exists
  const existing = await c.env.DB.prepare(
    "SELECT 1 FROM agent_data_source_bindings WHERE agent_id = ? AND data_source_id = ?"
  )
    .bind(agentId, dataSourceId)
    .first();

  if (!existing) {
    return errors.notFound(c, "Binding");
  }

  // Delete the binding
  await c.env.DB.prepare(
    "DELETE FROM agent_data_source_bindings WHERE agent_id = ? AND data_source_id = ?"
  )
    .bind(agentId, dataSourceId)
    .run();

  return new Response(null, { status: 204 });
});

export { bindings };
