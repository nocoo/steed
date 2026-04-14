import { Hono } from "hono";
import { generateId } from "@steed/shared";
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
  let dataSourcesUpdated = 0;
  let dataSourcesCreated = 0;
  let dataSourcesMissing = 0;

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

  // 3. Process Data Sources: match by (host_id, type, name)
  const reportedDataSources = new Set<string>();

  for (const dsSnapshot of body.data_sources ?? []) {
    const dsKey = `${dsSnapshot.type}:${dsSnapshot.name}`;
    reportedDataSources.add(dsKey);

    // Try to find existing data source
    const existing = await c.env.DB.prepare(
      `SELECT id FROM data_sources WHERE host_id = ? AND type = ? AND name = ?`
    )
      .bind(hostId, dsSnapshot.type, dsSnapshot.name)
      .first<{ id: string }>();

    if (existing) {
      // Update existing data source
      await c.env.DB.prepare(
        `UPDATE data_sources SET version = ?, auth_status = ?, status = 'active', last_seen_at = ? WHERE id = ?`
      )
        .bind(dsSnapshot.version, dsSnapshot.auth_status, now, existing.id)
        .run();
      dataSourcesUpdated++;
    } else {
      // Create new data source
      const id = generateId("ds");
      await c.env.DB.prepare(
        `INSERT INTO data_sources (id, host_id, type, name, version, auth_status, status, metadata, created_at, last_seen_at)
         VALUES (?, ?, ?, ?, ?, ?, 'active', '{}', ?, ?)`
      )
        .bind(
          id,
          hostId,
          dsSnapshot.type,
          dsSnapshot.name,
          dsSnapshot.version,
          dsSnapshot.auth_status,
          now,
          now
        )
        .run();
      dataSourcesCreated++;
    }
  }

  // 5. Mark Data Sources not in snapshot as missing
  const allDataSources = await c.env.DB.prepare(
    `SELECT id, type, name FROM data_sources WHERE host_id = ?`
  )
    .bind(hostId)
    .all<{ id: string; type: string; name: string }>();

  for (const ds of allDataSources.results ?? []) {
    const dsKey = `${ds.type}:${ds.name}`;
    if (!reportedDataSources.has(dsKey)) {
      await c.env.DB.prepare(
        `UPDATE data_sources SET status = 'missing' WHERE id = ?`
      )
        .bind(ds.id)
        .run();
      dataSourcesMissing++;
    }
  }

  const response: SnapshotResponse = {
    host_id: hostId,
    agents_updated: agentsUpdated,
    agents_missing: agentsMissing,
    data_sources_updated: dataSourcesUpdated,
    data_sources_created: dataSourcesCreated,
    data_sources_missing: dataSourcesMissing,
  };

  return jsonResponse(c, response);
});

export { snapshot };
