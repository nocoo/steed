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
 * Processing logic (executed atomically via D1 batch):
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

  // Phase 1: Read current state (before batch)
  // Get existing agents for this host
  const allAgents = await c.env.DB.prepare(
    `SELECT id, match_key FROM agents WHERE host_id = ?`
  )
    .bind(hostId)
    .all<{ id: string; match_key: string }>();

  // Get existing data sources for this host
  const allDataSources = await c.env.DB.prepare(
    `SELECT id, type, name FROM data_sources WHERE host_id = ?`
  )
    .bind(hostId)
    .all<{ id: string; type: string; name: string }>();

  // Build lookup maps
  const agentsByMatchKey = new Map<string, string>();
  for (const agent of allAgents.results ?? []) {
    agentsByMatchKey.set(agent.match_key, agent.id);
  }

  const dataSourcesByKey = new Map<string, string>();
  for (const ds of allDataSources.results ?? []) {
    dataSourcesByKey.set(`${ds.type}:${ds.name}`, ds.id);
  }

  // Phase 2: Build batch of write operations
  const statements: D1PreparedStatement[] = [];

  // Track stats
  let agentsUpdated = 0;
  let agentsMissing = 0;
  let dataSourcesUpdated = 0;
  let dataSourcesCreated = 0;
  let dataSourcesMissing = 0;

  // 1. Update host.last_seen_at
  statements.push(
    c.env.DB.prepare(`UPDATE hosts SET last_seen_at = ? WHERE id = ?`).bind(
      now,
      hostId
    )
  );

  // 2. Process Agents: match by (host_id, match_key)
  const reportedMatchKeys = new Set<string>();

  for (const agentSnapshot of body.agents ?? []) {
    reportedMatchKeys.add(agentSnapshot.match_key);

    const existingId = agentsByMatchKey.get(agentSnapshot.match_key);
    if (existingId) {
      statements.push(
        c.env.DB.prepare(
          `UPDATE agents SET runtime_app = ?, runtime_version = ?, status = ?, last_seen_at = ? WHERE id = ?`
        ).bind(
          agentSnapshot.runtime_app,
          agentSnapshot.runtime_version,
          agentSnapshot.status,
          now,
          existingId
        )
      );
      agentsUpdated++;
    }
    // If not exists, ignore (unregistered agents are not auto-created)
  }

  // 4. Mark Agents not in snapshot as missing
  for (const agent of allAgents.results ?? []) {
    if (!reportedMatchKeys.has(agent.match_key)) {
      statements.push(
        c.env.DB.prepare(`UPDATE agents SET status = 'missing' WHERE id = ?`).bind(
          agent.id
        )
      );
      agentsMissing++;
    }
  }

  // 3. Process Data Sources: match by (host_id, type, name)
  const reportedDataSources = new Set<string>();

  for (const dsSnapshot of body.data_sources ?? []) {
    const dsKey = `${dsSnapshot.type}:${dsSnapshot.name}`;
    reportedDataSources.add(dsKey);

    const existingId = dataSourcesByKey.get(dsKey);
    if (existingId) {
      statements.push(
        c.env.DB.prepare(
          `UPDATE data_sources SET version = ?, auth_status = ?, status = 'active', last_seen_at = ? WHERE id = ?`
        ).bind(dsSnapshot.version, dsSnapshot.auth_status, now, existingId)
      );
      dataSourcesUpdated++;
    } else {
      const id = generateId("ds");
      statements.push(
        c.env.DB.prepare(
          `INSERT INTO data_sources (id, host_id, type, name, version, auth_status, status, metadata, created_at, last_seen_at)
           VALUES (?, ?, ?, ?, ?, ?, 'active', '{}', ?, ?)`
        ).bind(
          id,
          hostId,
          dsSnapshot.type,
          dsSnapshot.name,
          dsSnapshot.version,
          dsSnapshot.auth_status,
          now,
          now
        )
      );
      dataSourcesCreated++;
    }
  }

  // 5. Mark Data Sources not in snapshot as missing
  for (const ds of allDataSources.results ?? []) {
    const dsKey = `${ds.type}:${ds.name}`;
    if (!reportedDataSources.has(dsKey)) {
      statements.push(
        c.env.DB.prepare(
          `UPDATE data_sources SET status = 'missing' WHERE id = ?`
        ).bind(ds.id)
      );
      dataSourcesMissing++;
    }
  }

  // Phase 3: Execute all writes atomically
  if (statements.length > 0) {
    await c.env.DB.batch(statements);
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
