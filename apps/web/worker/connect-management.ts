import { z } from "zod";
import { CONNECT_LIMITS, diagramEtag, diagramIdSchema, sensitiveActionSchema, tokenInputSchema, tokenNameSchema, type ConnectAudit, type ConnectTarget } from "@steed/api/shared";
import { diagramListQuery } from "./diagram-api";
import { getDiagram } from "./diagram-store";
import { HttpError, readJson } from "./http";
import { auditStatement, deployment, iso, nowSeconds, pruneConnect, runConnect, tokenContext, tokenMetadata, type AccessUser, type ConnectContext, type ConnectEnv, type TokenRow } from "./connect";
import { fingerprint, randomSecret, seal, unseal } from "./connect-crypto";
import { connectOpenApi } from "./connect-contract";

const listQuery = diagramListQuery.extend({ diagramId: diagramIdSchema.or(z.literal("")).default("") });
const body = (request: Request) => readJson(request, 8192);
const json = (ctx: ConnectContext, data: unknown, status = 200, headers?: HeadersInit) => Response.json({ data, requestId: ctx.requestId }, { status, headers });
async function secretFields(env: ConnectEnv, row: TokenRow) {
  const plaintext = `steedc_${randomSecret()}`;
  return { token_hash: await fingerprint(`${deployment(env)}:${plaintext}`), ciphertext: await seal(env.CONNECT_TOKEN_KEYS, tokenContext(env, row), plaintext), prefix: `${plaintext.slice(0, 13)}…` };
}
function expectVersion(request: Request, row: TokenRow) {
  if (!request.headers.has("If-Match")) throw new HttpError(428, "precondition_required", "Send the current token ETag in If-Match.");
  if (request.headers.get("If-Match") !== diagramEtag(row.id, row.version) || request.headers.has("If-None-Match")) throw new HttpError(412, "version_conflict", "The token changed. Refresh the list and confirm again.");
  if (row.revoked_at !== null) throw new HttpError(409, "token_revoked", "This token has already been revoked.");
}
async function create(ctx: ConnectContext) {
  ctx.operation = "tokens.create";
  const input = tokenInputSchema.parse(await body(ctx.request));
  const expires = input.expiresAt === null ? null : Math.floor(Date.parse(input.expiresAt) / 1000);
  if (expires !== null && expires <= nowSeconds()) throw new HttpError(422, "invalid_expiry", "Expiry must be in the future.");
  if (input.diagramId) await getDiagram(ctx.env.DB, input.diagramId);
  const row: TokenRow = { id: crypto.randomUUID(), diagram_id: input.diagramId, name: input.name, scope: input.scope, prefix: "", token_hash: null, ciphertext: null,
    owner: ctx.actor, version: 1, created_at: nowSeconds(), expires_at: expires, last_used_at: null, revoked_at: null };
  Object.assign(row, await secretFields(ctx.env, row));
  ctx.tokenId = row.id; ctx.diagramId = row.diagram_id;
  const results = await ctx.env.DB.batch<TokenRow>([
    ctx.env.DB.prepare(`INSERT INTO connect_tokens (id, diagram_id, name, scope, prefix, token_hash, ciphertext, owner, created_at, expires_at)
      SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE
      (SELECT count(*) FROM connect_tokens WHERE diagram_id IS ? AND revoked_at IS NULL) < ?
      AND (? IS NULL OR EXISTS (SELECT 1 FROM diagrams WHERE id = ? AND deleted_at IS NULL)) RETURNING *`)
      .bind(row.id, row.diagram_id, row.name, row.scope, row.prefix, row.token_hash, row.ciphertext, row.owner, row.created_at, row.expires_at,
        row.diagram_id, CONNECT_LIMITS.tokensPerTarget, row.diagram_id, row.diagram_id),
    auditStatement(ctx, 201, null, "changes() = 1"),
  ]);
  if (!results[0]?.results[0]) throw new HttpError(422, "target_unavailable", "The target was removed or has 50 non-revoked tokens. Refresh and revoke an unused token.");
  ctx.audited = true;
  return json(ctx, tokenMetadata(row), 201, { ETag: diagramEtag(row.id, 1) });
}

async function tokenAction(ctx: ConnectContext, id: string, action: string | undefined) {
  const row = await ctx.env.DB.prepare("SELECT * FROM connect_tokens WHERE id = ?").bind(id).first<TokenRow>();
  if (!row) throw new HttpError(404, "not_found", "Token not found.");
  ctx.tokenId = row.id; ctx.diagramId = row.diagram_id;
  if (!action && ["GET", "HEAD"].includes(ctx.request.method)) {
    ctx.operation = "tokens.get";
    return json(ctx, tokenMetadata(row), 200, { ETag: diagramEtag(row.id, row.version) });
  }
  expectVersion(ctx.request, row);
  if (!action && ctx.request.method === "PATCH") {
    ctx.operation = "tokens.rename";
    const input = z.strictObject({ name: tokenNameSchema }).parse(await body(ctx.request));
    const result = await ctx.env.DB.batch<TokenRow>([
      ctx.env.DB.prepare("UPDATE connect_tokens SET name = ?, version = version + 1 WHERE id = ? AND version = ? AND revoked_at IS NULL RETURNING *").bind(input.name, row.id, row.version),
      auditStatement(ctx, 200, null, "changes() = 1"),
    ]);
    const updated = result[0]?.results[0];
    if (!updated) throw new HttpError(412, "version_conflict", "The token changed. Refresh the list.");
    ctx.audited = true;
    return json(ctx, tokenMetadata(updated), 200, { ETag: diagramEtag(row.id, updated.version) });
  }
  if (ctx.request.method !== "POST") throw new HttpError(405, "method_not_allowed", "This method is not supported.");
  if (action === "challenge") {
    ctx.operation = "tokens.challenge";
    const input = z.strictObject({ action: sensitiveActionSchema }).parse(await body(ctx.request));
    const challenge = randomSecret();
    const expires = nowSeconds() + CONNECT_LIMITS.challengeSeconds;
    const result = await ctx.env.DB.batch([
      ctx.env.DB.prepare(`INSERT INTO connect_confirmations (challenge_hash, token_id, token_version, principal, action, expires_at)
        SELECT ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM connect_tokens WHERE id = ? AND version = ? AND revoked_at IS NULL)`)
        .bind(await fingerprint(challenge), row.id, row.version, ctx.actor, input.action, expires, row.id, row.version),
      auditStatement(ctx, 200, null, "changes() = 1"),
    ]);
    if (result[0]?.meta.changes !== 1) throw new HttpError(412, "version_conflict", "The token changed. Refresh the list.");
    ctx.audited = true;
    return json(ctx, { challenge, expiresAt: iso(expires) });
  }
  const kind = sensitiveActionSchema.parse(action);
  ctx.operation = `tokens.${kind}`;
  const input = z.strictObject({ challenge: z.string().regex(/^[A-Za-z0-9_-]{43}$/), confirmation: z.string().max(64) }).parse(await body(ctx.request));
  if (input.confirmation !== row.name) throw new HttpError(403, "confirmation_required", "Type the token name exactly to confirm this action.");
  if (kind !== "revoke" && row.expires_at !== null && row.expires_at <= nowSeconds()) throw new HttpError(409, "token_expired", "This token has expired. Create a new token.");
  const consume = ctx.env.DB.prepare(`DELETE FROM connect_confirmations WHERE challenge_hash = ? AND token_id = ? AND token_version = ? AND principal = ? AND action = ?
    AND expires_at > unixepoch() AND EXISTS (SELECT 1 FROM connect_tokens WHERE id = ? AND version = ? AND revoked_at IS NULL)`)
    .bind(await fingerprint(input.challenge), row.id, row.version, ctx.actor, kind, row.id, row.version);
  if (kind === "reveal") {
    const plaintext = await unseal(ctx.env.CONNECT_TOKEN_KEYS, tokenContext(ctx.env, row), row.ciphertext ?? "");
    const result = await ctx.env.DB.batch([consume, auditStatement(ctx, 200, null, "changes() = 1")]);
    if (result[0]?.meta.changes !== 1) throw new HttpError(403, "confirmation_expired", "The confirmation expired or was already used. Confirm again.");
    ctx.audited = true;
    return json(ctx, { token: plaintext, hideAfterSeconds: CONNECT_LIMITS.revealSeconds });
  }
  const values = kind === "rotate" ? await secretFields(ctx.env, row) : null;
  const statement = values
    ? ctx.env.DB.prepare(`UPDATE connect_tokens SET token_hash = ?, ciphertext = ?, prefix = ?, last_used_at = NULL, version = version + 1
        WHERE id = ? AND version = ? AND revoked_at IS NULL AND changes() = 1 RETURNING *`).bind(values.token_hash, values.ciphertext, values.prefix, row.id, row.version)
    : ctx.env.DB.prepare(`UPDATE connect_tokens SET token_hash = NULL, ciphertext = NULL, revoked_at = unixepoch(), version = version + 1
        WHERE id = ? AND version = ? AND revoked_at IS NULL AND changes() = 1 RETURNING *`).bind(row.id, row.version);
  const result = await ctx.env.DB.batch<TokenRow>([consume, statement, auditStatement(ctx, 200, null, "changes() = 1")]);
  const updated = result[1]?.results[0];
  if (!updated) throw new HttpError(403, "confirmation_expired", "The confirmation expired or the token changed. Refresh and confirm again.");
  ctx.audited = true;
  return json(ctx, tokenMetadata(updated), 200, { ETag: diagramEtag(row.id, updated.version) });
}

export function connectManagementApi(request: Request, env: ConnectEnv, user?: AccessUser) {
  return runConnect(request, env, "manager", async (ctx) => {
    const url = new URL(request.url);
    const path = url.pathname;
    const reading = request.method === "GET" || request.method === "HEAD";
    if (path === "/api/connect/openapi.json" && reading) {
      z.strictObject({}).parse(Object.fromEntries(url.searchParams));
      ctx.operation = "management.openapi";
      return Response.json(connectOpenApi(url.origin), { headers: { "Content-Disposition": "attachment; filename=steed-connect-openapi.json" } });
    }
    if (path === "/api/connect" && reading) {
      z.strictObject({}).parse(Object.fromEntries(url.searchParams));
      ctx.operation = "management.info";
      await pruneConnect(env.DB);
      return json(ctx, { apiBaseUrl: `${url.origin}/api/v1`, limits: CONNECT_LIMITS });
    }
    if (path === "/api/connect/diagrams" && reading) {
      ctx.operation = "management.diagrams.list";
      const query = diagramListQuery.parse(Object.fromEntries(url.searchParams));
      const result = await env.DB.prepare(`SELECT id, title, deleted_at IS NOT NULL AS deleted FROM diagrams
        WHERE id > ? AND (deleted_at IS NULL OR EXISTS (SELECT 1 FROM connect_tokens WHERE diagram_id = diagrams.id)) ORDER BY id LIMIT ?`)
        .bind(query.cursor, query.limit + 1).all<Omit<ConnectTarget, "deleted"> & { deleted: number }>();
      const data = result.results.slice(0, query.limit).map((row) => ({ ...row, deleted: Boolean(row.deleted) }));
      return Response.json({ data, nextCursor: result.results.length > query.limit ? data.at(-1)?.id ?? null : null, requestId: ctx.requestId });
    }
    if (path === "/api/connect/tokens") {
      if (request.method === "POST") {
        z.strictObject({}).parse(Object.fromEntries(url.searchParams));
        return create(ctx);
      }
      if (reading) {
        ctx.operation = "tokens.list";
        const query = listQuery.parse(Object.fromEntries(url.searchParams));
        ctx.diagramId = query.diagramId || null;
        const result = await env.DB.prepare("SELECT * FROM connect_tokens WHERE diagram_id IS ? AND id > ? ORDER BY id LIMIT ?")
          .bind(ctx.diagramId, query.cursor, query.limit + 1).all<TokenRow>();
        const data = result.results.slice(0, query.limit).map(tokenMetadata);
        return Response.json({ data, nextCursor: result.results.length > query.limit ? data.at(-1)?.id ?? null : null, requestId: ctx.requestId });
      }
    }
    if (path === "/api/connect/audit" && reading) {
      ctx.operation = "audit.list";
      const query = z.strictObject({ diagramId: diagramIdSchema.or(z.literal("")).default(""), limit: z.coerce.number().int().min(1).max(100).default(50), cursor: z.coerce.number().int().min(1).max(Number.MAX_SAFE_INTEGER).default(Number.MAX_SAFE_INTEGER) }).parse(Object.fromEntries(url.searchParams));
      ctx.diagramId = query.diagramId || null;
      const result = await env.DB.prepare(`SELECT id, request_id AS requestId, diagram_id AS diagramId, token_id AS tokenId, actor, operation, status, code, created_at AS createdAt
        FROM connect_audit WHERE diagram_id IS ? AND id < ? ORDER BY id DESC LIMIT ?`).bind(ctx.diagramId, query.cursor, query.limit + 1).all<Omit<ConnectAudit, "createdAt"> & { createdAt: number }>();
      const data = result.results.slice(0, query.limit).map((row) => ({ ...row, createdAt: iso(row.createdAt) }));
      return Response.json({ data, nextCursor: result.results.length > query.limit ? String(data.at(-1)?.id) : null, requestId: ctx.requestId });
    }
    const match = /^\/api\/connect\/tokens\/([^/]+)(?:\/([^/]+))?$/.exec(path);
    if (match) {
      z.strictObject({}).parse(Object.fromEntries(url.searchParams));
      return tokenAction(ctx, diagramIdSchema.parse(match[1]), match[2]);
    }
    throw new HttpError(404, "not_found", "Connect management route not found.");
  }, user);
}
