import { Hono } from "hono";
import type { Env } from "../env";
import { requireRole } from "../middleware/auth";
import { errors } from "../lib/response";

const dataSources = new Hono<{ Bindings: Env }>();

/**
 * GET /data-sources - List all Data Sources with filtering
 * Requires: dashboard role
 * Query params: host_id, lane_id, status, limit, cursor
 */
dataSources.get("/", requireRole("dashboard"), async (c) => {
  return errors.notImplemented(c);
});

/**
 * GET /data-sources/:id - Get single Data Source details
 * Requires: dashboard role
 */
dataSources.get("/:id", requireRole("dashboard"), async (c) => {
  return errors.notImplemented(c);
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
