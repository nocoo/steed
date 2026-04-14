import { Hono } from "hono";
import type { Env } from "../env";
import { requireRole } from "../middleware/auth";
import { jsonResponse, errors } from "../lib/response";
import type { SnapshotRequest, SnapshotResponse } from "@steed/shared";

const snapshot = new Hono<{ Bindings: Env }>();

/**
 * POST /snapshot - Upload host resource snapshot (heartbeat)
 * Requires: host role
 *
 * Processing logic:
 * 1. Update host.last_seen_at from API Key context
 * 2. For each Agent: match by (host_id, match_key) -> if exists, update scan fields; if not, ignore
 * 3. For each Data Source: match by (host_id, type, name) -> if exists, update; if not, INSERT
 * 4. Mark Agents not in snapshot as status='missing'
 * 5. Mark Data Sources not in snapshot as status='missing'
 */
snapshot.post("/", requireRole("host"), async (c) => {
  const auth = c.get("auth");
  const hostId = auth.hostId;

  if (!hostId) {
    return errors.internalError(c);
  }

  const body = await c.req.json<SnapshotRequest>().catch(() => null);

  if (!body) {
    return errors.invalidRequest(c, "Invalid JSON body");
  }

  const now = new Date().toISOString();

  // 1. Update host.last_seen_at
  await c.env.DB.prepare(`UPDATE hosts SET last_seen_at = ? WHERE id = ?`)
    .bind(now, hostId)
    .run();

  // Track stats
  let agentsUpdated = 0;
  let agentsMissing = 0;

  // 2. Process Agents: match by (host_id, match_key)
  const reportedMatchKeys = new Set<string>();

  for (const agentSnapshot of body.agents ?? []) {
    reportedMatchKeys.add(agentSnapshot.match_key);

    // Try to find existing agent
    const existing = await c.env.DB.prepare(
      `SELECT id FROM agents WHERE host_id = ? AND match_key = ?`
    )
      .bind(hostId, agentSnapshot.match_key)
      .first<{ id: string }>();

    if (existing) {
      // Update scan fields
      await c.env.DB.prepare(
        `UPDATE agents SET runtime_app = ?, runtime_version = ?, status = ?, last_seen_at = ? WHERE id = ?`
      )
        .bind(
          agentSnapshot.runtime_app,
          agentSnapshot.runtime_version,
          agentSnapshot.status,
          now,
          existing.id
        )
        .run();
      agentsUpdated++;
    }
    // If not exists, ignore (unregistered agents are not auto-created)
  }

  // 4. Mark Agents not in snapshot as missing
  const allAgents = await c.env.DB.prepare(
    `SELECT id, match_key FROM agents WHERE host_id = ?`
  )
    .bind(hostId)
    .all<{ id: string; match_key: string }>();

  for (const agent of allAgents.results ?? []) {
    if (!reportedMatchKeys.has(agent.match_key)) {
      await c.env.DB.prepare(`UPDATE agents SET status = 'missing' WHERE id = ?`)
        .bind(agent.id)
        .run();
      agentsMissing++;
    }
  }

  const response: SnapshotResponse = {
    host_id: hostId,
    agents_updated: agentsUpdated,
    agents_missing: agentsMissing,
    data_sources_updated: 0,
    data_sources_created: 0,
    data_sources_missing: 0,
  };

  return jsonResponse(c, response);
});

export { snapshot };
