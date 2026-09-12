import { z } from "zod";
import { CONNECT_LIMITS, DIAGRAM_LIMITS, ENTITY_SCHEMAS, applyDiagramOperations, diagramEtag, diagramIdSchema, diagramOperationSchema, diagramSchema, idempotencyKeySchema, matchConnectOperation, operationBatchSchema, type Diagram, type DiagramOperation, type MutationReceipt } from "@steed/api/shared";
import { diagramListQuery } from "./diagram-api";
import { diagramDeleteStatement, diagramPutStatement, getDiagram, listDiagrams, readRevision } from "./diagram-store";
import { fingerprint } from "./connect-crypto";
import { connectCapabilities, connectOpenApi } from "./connect-contract";
import { nowSeconds, requireToken, runConnect, type ConnectContext, type ConnectEnv } from "./connect";
import { HttpError, readJson, readText } from "./http";

interface RequestRow {
  token_id: string; key_hash: string; request_hash: string; request_id: string; diagram_id: string;
  operation: string; http_status: number; response_json: string | null; etag: string | null; created_at: number; expires_at: number;
}
const singular = { nodes: "node", edges: "edge", groups: "group", views: "view" } as const;
const findRequest = (ctx: ConnectContext, key: string) => ctx.env.DB.prepare("SELECT * FROM connect_requests WHERE token_id = ? AND key_hash = ?").bind(requireToken(ctx).id, key).first<RequestRow>();
const emptyQuery = (url: URL) => z.strictObject({}).parse(Object.fromEntries(url.searchParams));
function receiptResponse(ctx: ConnectContext, row: RequestRow, hash: string) {
  if (row.request_hash !== hash) throw new HttpError(409, "idempotency_conflict", "This key belongs to a different request. Keep one key per exact intent.");
  if (row.expires_at <= nowSeconds() || row.response_json === null) throw new HttpError(409, "receipt_expired", "This intent was already processed. Its receipt expired; inspect the current state before planning a new change.");
  if (!row.http_status) throw new HttpError(409, "outcome_unknown", "Inspect the request status before retrying this intent.");
  const headers = new Headers({ "Content-Type": "application/json" });
  if (row.etag) headers.set("ETag", row.etag);
  if (row.http_status === 201) headers.set("Location", `/api/v1/diagrams/${row.diagram_id}`);
  if (row.request_id !== ctx.requestId) { headers.set("Idempotency-Replayed", "true"); headers.set("X-Original-Request-Id", row.request_id); }
  return new Response(row.http_status === 204 ? null : row.response_json, { status: row.http_status, headers });
}

async function mutate(ctx: ConnectContext, route: NonNullable<ReturnType<typeof matchConnectOperation>>, id: string) {
  const token = requireToken(ctx);
  const { request, env } = ctx;
  const key = request.headers.get("Idempotency-Key");
  if (!key) throw new HttpError(428, "idempotency_required", "Persist an Idempotency-Key before sending a change.");
  const keyHash = await fingerprint(idempotencyKeySchema.parse(key));
  const input = request.method === "DELETE" ? null : await readJson(request, DIAGRAM_LIMITS.bytes);
  if (request.method === "DELETE" && await readText(request, DIAGRAM_LIMITS.bytes)) throw new HttpError(400, "unexpected_body", "DELETE does not accept a body.");
  const hash = await fingerprint(JSON.stringify([request.method, new URL(request.url).pathname, request.headers.get("If-Match"), request.headers.get("If-None-Match"), request.headers.get("X-Steed-Confirm"), input]));
  const previous = await findRequest(ctx, keyHash);
  if (previous) return receiptResponse(ctx, previous, hash);
  const revision = readRevision(request, id);
  let document: Diagram;
  const deleting = route.operation.id === "diagrams.delete";
  let dangerous = Boolean(route.operation.dangerous);
  try {
    if (route.operation.id === "diagrams.put") document = diagramSchema.parse(input);
    else {
      if (revision === null) throw new HttpError(428, "precondition_required", "This operation requires the current diagram ETag in If-Match.");
      const current = await getDiagram(env.DB, id);
      let operations: DiagramOperation[] = [];
      const collection = route.operation.collection;
      if (route.operation.id === "diagrams.operations") operations = operationBatchSchema.parse(input).operations;
      else if (collection) {
        const entityId = diagramIdSchema.parse(route.params.entityId);
        if (request.method === "DELETE") {
          if (!current.document[collection].some((entity) => entity.id === entityId)) throw new HttpError(404, "not_found", "Diagram entity not found.");
          operations = [diagramOperationSchema.parse({ op: `remove_${singular[collection]}`, id: entityId })];
        } else {
          const value = ENTITY_SCHEMAS[collection].parse(input);
          if (value.id !== entityId) throw new HttpError(422, "id_mismatch", "The entity ID must match its path.");
          operations = [diagramOperationSchema.parse({ op: `put_${singular[collection]}`, value })];
        }
      }
      dangerous ||= operations.some((operation) => operation.op.startsWith("remove_"));
      document = current.revision === revision ? applyDiagramOperations(current.document, operations) : current.document;
    }
    if (dangerous && request.headers.get("X-Steed-Confirm") !== id) throw new HttpError(428, "confirmation_required", "Confirm this removal with X-Steed-Confirm set to the canonical diagram ID.");
  } catch (error) {
    const completed = await findRequest(ctx, keyHash);
    if (completed) return receiptResponse(ctx, completed, hash);
    throw error;
  }
  const nextRevision = (revision ?? 0) + 1;
  const now = new Date().toISOString();
  const etag = diagramEtag(id, nextRevision);
  const status = deleting ? 204 : revision === null ? 201 : 200;
  const receipt: MutationReceipt = { id, revision: nextRevision, nodeCount: document.nodes.length, edgeCount: document.edges.length, updatedAt: now };
  const successBody = deleting ? "null" : JSON.stringify({ data: receipt, requestId: ctx.requestId });
  const conflict = JSON.stringify({ error: { code: "version_conflict", message: "The diagram changed. Read its current state and ETag before planning a new intent.", requestId: ctx.requestId } });
  const invalidToken = JSON.stringify({ error: { code: "invalid_token", message: "The token changed or expired before the write.", requestId: ctx.requestId } });
  const activeToken = `EXISTS (SELECT 1 FROM connect_tokens WHERE id = ? AND token_hash = ? AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > unixepoch()) AND scope = 'write')`;
  const guard = { clause: `EXISTS (SELECT 1 FROM connect_requests WHERE request_id = ? AND http_status = 0) AND ${activeToken}`, values: [ctx.requestId, token.id, token.token_hash] };
  const write = deleting && revision !== null ? diagramDeleteStatement(env.DB, id, revision, now, guard) : diagramPutStatement(env.DB, id, document, revision, now, guard);
  const seconds = nowSeconds();
  // A reservation is never committed without its graph result and audit in the same D1 transaction.
  const results = await env.DB.batch<RequestRow>([
    env.DB.prepare(`INSERT INTO connect_requests (token_id, key_hash, request_hash, request_id, diagram_id, operation, created_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(token_id, key_hash) DO NOTHING`)
      .bind(token.id, keyHash, hash, ctx.requestId, id, ctx.operation, seconds, seconds + CONNECT_LIMITS.receiptDays * 86400),
    write,
    env.DB.prepare(`UPDATE connect_requests SET
      http_status = CASE WHEN changes() = 1 THEN ? WHEN ${activeToken} THEN 412 ELSE 401 END,
      response_json = CASE WHEN changes() = 1 THEN ? WHEN ${activeToken} THEN ? ELSE ? END,
      etag = CASE WHEN changes() = 1 THEN ? ELSE NULL END
      WHERE request_id = ? AND http_status = 0`)
      .bind(status, token.id, token.token_hash, successBody, token.id, token.token_hash, conflict, invalidToken, etag, ctx.requestId),
    env.DB.prepare(`INSERT INTO connect_audit (request_id, token_id, diagram_id, actor, operation, status, code, created_at)
      SELECT request_id, token_id, diagram_id, ?, operation, http_status,
      CASE WHEN http_status = 412 THEN 'version_conflict' WHEN http_status = 401 THEN 'invalid_token' ELSE NULL END, ?
      FROM connect_requests WHERE request_id = ?`)
      .bind(ctx.actor, seconds, ctx.requestId),
    env.DB.prepare("SELECT * FROM connect_requests WHERE token_id = ? AND key_hash = ?").bind(token.id, keyHash),
  ]);
  const result = results[4]?.results[0];
  if (!result) throw new HttpError(503, "unavailable", "The request outcome is unavailable. Inspect the existing idempotency key before trying a new intent.");
  ctx.audited = result.request_id === ctx.requestId;
  return receiptResponse(ctx, result, hash);
}

export function isDiagramApiPath(path: string) {
  return ["/api/v1/diagrams", "/api/v1/capabilities", "/api/v1/openapi.json", "/api/v1/requests"].some((base) => path === base || path.startsWith(`${base}/`));
}
export function connectMachineApi(request: Request, env: ConnectEnv) {
  return runConnect(request, env, "bearer", async (ctx) => {
    const url = new URL(request.url);
    const route = matchConnectOperation(url.pathname, request.method);
    if (!route) throw new HttpError(404, "not_found", "Diagram API route not found.");
    const { operation, params } = route;
    ctx.operation = operation.id;
    const token = requireToken(ctx);
    if (operation.write && token.scope !== "write") throw new HttpError(403, "insufficient_scope", "A write token is required.");
    const id = params.diagramId === undefined ? undefined : diagramIdSchema.parse(params.diagramId);
    if (id) {
      if (token.diagram_id !== null && token.diagram_id !== id) throw new HttpError(404, "not_found", "Diagram not found.");
      ctx.diagramId = id;
    }
    if (!operation.id.endsWith(".list")) emptyQuery(url);
    if (operation.id === "capabilities") return Response.json(connectCapabilities(url.origin, token));
    if (operation.id === "openapi") return Response.json(connectOpenApi(url.origin));
    if (operation.id === "requests.get") {
      const row = await findRequest(ctx, await fingerprint(idempotencyKeySchema.parse(params.key)));
      if (!row) throw new HttpError(404, "not_found", "No committed receipt exists for this key. Reuse the exact original request and key when retrying.");
      const expired = row.expires_at <= nowSeconds() || row.response_json === null;
      return Response.json({ data: { state: expired ? "expired" : row.http_status ? "completed" : "unknown", originalRequestId: row.request_id,
        httpStatus: row.http_status, diagramId: row.diagram_id, etag: row.etag, result: expired ? null : JSON.parse(row.response_json ?? "null") }, requestId: ctx.requestId });
    }
    if (operation.id === "diagrams.list") {
      const query = diagramListQuery.parse(Object.fromEntries(url.searchParams));
      return Response.json({ ...await listDiagrams(env.DB, query.cursor, query.limit, token.diagram_id ?? undefined), requestId: ctx.requestId });
    }
    if (!id) throw new HttpError(404, "not_found", "Diagram not found.");
    if (operation.mutates) return mutate(ctx, route, id);
    if (operation.id === "diagrams.validate") {
      const document = diagramSchema.parse(await readJson(request, DIAGRAM_LIMITS.bytes));
      return Response.json({ data: { valid: true, nodeCount: document.nodes.length, edgeCount: document.edges.length }, requestId: ctx.requestId });
    }
    const record = await getDiagram(env.DB, id);
    const headers = { ETag: diagramEtag(id, record.revision) };
    if (operation.id === "diagrams.export") return Response.json(record.document, { headers: { ...headers, "Content-Disposition": `attachment; filename="${id}.json"` } });
    const collection = operation.collection;
    if (collection) {
      if (params.entityId) {
        const entityId = diagramIdSchema.parse(params.entityId);
        const entity = record.document[collection].find((item) => item.id === entityId);
        if (!entity) throw new HttpError(404, "not_found", "Diagram entity not found.");
        return Response.json({ data: entity, requestId: ctx.requestId }, { headers });
      }
      const query = diagramListQuery.parse(Object.fromEntries(url.searchParams));
      const all = [...record.document[collection]].filter((item) => item.id > query.cursor).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
      const data = all.slice(0, query.limit);
      return Response.json({ data, nextCursor: all.length > query.limit ? data.at(-1)?.id ?? null : null, requestId: ctx.requestId }, { headers });
    }
    return Response.json({ data: record, requestId: ctx.requestId }, { headers });
  });
}
