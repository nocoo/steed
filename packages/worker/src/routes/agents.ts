import { Hono } from "hono";
import { generateId } from "@steed/shared";
import type { Env } from "../env";
import { requireRole } from "../middleware/auth";
import { jsonResponse, errors } from "../lib/response";
import type { Agent, CreateAgentRequest } from "@steed/shared";

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

/**
 * GET /agents - List all Agents with filtering
 * Requires: dashboard role
 */
agents.get("/", requireRole("dashboard"), async (c) => {
  return jsonResponse(c, { error: "Not implemented" }, 501);
});

/**
 * GET /agents/:id - Get single Agent details
 * Requires: dashboard role
 */
agents.get("/:id", requireRole("dashboard"), async (c) => {
  return jsonResponse(c, { error: "Not implemented" }, 501);
});

/**
 * PATCH /agents/:id - Update Agent metadata
 * Requires: dashboard role
 */
agents.patch("/:id", requireRole("dashboard"), async (c) => {
  return jsonResponse(c, { error: "Not implemented" }, 501);
});

export { agents };
