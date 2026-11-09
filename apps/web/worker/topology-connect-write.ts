import { CONNECT_LIMITS, topologyEtag, type Topology, type TopologyWarning } from "@steed/api/shared";
import { topologyWriteStatements, type TopologyWrite } from "./topology-write";

export interface TopologyConnectWrite {
  before: Topology;
  after: Topology;
  revision: number;
  requestId: string;
  actor: string;
  tokenId: string;
  tokenHash: string;
  keyHash: string;
  requestHash: string;
  operation: string;
  kind: TopologyWrite["kind"];
  revertsChangeId: number | null;
  warnings: TopologyWarning[];
  createdAt: number;
  updatedAt: string;
}

export function topologyConnectWriteStatements(db: D1Database, input: TopologyConnectWrite) {
  const activeToken = `EXISTS (SELECT 1 FROM connect_tokens WHERE id = ? AND token_hash = ? AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > unixepoch()) AND scope = 'topology:write')`;
  const reservation = `EXISTS (SELECT 1 FROM connect_requests WHERE request_id = ? AND http_status = 0)`;
  const write = topologyWriteStatements(db, {
    before: input.before, after: input.after, revision: input.revision, requestId: input.requestId,
    actor: input.actor, tokenId: input.tokenId, provenance: input.after.provenance ?? null,
    kind: input.kind, revertsChangeId: input.revertsChangeId, updatedAt: input.updatedAt, createdAt: input.createdAt,
    guard: { clause: `${reservation} AND ${activeToken}`, values: [input.requestId, input.tokenId, input.tokenHash] },
  });
  const committed = `EXISTS (SELECT 1 FROM topology_meta WHERE id = 'main' AND request_id = ? AND revision = ?)`;
  const etag = topologyEtag(write.nextRevision);
  const counts = Object.fromEntries((["layers", "types", "boundaries", "nodes", "edges", "views"] as const)
    .map((collection) => [collection, input.after[collection].length]));
  const success = JSON.stringify({ data: { revision: write.nextRevision, counts, changed: write.changed, warnings: input.warnings }, requestId: input.requestId });
  const conflict = JSON.stringify({ error: { code: "version_conflict", message: "The topology changed. Read its current state before retrying.", requestId: input.requestId } });
  const invalidToken = JSON.stringify({ error: { code: "invalid_token", message: "The token changed or expired before the write.", requestId: input.requestId } });
  return [
    db.prepare(`INSERT INTO connect_requests (token_id, key_hash, request_hash, request_id, operation, created_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(token_id, key_hash) DO NOTHING`)
      .bind(input.tokenId, input.keyHash, input.requestHash, input.requestId, input.operation, input.createdAt, input.createdAt + CONNECT_LIMITS.receiptDays * 86400),
    ...write.statements,
    db.prepare(`UPDATE connect_requests SET
      http_status = CASE WHEN ${committed} THEN 200 WHEN ${activeToken} THEN 412 ELSE 401 END,
      response_json = CASE WHEN ${committed} THEN ? WHEN ${activeToken} THEN ? ELSE ? END,
      etag = CASE WHEN ${committed} THEN ? ELSE NULL END
      WHERE request_id = ? AND http_status = 0`)
      .bind(write.writeId, write.nextRevision, input.tokenId, input.tokenHash,
        write.writeId, write.nextRevision, success, input.tokenId, input.tokenHash, conflict, invalidToken,
        write.writeId, write.nextRevision, etag, input.requestId),
    db.prepare(`INSERT INTO connect_audit (request_id, token_id, target, actor, operation, status, code, created_at)
      SELECT request_id, token_id, 'topology', ?, operation, http_status,
      CASE WHEN http_status = 412 THEN 'version_conflict' WHEN http_status = 401 THEN 'invalid_token' ELSE NULL END, ?
      FROM connect_requests WHERE request_id = ?`)
      .bind(input.actor, input.createdAt, input.requestId),
    db.prepare("SELECT * FROM connect_requests WHERE token_id = ? AND key_hash = ?").bind(input.tokenId, input.keyHash),
  ];
}
