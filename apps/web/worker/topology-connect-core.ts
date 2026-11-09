import { CONNECT_LIMITS, TopologyOperationError } from "@steed/api/shared";
import { pruneTopologyHistoryStatement } from "./topology-history";
import { apiResponse, errorResponse, HttpError, requireSameOrigin } from "./http";
import { fingerprint } from "./connect-crypto";
import { isLocalRequest } from "./access-jwt";
import { ServerTiming } from "./server-timing";

export type ConnectEnv = Pick<Cloudflare.ProductionEnv, "DB"> & Pick<WorkerBindings, "CONNECT_DEPLOYMENT_ID" | "CONNECT_TOKEN_KEYS" | "CONNECT_MANAGERS" | "CF_ACCESS_DEV_BYPASS">;
export interface TokenRow {
  id: string; name: string; scope: "topology:read" | "topology:write"; prefix: string;
  token_hash: string | null; ciphertext: string | null; owner: string; version: number;
  created_at: number; expires_at: number | null; last_used_at: number | null; revoked_at: number | null;
}
export interface ConnectContext {
  request: Request;
  env: ConnectEnv;
  requestId: string;
  actor: string;
  operation: string;
  token?: TokenRow;
  tokenId?: string;
  audited: boolean;
  /** Pending token rate-limit increment. Writes fold it into their D1 batch; anything
   *  else (reads, validate, 412/422 before the write) defers it via waitUntil. */
  rateCharge?: { key: string; window: number };
  execution?: Pick<ExecutionContext, "waitUntil">;
  /** Deferred writes, not yet started. They start only after the action finishes so no write
   *  commit is in flight on the D1 primary while the request's own reads run. */
  deferred: (() => Promise<unknown>)[];
  timing: ServerTiming;
}
export const nowSeconds = () => Math.floor(Date.now() / 1000);
export const iso = (value: number | null) => value === null ? null : new Date(value * 1000).toISOString();
export const tokenMetadata = (row: TokenRow) => ({ id: row.id, name: row.name, scope: row.scope, prefix: row.prefix,
  createdAt: new Date(row.created_at * 1000).toISOString(), expiresAt: iso(row.expires_at), lastUsedAt: iso(row.last_used_at), revokedAt: iso(row.revoked_at), version: row.version });
export function deployment(env: ConnectEnv): string {
  if (!env.CONNECT_DEPLOYMENT_ID) throw new HttpError(503, "connect_unconfigured", "Connect deployment identity is not configured.");
  return env.CONNECT_DEPLOYMENT_ID;
}
export const tokenContext = (env: ConnectEnv, row: TokenRow) => JSON.stringify(["token", deployment(env), row.id, row.scope, row.owner, row.expires_at]);
const local = (request: Request, env: ConnectEnv) => env.CF_ACCESS_DEV_BYPASS === "true" && env.CONNECT_DEPLOYMENT_ID === "steed-development" && isLocalRequest(request);
export function isManager(request: Request, env: ConnectEnv, principal: string) {
  if (principal === "local:developer") return local(request, env);
  return (env.CONNECT_MANAGERS ?? "").split(",").map((entry) => entry.trim()).filter(Boolean).includes(principal);
}

export async function rate(db: D1Database, key: string, limit: number) {
  const window = Math.floor(nowSeconds() / 60) * 60;
  const row = await db.prepare(`INSERT INTO connect_rate_limits (key, window, count) VALUES (?, ?, 1)
    ON CONFLICT(key, window) DO UPDATE SET count = count + 1 WHERE count < ? RETURNING count`).bind(key, window, limit).first();
  if (!row) throw new HttpError(429, "rate_limited", "Too many requests. Retry after one minute.");
}

const LIVE_TOKEN = "token_hash = ? AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > ?)";
/** Unconditional +1 for a token rate bucket. The limit is enforced by a prior read of the
 *  current count; this statement never rejects, so a request that passed the check is charged
 *  exactly once even when concurrent peers push the stored count past the limit. */
export function rateIncrementStatement(db: D1Database, key: string, window: number) {
  return db.prepare(`INSERT INTO connect_rate_limits (key, window, count) VALUES (?, ?, 1)
    ON CONFLICT(key, window) DO UPDATE SET count = count + 1`).bind(key, window);
}
/** Take a pending write charge for inclusion in the mutation's D1 batch. Returns null when
 *  there is nothing to fold (already deferred, or a read). */
export function takeRateCharge(ctx: ConnectContext): D1PreparedStatement | null {
  const charge = ctx.rateCharge;
  if (!charge) return null;
  ctx.rateCharge = undefined;
  return rateIncrementStatement(ctx.env.DB, charge.key, charge.window);
}
function deferRateCharge(ctx: ConnectContext) {
  const charge = ctx.rateCharge;
  if (!charge) return;
  ctx.rateCharge = undefined;
  defer(ctx, () => rateIncrementStatement(ctx.env.DB, charge.key, charge.window).run());
}
// Auth is a read-only batch: token lookup + current window count. Writes fold their increment
// into the mutation's single D1 batch; reads (and write paths that never reach that batch)
// defer it via waitUntil. Rejected tokens never arm a charge.
async function bearer(ctx: ConnectContext) {
  const credential = /^Bearer (steedc_[A-Za-z0-9_-]{43})$/i.exec(ctx.request.headers.get("Authorization") ?? "")?.[1];
  if (!credential) throw new HttpError(401, "invalid_token", "A valid Connect Bearer token is required.");
  const hash = await fingerprint(`${deployment(ctx.env)}:${credential}`);
  const writing = !["GET", "HEAD"].includes(ctx.request.method);
  const kind = writing ? "write" : "read";
  const limit = writing ? CONNECT_LIMITS.writePerMinute : CONNECT_LIMITS.readPerMinute;
  const now = nowSeconds();
  const window = Math.floor(now / 60) * 60;
  const db = ctx.env.DB;
  const batch = await db.batch<Record<string, unknown>>([
    db.prepare("SELECT * FROM connect_tokens WHERE token_hash = ?").bind(hash),
    db.prepare(`SELECT count FROM connect_rate_limits WHERE key = (
      SELECT 'token:' || id || ':' || ? FROM connect_tokens WHERE token_hash = ?) AND window = ?`).bind(kind, hash, window),
  ]);
  ctx.timing.sql("auth-sql", batch);
  const [lookup, usage] = batch;
  const row = lookup?.results[0] as TokenRow | undefined;
  if (!row || row.revoked_at !== null || (row.expires_at !== null && row.expires_at <= now)) throw new HttpError(401, "invalid_token", "The token is invalid, expired or revoked.");
  ctx.token = row; ctx.tokenId = row.id; ctx.actor = `token:${row.id}`;
  if (!isManager(ctx.request, ctx.env, row.owner)) throw new HttpError(403, "authorization_revoked", "The issuing manager is no longer authorized.");
  if (writing && row.scope !== "topology:write") throw new HttpError(403, "insufficient_scope", "A write token is required.");
  const count = Number((usage?.results[0] as { count?: number } | undefined)?.count ?? 0);
  if (!Number.isFinite(count) || count >= limit) throw new HttpError(429, "rate_limited", "Too many requests. Retry after one minute.");
  ctx.rateCharge = { key: `token:${row.id}:${kind}`, window };
  if (!writing) deferRateCharge(ctx);
  defer(ctx, () => db.prepare(`UPDATE connect_tokens SET last_used_at = ? WHERE id = ? AND ${LIVE_TOKEN}`).bind(now, row.id, hash, now).run());
}
// Work the response does not depend on is queued here and started by runConnect once the action
// is done: a write issued mid-request (e.g. last_used_at right after auth) would otherwise commit
// on the D1 primary concurrently with the snapshot read and hand its commit tail to that read.
function defer(ctx: ConnectContext, start: () => Promise<unknown>) {
  ctx.deferred.push(start);
}
// Started work runs after the response via waitUntil; without an execution context (tests,
// scripts) it is awaited before the response so nothing is silently dropped.
function startDeferred(ctx: ConnectContext): Promise<unknown>[] {
  const pending: Promise<unknown>[] = [];
  for (const start of ctx.deferred.splice(0)) {
    const tracked = Promise.resolve().then(start).catch((error: unknown) => { console.error("connect deferred write failed", error instanceof Error ? error.message : "unknown"); });
    if (typeof ctx.execution?.waitUntil === "function") ctx.execution.waitUntil(tracked); else pending.push(tracked);
  }
  return pending;
}

export type AccessUser = { email: string; sub: string };
async function manager(ctx: ConnectContext, user: AccessUser | undefined) {
  if (!user?.sub) throw new HttpError(401, "access_required", "Sign in with Cloudflare Access to manage connections.");
  requireSameOrigin(ctx.request);
  const principals = local(ctx.request, ctx.env) && user.sub === "dev" ? ["local:developer"]
    : [...(user.email.trim() ? [`email:${user.email.trim().toLowerCase()}`] : []), `subject:${user.sub}`];
  ctx.actor = principals.find((principal) => isManager(ctx.request, ctx.env, principal)) ?? `subject:${user.sub}`;
  if (!isManager(ctx.request, ctx.env, ctx.actor)) throw new HttpError(403, "manager_required", "Your Access identity is not configured as a Connect manager.");
  deployment(ctx.env);
  await rate(ctx.env.DB, `manager:${await fingerprint(ctx.actor)}`, CONNECT_LIMITS.managerPerMinute);
}
const redact = (value: string | null | undefined) => value?.replace(/steedc_[A-Za-z0-9_-]+/g, "[redacted]") ?? null;
export function auditStatement(ctx: ConnectContext, status: number, code: string | null = null, guard = "1") {
  return ctx.env.DB.prepare(`INSERT INTO connect_audit (request_id, token_id, target, actor, operation, status, code, created_at)
    SELECT ?, ?, ?, ?, ?, ?, ?, ? WHERE ${guard}`)
    .bind(ctx.requestId, redact(ctx.tokenId), "topology", redact(ctx.actor), ctx.operation, status, code, nowSeconds());
}
/**
 * The top-level code of a 422 validation failure: `secret_like_value` when every issue is a
 * secret-like hit, otherwise `invalid_topology`. Both are 422 with `issues[]`.
 */
export function topologyValidationCode(issues: readonly { code: string }[]): "invalid_topology" | "secret_like_value" {
  return issues.length > 0 && issues.every((issue) => issue.code === "secret_like_value") ? "secret_like_value" : "invalid_topology";
}

export async function runConnect(request: Request, env: ConnectEnv, mode: "bearer" | "manager", action: (ctx: ConnectContext) => Promise<Response>, user?: AccessUser, execution?: Pick<ExecutionContext, "waitUntil">, timing = new ServerTiming()): Promise<Response> {
  const result = await apiResponse(async (requestId) => {
    const ctx: ConnectContext = { request, env, requestId, actor: "anonymous", operation: `${mode}.request`, audited: false, execution, deferred: [], timing };
    let response: Response;
    let code: string | null = null;
    try {
      if (request.method === "OPTIONS" || request.headers.get("Sec-Fetch-Site") === "cross-site" ||
        (request.headers.has("Origin") && request.headers.get("Origin") !== new URL(request.url).origin)) throw new HttpError(403, "origin_denied", "Connect does not allow cross-origin browser requests.");
      await timing.time("auth", () => mode === "manager" ? manager(ctx, user) : bearer(ctx));
      response = await action(ctx);
    } catch (error) {
      if (error instanceof TopologyOperationError) {
        const invalid = error.code === "invalid_topology";
        code = invalid ? topologyValidationCode(error.issues) : error.code;
        response = Response.json({ error: { code, message: !invalid ? "The topology operation conflicts with the current graph."
          : code === "secret_like_value" ? "A value looks like a secret." : "Topology validation failed.",
          ...(invalid ? { issues: error.issues } : {}), requestId } }, { status: invalid ? 422 : 409 });
      } else {
        response = errorResponse(error, requestId);
        code = error instanceof HttpError ? error.code : response.status === 422 ? "invalid_document" : "unavailable";
      }
    }
    // Writes that never reached their D1 batch (412/422/validate/replay) still owe exactly one charge.
    deferRateCharge(ctx);
    if (!ctx.audited) defer(ctx, () => auditStatement(ctx, response.status, code).run());
    // With waitUntil deferred work runs after the response and is not timed; without it, it is awaited here.
    const pending = startDeferred(ctx);
    if (pending.length) await timing.time("audit", () => Promise.all(pending));
    return response;
  });
  // no-transform stops Cloudflare from compressing Connect JSON, which would weaken the ETag
  // (W/"topology:N") that clients echo back in If-Match.
  for (const [name, value] of Object.entries({ "Cache-Control": "no-store, no-transform", Pragma: "no-cache", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff", "Cross-Origin-Resource-Policy": "same-origin", "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'" })) result.headers.set(name, value);
  if (result.status === 401 && mode === "bearer") result.headers.set("WWW-Authenticate", 'Bearer realm="steed-connect"');
  if (result.status === 429) result.headers.set("Retry-After", "60");
  return request.method === "HEAD" ? new Response(null, { status: result.status, headers: result.headers }) : result;
}
export function requireToken(ctx: ConnectContext): TokenRow {
  if (!ctx.token) throw new HttpError(401, "invalid_token", "A Connect token is required.");
  return ctx.token;
}
export async function pruneConnect(db: D1Database) {
  const now = nowSeconds();
  await db.batch([
    db.prepare("DELETE FROM connect_confirmations WHERE expires_at <= ?").bind(now),
    db.prepare("DELETE FROM connect_rate_limits WHERE window < ?").bind(now - 120),
    db.prepare("UPDATE connect_requests SET response_json = NULL WHERE expires_at <= ? AND response_json IS NOT NULL").bind(now),
    db.prepare("DELETE FROM connect_audit WHERE created_at < ?").bind(now - CONNECT_LIMITS.auditDays * 86400),
    pruneTopologyHistoryStatement(db, now),
  ]);
}
