import { Hono } from "hono";
import type { Env } from "../env";
import { requireRole } from "../middleware/auth";
import { jsonResponse } from "../lib/response";
import type { Lane } from "@steed/shared";

const lanes = new Hono<{ Bindings: Env }>();

/**
 * GET /lanes - List all lanes
 * Requires: dashboard role
 * Returns preset lanes (work, life, learning)
 */
lanes.get("/", requireRole("dashboard"), async (c) => {
  const result = await c.env.DB.prepare(
    `SELECT id, name FROM lanes ORDER BY name ASC`
  ).all<{ id: string; name: string }>();

  const lanesList: Lane[] = (result.results ?? []).map((row) => ({
    id: row.id,
    name: row.name as Lane["name"],
  }));

  return jsonResponse(c, { data: lanesList });
});

export { lanes };
