import { CONNECT_LIMITS, type ConnectScope, type ConnectToken } from "@steed/api/shared";
import { apiResponse, errorResponse, HttpError, requireSameOrigin } from "./http";
import { fingerprint } from "./connect-crypto";

export type ConnectEnv = Pick<Cloudflare.ProductionEnv, "DB"> & Pick<WorkerBindings, "CONNECT_DEPLOYMENT_ID" | "CONNECT_TOKEN_KEYS" | "CONNECT_MANAGERS" | "CF_ACCESS_DEV_BYPASS">;
export interface TokenRow {
  id: string; diagram_id: string | null; name: string; scope: ConnectScope; prefix: string;
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
  diagramId?: string | null;
  audited: boolean;
}
export const nowSeconds = () => Math.floor(Date.now() / 1000);
export const iso = (value: number | null) => value === null ? null : new Date(value * 1000).toISOString();
export const tokenMetadata = (row: TokenRow): ConnectToken => ({ id: row.id, diagramId: row.diagram_id, name: row.name, scope: row.scope, prefix: row.prefix,
  createdAt: new Date(row.created_at * 1000).toISOString(), expiresAt: iso(row.expires_at), lastUsedAt: iso(row.last_used_at), revokedAt: iso(row.revoked_at), version: row.version });
export function deployment(env: ConnectEnv): string {
  if (!env.CONNECT_DEPLOYMENT_ID) throw new HttpError(503, "connect_unconfigured", "Connect deployment identity is not configured.");
  return env.CONNECT_DEPLOYMENT_ID;
}
export const tokenContext = (env: ConnectEnv, row: TokenRow) => JSON.stringify(["token", deployment(env), row.id, row.diagram_id, row.scope, row.owner, row.expires_at]);
const local = (request: Request, env: ConnectEnv) => env.CF_ACCESS_DEV_BYPASS === "true" && env.CONNECT_DEPLOYMENT_ID === "steed-development" && ["127.0.0.1", "localhost", "[::1]"].includes(new URL(request.url).hostname);
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

async function bearer(ctx: ConnectContext) {
  const credential = /^Bearer (steedc_[A-Za-z0-9_-]{43})$/i.exec(ctx.request.headers.get("Authorization") ?? "")?.[1];
  if (!credential) throw new HttpError(401, "invalid_token", "A valid Connect Bearer token is required.");
  const hash = await fingerprint(`${deployment(ctx.env)}:${credential}`);
  const row = await ctx.env.DB.prepare("SELECT * FROM connect_tokens WHERE token_hash = ?").bind(hash).first<TokenRow>();
  if (!row || row.revoked_at !== null || (row.expires_at !== null && row.expires_at <= nowSeconds())) throw new HttpError(401, "invalid_token", "The token is invalid, expired or revoked.");
  ctx.token = row; ctx.tokenId = row.id; ctx.diagramId = row.diagram_id; ctx.actor = `token:${row.id}`;
  if (!isManager(ctx.request, ctx.env, row.owner)) throw new HttpError(403, "authorization_revoked", "The issuing manager is no longer authorized.");
  const writing = !["GET", "HEAD"].includes(ctx.request.method);
  if (writing && row.scope !== "write") throw new HttpError(403, "insufficient_scope", "A write token is required.");
  await rate(ctx.env.DB, `token:${row.id}:${writing ? "write" : "read"}`, writing ? CONNECT_LIMITS.writePerMinute : CONNECT_LIMITS.readPerMinute);
  await ctx.env.DB.prepare("UPDATE connect_tokens SET last_used_at = ? WHERE id = ? AND token_hash = ? AND revoked_at IS NULL").bind(nowSeconds(), row.id, hash).run();
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
  return ctx.env.DB.prepare(`INSERT INTO connect_audit (request_id, token_id, diagram_id, actor, operation, status, code, created_at)
    SELECT ?, ?, ?, ?, ?, ?, ?, ? WHERE ${guard}`)
    .bind(ctx.requestId, redact(ctx.tokenId), redact(ctx.diagramId), redact(ctx.actor), ctx.operation, status, code, nowSeconds());
}
export async function runConnect(request: Request, env: ConnectEnv, mode: "bearer" | "manager", action: (ctx: ConnectContext) => Promise<Response>, user?: AccessUser): Promise<Response> {
  const result = await apiResponse(async (requestId) => {
    const ctx: ConnectContext = { request, env, requestId, actor: "anonymous", operation: `${mode}.request`, audited: false };
    let response: Response;
    let code: string | null = null;
    try {
      if (request.method === "OPTIONS" || request.headers.get("Sec-Fetch-Site") === "cross-site" ||
        (request.headers.has("Origin") && request.headers.get("Origin") !== new URL(request.url).origin)) throw new HttpError(403, "origin_denied", "Connect does not allow cross-origin browser requests.");
      if (mode === "manager") await manager(ctx, user); else await bearer(ctx);
      response = await action(ctx);
    } catch (error) {
      response = errorResponse(error, requestId);
      code = error instanceof HttpError ? error.code : response.status === 422 ? "invalid_document" : "unavailable";
    }
    if (!ctx.audited) await auditStatement(ctx, response.status, code).run();
    return response;
  });
  for (const [name, value] of Object.entries({ Pragma: "no-cache", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff", "Cross-Origin-Resource-Policy": "same-origin", "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'" })) result.headers.set(name, value);
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
  ]);
}
