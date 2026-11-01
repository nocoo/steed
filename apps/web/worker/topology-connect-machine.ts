import { idempotencyKeySchema, matchTopologyConnectOperation, revertTopologyChange, TOPOLOGY_LIMITS } from "@steed/api/shared";
import { fingerprint } from "./connect-crypto";
import { HttpError, readJson, readText } from "./http";
import { topologyPositiveInteger, topologyQuery } from "./topology-api";
import { topologyConnectCapabilities, topologyConnectOpenApi } from "./topology-connect-contract";
import { nowSeconds, requireToken, runConnect, type ConnectContext, type ConnectEnv } from "./topology-connect-core";
import { planTopologyConnectMutation } from "./topology-connect-mutation";
import { topologyConnectRead } from "./topology-connect-read";
import { topologyIfMatch } from "./topology-connect-request";
import { topologyConnectWriteStatements } from "./topology-connect-write";
import { getTopologyChange, laterTopologyChangeIdentities } from "./topology-history";
import { planTopologyReplacement } from "./topology-mutation-plan";
import { loadTopology, loadTopologyWith } from "./topology-store";
import type { ServerTiming } from "./server-timing";

type Route = NonNullable<ReturnType<typeof matchTopologyConnectOperation>>;
interface RequestRow {
  token_id: string; key_hash: string; request_hash: string; request_id: string; operation: string;
  http_status: number; response_json: string | null; etag: string | null; created_at: number; expires_at: number;
}
const requestStatement = (ctx: ConnectContext, keyHash: string) => ctx.env.DB.prepare("SELECT * FROM connect_requests WHERE token_id = ? AND key_hash = ?")
  .bind(requireToken(ctx).id, keyHash);
const findRequest = (ctx: ConnectContext, keyHash: string) => requestStatement(ctx, keyHash).first<RequestRow>();
function idempotencyKey(value: string | null) {
  if (!value) throw new HttpError(428, "idempotency_required", "Persist an Idempotency-Key before sending a change.");
  const result = idempotencyKeySchema.safeParse(value);
  if (!result.success) throw new HttpError(400, "invalid_idempotency_key", "The Idempotency-Key is invalid.");
  return result.data;
}
function replay(ctx: ConnectContext, row: RequestRow, hash: string) {
  if (row.request_hash !== hash) throw new HttpError(409, "idempotency_conflict", "This key belongs to a different request.");
  if (row.expires_at <= nowSeconds() || row.response_json === null) throw new HttpError(409, "receipt_expired", "This intent was already processed; read the current topology before retrying.");
  if (!row.http_status) throw new HttpError(409, "outcome_unknown", "Inspect the request status before retrying this intent.");
  const headers = new Headers({ "Content-Type": "application/json" });
  if (row.etag) headers.set("ETag", row.etag);
  if (row.request_id !== ctx.requestId) { headers.set("Idempotency-Replayed", "true"); headers.set("X-Original-Request-Id", row.request_id); }
  return new Response(row.response_json, { status: row.http_status, headers });
}
async function mutate(ctx: ConnectContext, route: Route) {
  const { request, env } = ctx;
  const token = requireToken(ctx);
  const keyHash = await fingerprint(idempotencyKey(request.headers.get("Idempotency-Key")));
  const bodyless = request.method === "DELETE" || route.operation.id === "changes.revert";
  const input = bodyless ? null : await readJson(request, TOPOLOGY_LIMITS.bytes);
  if (bodyless && await readText(request, TOPOLOGY_LIMITS.bytes)) throw new HttpError(400, "unexpected_body", "This operation does not accept a body.");
  const hash = await fingerprint(JSON.stringify([request.method, new URL(request.url).pathname, request.headers.get("If-Match"), request.headers.get("If-None-Match"), request.headers.get("X-Steed-Confirm"), input]));
  // The receipt lookup rides in the snapshot batch: one round trip for replay detection and the plan input.
  const { timing } = ctx;
  const loaded = await timing.time("read", () => loadTopologyWith<RequestRow>(env.DB, [requestStatement(ctx, keyHash)]));
  timing.sql("read-sql", loaded.batch);
  const previous = loaded.extra[0]?.[0];
  if (previous) return replay(ctx, previous, hash);
  let planned: { revision: number; before: Awaited<ReturnType<typeof loadTopology>>["topology"]; plan: ReturnType<typeof planTopologyConnectMutation>; revertsChangeId: number | null };
  try {
    planned = await timing.time("validate", async () => {
      const revision = topologyIfMatch(request);
      const before = loaded.topology;
      if (before.revision !== revision) throw new HttpError(412, "version_conflict", "The topology changed. Read its current state before retrying.");
      let plan: ReturnType<typeof planTopologyConnectMutation>;
      let revertsChangeId: number | null = null;
      if (route.operation.id === "changes.revert") {
        revertsChangeId = topologyPositiveInteger(route.params.changeId, 0, Number.MAX_SAFE_INTEGER);
        if (!revertsChangeId) throw new HttpError(400, "invalid_query", "The topology change ID is invalid.");
        const change = await getTopologyChange(env.DB, revertsChangeId);
        if (!change) throw new HttpError(404, "not_found", "Topology change not found.");
        const later = await laterTopologyChangeIdentities(env.DB, change.revision);
        plan = { ...planTopologyReplacement(before, revertTopologyChange(before, change.items, later)), dangerous: true };
      } else plan = planTopologyConnectMutation(before, route.operation, route.params, input);
      if (plan.dangerous && request.headers.get("X-Steed-Confirm") !== "topology") throw new HttpError(428, "confirmation_required", "Confirm removals with X-Steed-Confirm: topology.");
      return { revision, before, plan, revertsChangeId };
    });
  } catch (error) {
    const completed = await findRequest(ctx, keyHash);
    if (completed) return replay(ctx, completed, hash);
    throw error;
  }
  const { revision, before, plan, revertsChangeId } = planned;
  if (!token.token_hash) throw new HttpError(401, "invalid_token", "The token changed or expired before the write.");
  const tokenHash = token.token_hash;
  const now = nowSeconds();
  const statements = await timing.time("validate", () => topologyConnectWriteStatements(env.DB, { before, after: plan.after, revision, requestId: ctx.requestId,
    actor: ctx.actor, tokenId: token.id, tokenHash, keyHash, requestHash: hash, operation: route.operation.id,
    kind: route.operation.id === "changes.revert" ? "revert" : route.operation.id === "topology.put" ? "replace" : "operations", revertsChangeId,
    warnings: plan.warnings, createdAt: now, updatedAt: new Date().toISOString() }));
  const results = await timing.time("write", () => env.DB.batch<RequestRow>(statements));
  timing.sql("write-sql", results);
  const row = results.at(-1)?.results[0];
  if (!row) throw new HttpError(503, "unavailable", "The request outcome is unavailable; inspect the original idempotency key.");
  ctx.audited = row.request_id === ctx.requestId;
  return replay(ctx, row, hash);
}

export function topologyConnectMachineApi(request: Request, env: ConnectEnv, execution?: Pick<ExecutionContext, "waitUntil">, timing?: ServerTiming) {
  return runConnect(request, env, "bearer", async (ctx) => {
    const url = new URL(request.url);
    const route = matchTopologyConnectOperation(url.pathname, request.method);
    if (!route) throw new HttpError(404, "not_found", "Topology API route not found.");
    const { operation, params } = route;
    ctx.operation = operation.id;
    const token = requireToken(ctx);
    if (operation.write && token.scope !== "topology:write") throw new HttpError(403, "insufficient_scope", "A topology write token is required.");
    if (operation.id === "capabilities") { topologyQuery(url, []); return Response.json(topologyConnectCapabilities(url.origin, token)); }
    if (operation.id === "openapi") { topologyQuery(url, []); return Response.json(topologyConnectOpenApi(url.origin)); }
    if (operation.id === "requests.get") {
      topologyQuery(url, []);
      const row = await findRequest(ctx, await fingerprint(idempotencyKey(params.key ?? null)));
      if (!row) throw new HttpError(404, "not_found", "No committed receipt exists for this key.");
      const expired = row.expires_at <= nowSeconds() || row.response_json === null;
      return Response.json({ data: { state: expired ? "expired" : row.http_status ? "completed" : "unknown", originalRequestId: row.request_id,
        httpStatus: row.http_status, etag: row.etag, result: expired ? null : JSON.parse(row.response_json ?? "null") }, requestId: ctx.requestId });
    }
    if (operation.mutates) { topologyQuery(url, []); return mutate(ctx, route); }
    if (operation.id === "topology.validate") {
      topologyQuery(url, []);
      const input = await readJson(request, TOPOLOGY_LIMITS.bytes);
      const before = (await ctx.timing.time("read", () => loadTopology(env.DB))).topology;
      const plan = await ctx.timing.time("validate", () => planTopologyConnectMutation(before, operation, params, input));
      return Response.json({ data: { valid: true, warnings: plan.warnings, changed: plan.changed }, requestId: ctx.requestId });
    }
    const response = await ctx.timing.time("read", () => topologyConnectRead(request, env.DB, operation, params, ctx.requestId));
    if (response) return response;
    throw new HttpError(404, "not_found", "Topology API route not found.");
  }, undefined, execution, timing);
}

