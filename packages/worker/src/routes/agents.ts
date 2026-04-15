import { Hono } from "hono";
import type { Env } from "../env";
import { requireRole } from "../middleware/auth";
import { jsonResponse } from "../lib/response";

const agents = new Hono<{ Bindings: Env }>();

/**
 * POST /agents - Register a new Agent
 * Requires: dashboard or host role
 * - host role: uses auth.hostId, ignores body.host_id
 * - dashboard role: uses body.host_id (required)
 */
agents.post("/", requireRole("dashboard", "host"), async (c) => {
  return jsonResponse(c, { error: "Not implemented" }, 501);
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
