import { Hono } from "hono";
import type { Env } from "../env";
import { requireRole } from "../middleware/auth";
import { jsonResponse } from "../lib/response";
import type { VerifyAuthResponse } from "@steed/shared";

const auth = new Hono<{ Bindings: Env }>();

/**
 * POST /auth/verify - Verify host API key is valid
 * Requires: host role (so this endpoint inherently validates the token)
 *
 * This endpoint is used by CLI `steed init` to validate the API key
 * before saving configuration. It's a read-only operation that doesn't
 * modify any data.
 */
auth.post("/verify", requireRole("host"), async (c) => {
  const authContext = c.get("auth");
  const hostId = authContext.hostId;

  if (!hostId) {
    // This shouldn't happen if requireRole("host") passed, but be defensive
    return c.json({ error: { code: "unauthorized", message: "Invalid token" } }, 401);
  }

  // Fetch host name
  const host = await c.env.DB.prepare("SELECT name FROM hosts WHERE id = ?")
    .bind(hostId)
    .first<{ name: string }>();

  if (!host) {
    return c.json({ error: { code: "not_found", message: "Host not found" } }, 404);
  }

  const response: VerifyAuthResponse = {
    valid: true,
    host_id: hostId,
    host_name: host.name,
  };

  return jsonResponse(c, response);
});

export { auth };
