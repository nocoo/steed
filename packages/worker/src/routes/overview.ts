import { Hono } from "hono";
import type { Env } from "../env";
import { requireRole } from "../middleware/auth";
import { jsonResponse } from "../lib/response";
import type { Overview } from "@steed/shared";

// Online threshold: 15 minutes (same as hosts route)
const ONLINE_THRESHOLD_MS = 15 * 60 * 1000;

const overview = new Hono<{ Bindings: Env }>();

/**
 * GET /overview - Global overview for dashboard homepage
 * Requires: dashboard role
 */
overview.get("/", requireRole("dashboard"), async (c) => {
  const now = Date.now();
  const onlineThreshold = new Date(now - ONLINE_THRESHOLD_MS).toISOString();

  // Get host counts
  const hostsResult = await c.env.DB.prepare(
    `SELECT
      COUNT(*) as total,
      SUM(CASE WHEN last_seen_at >= ? THEN 1 ELSE 0 END) as online
    FROM hosts`
  )
    .bind(onlineThreshold)
    .first<{ total: number; online: number }>();

  const hostsTotal = hostsResult?.total ?? 0;
  const hostsOnline = hostsResult?.online ?? 0;

  // Get agent counts
  const agentsResult = await c.env.DB.prepare(
    `SELECT
      COUNT(*) as total,
      SUM(CASE WHEN status = 'running' THEN 1 ELSE 0 END) as running,
      SUM(CASE WHEN status = 'stopped' THEN 1 ELSE 0 END) as stopped,
      SUM(CASE WHEN status = 'missing' THEN 1 ELSE 0 END) as missing
    FROM agents`
  ).first<{
    total: number;
    running: number;
    stopped: number;
    missing: number;
  }>();

  // Get agents by lane
  const agentsByLaneResult = await c.env.DB.prepare(
    `SELECT
      SUM(CASE WHEN lane_id = 'lane_work' THEN 1 ELSE 0 END) as work,
      SUM(CASE WHEN lane_id = 'lane_life' THEN 1 ELSE 0 END) as life,
      SUM(CASE WHEN lane_id = 'lane_learning' THEN 1 ELSE 0 END) as learning,
      SUM(CASE WHEN lane_id IS NULL THEN 1 ELSE 0 END) as unassigned
    FROM agents`
  ).first<{
    work: number;
    life: number;
    learning: number;
    unassigned: number;
  }>();

  // Get data source counts
  const dataSourcesResult = await c.env.DB.prepare(
    `SELECT
      COUNT(*) as total,
      SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as active,
      SUM(CASE WHEN status = 'missing' THEN 1 ELSE 0 END) as missing
    FROM data_sources`
  ).first<{ total: number; active: number; missing: number }>();

  const response: Overview = {
    hosts: {
      total: hostsTotal,
      online: hostsOnline,
      offline: hostsTotal - hostsOnline,
    },
    agents: {
      total: agentsResult?.total ?? 0,
      running: agentsResult?.running ?? 0,
      stopped: agentsResult?.stopped ?? 0,
      missing: agentsResult?.missing ?? 0,
      by_lane: {
        work: agentsByLaneResult?.work ?? 0,
        life: agentsByLaneResult?.life ?? 0,
        learning: agentsByLaneResult?.learning ?? 0,
        unassigned: agentsByLaneResult?.unassigned ?? 0,
      },
    },
    data_sources: {
      total: dataSourcesResult?.total ?? 0,
      active: dataSourcesResult?.active ?? 0,
      missing: dataSourcesResult?.missing ?? 0,
    },
  };

  return jsonResponse(c, response);
});

export { overview };
