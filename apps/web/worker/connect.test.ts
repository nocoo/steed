import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CONNECT_OPERATIONS, diagramSchema, type ConnectToken, type DiagramRecord } from "@steed/api/shared";
import example from "../../../examples/service-platform.json";
import { connectMachineApi } from "./connect-api";
import { connectManagementApi } from "./connect-management";
import { fingerprint, randomSecret } from "./connect-crypto";
import { nowSeconds, type ConnectEnv, type TokenRow } from "./connect";
import { getDiagram, putDiagram } from "./diagram-store";
import { testDatabase } from "./__tests__/db";

const origin = "https://steed.example.com";
const user = { email: "manager@example.com", sub: "human" };
let database: ReturnType<typeof testDatabase>;
let env: ConnectEnv;
beforeEach(async () => {
  database = testDatabase();
  env = { DB: database.db, CONNECT_DEPLOYMENT_ID: "steed-test", CONNECT_MANAGERS: "email:manager@example.com", CONNECT_TOKEN_KEYS: JSON.stringify({ active: "test", keys: { test: randomSecret() } }) };
  await putDiagram(database.db, "example", diagramSchema.parse(example), null);
});
afterEach(() => { vi.restoreAllMocks(); database.close(); });
const parse = async <T>(response: Response) => await response.json() as T;
const make = (path: string, method: string, value?: unknown, headers: Record<string, string> = {}) => new Request(`${origin}${path}`, {
  method, headers: { "Content-Type": "application/json", ...headers },
  ...(value === undefined ? {} : { body: typeof value === "string" ? value : JSON.stringify(value) }),
});
const manage = (path = "", method = "GET", value?: unknown, headers: Record<string, string> = {}) => connectManagementApi(make(`/api/connect${path}`, method, value, { Origin: origin, "X-Steed-Request": "1", ...headers }), env, user);
const api = (credential: string, path = "/diagrams/example", method = "GET", value?: unknown, headers: Record<string, string> = {}) => connectMachineApi(make(`/api/v1${path}`, method, value, { Authorization: `Bearer ${credential}`, ...headers }), env);
const version = (token: ConnectToken) => ({ "If-Match": `"${token.id}:${token.version}"` });
async function createToken(scope: "read" | "write" = "write", diagramId: string | null = null) {
  const response = await manage("/tokens", "POST", { name: "Test agent", scope, diagramId });
  expect(response.status).toBe(201);
  return (await parse<{ data: ConnectToken }>(response)).data;
}
async function challenge(token: ConnectToken, action = "reveal") {
  const response = await manage(`/tokens/${token.id}/challenge`, "POST", { action }, version(token));
  expect(response.status).toBe(200);
  return (await parse<{ data: { challenge: string } }>(response)).data.challenge;
}
async function reveal(token: ConnectToken) {
  const response = await manage(`/tokens/${token.id}/reveal`, "POST", { challenge: await challenge(token), confirmation: token.name }, version(token));
  expect(response.status).toBe(200);
  return (await parse<{ data: { token: string } }>(response)).data.token;
}
async function credentials(scope: "read" | "write" = "write", diagramId: string | null = null) {
  const token = await createToken(scope, diagramId);
  return { token, credential: await reveal(token) };
}
const writeHeaders = (key = "intent-0001", revision = 1) => ({ "If-Match": `"example:${revision}"`, "Idempotency-Key": key });
const stored = () => getDiagram(database.db, "example");

describe("Connect credentials and authorization", () => {
  it.each([
    ["https://steed.dev.hexly.ai", "true", "steed-development", 200],
    ["https://steed.dev.hexly.ai", undefined, "steed-development", 403],
    ["https://steed.dev.hexly.ai", "true", "steed-production", 403],
    ["https://steed.hexly.ai", "true", "steed-development", 403],
  ] as const)("guards the local manager at %s (bypass %s, deployment %s)", async (origin, bypass, deployment, status) => {
    const response = await connectManagementApi(new Request(`${origin}/api/connect`, { headers: { Origin: origin } }), {
      ...env, CF_ACCESS_DEV_BYPASS: bypass, CONNECT_DEPLOYMENT_ID: deployment, CONNECT_MANAGERS: "local:developer",
    }, { email: "dev@local", sub: "dev" });
    expect(response.status).toBe(status);
  });

  it("creates metadata, encrypts repeat-reveal credentials, and enforces read scope", async () => {
    const { token, credential } = await credentials("read");
    expect(credential).toMatch(/^steedc_[A-Za-z0-9_-]{43}$/);
    expect(token.expiresAt).toBeNull(); expect(JSON.stringify(token)).not.toContain(credential);
    const row = database.sqlite.prepare("SELECT * FROM connect_tokens WHERE id = ?").get(token.id);
    expect(JSON.stringify(row)).not.toContain(credential);
    expect(row?.ciphertext).toMatch(/^1\.test\./); expect(row?.token_hash).toBe(await fingerprint(`steed-test:${credential}`));
    expect(await reveal(token)).toBe(credential);
    const capability = await parse<{ token: { diagramId: string | null }; operations: { write: boolean }[] }>(await api(credential, "/capabilities"));
    expect(capability.token.diagramId).toBeNull(); expect(capability.operations.every((operation) => !operation.write)).toBe(true);
    expect((await api(credential, "/diagrams/example", "PUT", example, writeHeaders())).status).toBe(403);
    const head = await api(credential, "/diagrams/example", "HEAD");
    expect(head.status).toBe(200); expect(await head.text()).toBe(""); expect(head.headers.get("ETag")).toBe('"example:1"');
    expect(database.sqlite.prepare("SELECT last_used_at FROM connect_tokens WHERE id = ?").get(token.id)?.last_used_at).toBeTypeOf("number");
    const audit = JSON.stringify(database.sqlite.prepare("SELECT * FROM connect_audit").all());
    expect(audit).not.toContain(credential); expect(audit).not.toContain("Authorization"); expect(audit).not.toContain("ciphertext");
  });

  it("binds confirmations to manager, action and token version, and consumes them only once", async () => {
    const token = await createToken(); const proof = await challenge(token);
    expect((await manage(`/tokens/${token.id}/reveal`, "POST", { challenge: proof, confirmation: "Wrong name" }, version(token))).status).toBe(403);
    const body = { challenge: proof, confirmation: token.name };
    const attempts = await Promise.all([manage(`/tokens/${token.id}/reveal`, "POST", body, version(token)), manage(`/tokens/${token.id}/reveal`, "POST", body, version(token))]);
    expect(attempts.map((result) => result.status).sort()).toEqual([200, 403]);
    expect((await manage(`/tokens/${token.id}/rotate`, "POST", { challenge: await challenge(token), confirmation: token.name }, version(token))).status).toBe(403);
    const anotherProof = await challenge(token);
    env.CONNECT_MANAGERS += ",email:other@example.com";
    const otherUser = { email: "other@example.com", sub: "other" };
    expect((await connectManagementApi(make(`/api/connect/tokens/${token.id}/reveal`, "POST", { challenge: anotherProof, confirmation: token.name }, { Origin: origin, "X-Steed-Request": "1", ...version(token) }), env, otherUser)).status).toBe(403);
    database.sqlite.exec("UPDATE connect_confirmations SET expires_at = 1");
    expect((await manage(`/tokens/${token.id}/reveal`, "POST", { challenge: anotherProof, confirmation: token.name }, version(token))).status).toBe(403);
  });

  it("renames optimistically, rotates immediately, and irreversibly revokes ciphertext", async () => {
    let { token, credential } = await credentials();
    const old = token; const staleChallenge = await challenge(token);
    const renamed = await manage(`/tokens/${token.id}`, "PATCH", { name: "Renamed agent" }, version(token));
    expect(renamed.status).toBe(200); token = (await parse<{ data: ConnectToken }>(renamed)).data;
    expect(token.version).toBe(2); expect(await reveal(token)).toBe(credential);
    expect((await manage(`/tokens/${old.id}/reveal`, "POST", { challenge: staleChallenge, confirmation: old.name }, version(old))).status).toBe(412);
    expect((await manage(`/tokens/${token.id}`, "PATCH", { scope: "read" }, version(token))).status).toBe(422);
    const rotated = await manage(`/tokens/${token.id}/rotate`, "POST", { challenge: await challenge(token, "rotate"), confirmation: token.name }, version(token));
    expect(rotated.status).toBe(200); token = (await parse<{ data: ConnectToken }>(rotated)).data;
    expect(token.lastUsedAt).toBeNull(); expect((await api(credential)).status).toBe(401);
    const replacement = await reveal(token); expect(replacement).not.toBe(credential); credential = replacement;
    expect((await api(credential)).status).toBe(200);
    const revoked = await manage(`/tokens/${token.id}/revoke`, "POST", { challenge: await challenge(token, "revoke"), confirmation: token.name }, version(token));
    expect(revoked.status).toBe(200); token = (await parse<{ data: ConnectToken }>(revoked)).data;
    expect(token.revokedAt).toBeTruthy(); expect((await api(credential)).status).toBe(401);
    expect(database.sqlite.prepare("SELECT ciphertext, token_hash FROM connect_tokens WHERE id = ?").get(token.id)).toMatchObject({ ciphertext: null, token_hash: null });
    expect((await manage(`/tokens/${token.id}/challenge`, "POST", { action: "reveal" }, version(token))).status).toBe(409);
    expect((await manage(`/tokens/${token.id}`, "HEAD")).status).toBe(200);
  });

  it("requires explicit current manager authority and never accepts Bearer for management", async () => {
    const { credential } = await credentials();
    expect((await connectManagementApi(make("/api/connect", "GET", undefined, { Authorization: `Bearer ${credential}` }), env)).status).toBe(401);
    expect((await connectManagementApi(make("/api/connect", "GET", undefined, { "Cf-Access-Authenticated-User-Email": user.email }), env, { email: "other@example.com", sub: "other" })).status).toBe(403);
    const service = { email: "", sub: "service-subject" };
    expect((await connectManagementApi(make("/api/connect", "GET"), env, service)).status).toBe(403);
    env.CONNECT_MANAGERS = "subject:service-subject";
    expect((await connectManagementApi(make("/api/connect", "GET"), env, service)).status).toBe(200);
    expect((await connectManagementApi(make("/api/connect", "GET"), env, { ...service, email: "also-present@example.com" })).status).toBe(200);
    expect((await api(credential)).status).toBe(403);
    env.CONNECT_MANAGERS = "";
    expect((await manage()).status).toBe(403);
  });

  it("confines a bound credential to its canonical diagram, including lists and validation", async () => {
    await putDiagram(database.db, "other", diagramSchema.parse(example), null);
    const { credential } = await credentials("write", "example");
    const list = await parse<{ data: { id: string }[] }>(await api(credential, "/diagrams"));
    expect(list.data.map((item) => item.id)).toEqual(["example"]);
    for (const [method, suffix] of [["GET", ""], ["PUT", ""], ["DELETE", ""], ["GET", "/nodes"], ["POST", "/validate"], ["POST", "/operations"]]) {
      expect((await api(credential, `/diagrams/other${suffix}`, method!, method === "GET" || method === "DELETE" ? undefined : example, writeHeaders())).status).toBe(404);
    }
    expect((await api(credential, "/diagrams?diagramId=other")).status).toBe(422);
    expect((await api("legacy-key")).status).toBe(401);
    expect((await api("", "/capabilities", "GET", undefined, { Cookie: "CF_Authorization=pretend" })).status).toBe(401);
    expect((await api(credential, "/diagrams/example", "OPTIONS")).status).toBe(403);
    expect((await api(credential, "/diagrams/example", "GET", undefined, { Origin: "https://attacker.example" })).status).toBe(403);
    expect((await api(credential, "/diagrams/example", "GET", undefined, { "Sec-Fetch-Site": "cross-site" })).status).toBe(403);
  });

  it("rejects invalid/expired credentials and malformed management requests without exposing secrets", async () => {
    expect((await manage("/tokens", "POST", { name: "Bad", scope: "read", expiresAt: "2020-01-01T00:00:00Z" })).status).toBe(422);
    expect((await manage("/tokens", "POST", { name: "steedc_do-not-store", scope: "read" })).status).toBe(422);
    expect((await manage("/tokens", "POST", { name: "Bad", scope: "admin" })).status).toBe(422);
    expect((await manage("/tokens", "POST", { name: "Bad", scope: "read", diagramId: "missing" })).status).toBe(404);
    expect((await manage("/tokens", "POST", {}, { Origin: "" })).status).toBe(403);
    expect((await manage("/tokens", "POST", {}, { "X-Steed-Request": "" })).status).toBe(403);
    expect((await manage("/tokens", "POST", "{}", { "Content-Type": "text/plain" })).status).toBe(415);
    expect((await manage("/tokens", "POST", "x".repeat(8193))).status).toBe(413);
    expect((await manage("/unknown")).status).toBe(404);
    const { token, credential } = await credentials();
    database.sqlite.prepare("UPDATE connect_tokens SET expires_at = ? WHERE id = ?").run(nowSeconds() - 1, token.id);
    expect((await api(credential)).status).toBe(401);
    expect((await manage(`/tokens/${token.id}/reveal`, "POST", { challenge: await challenge(token), confirmation: token.name }, version(token))).status).toBe(409);
    env.CONNECT_TOKEN_KEYS = undefined;
    const failure = await manage("/tokens", "POST", { name: "No key", scope: "read" });
    expect(failure.status).toBe(503); expect(await failure.text()).not.toContain(credential);
    env.CONNECT_DEPLOYMENT_ID = undefined;
    expect((await manage()).status).toBe(503);
  });
});

describe("Connect graph transactions", () => {
  it("writes once under concurrent identical retries and returns durable original receipts", async () => {
    const { token, credential } = await credentials(); const next = { ...example, title: "Updated by agent" };
    const headers = writeHeaders();
    const results = await Promise.all([api(credential, "/diagrams/example", "PUT", next, headers), api(credential, "/diagrams/example", "PUT", next, headers)]);
    expect(results.map((result) => result.status)).toEqual([200, 200]);
    expect(results.some((result) => result.headers.get("Idempotency-Replayed") === "true")).toBe(true);
    expect((await stored()).revision).toBe(2);
    const bodies = await Promise.all(results.map((result) => result.json())); expect(bodies[0]).toEqual(bodies[1]);
    expect(bodies[0]).not.toHaveProperty("data.document");
    const replay = await api(credential, "/diagrams/example", "PUT", next, headers);
    expect(replay.headers.get("ETag")).toBe('"example:2"'); expect(replay.headers.get("X-Original-Request-Id")).toBeTruthy();
    expect((await api(credential, "/diagrams/example", "PUT", { ...next, title: "Different intent" }, headers)).status).toBe(409);
    const outcome = await parse<{ data: { state: string; httpStatus: number } }>(await api(credential, "/requests/intent-0001"));
    expect(outcome.data).toMatchObject({ state: "completed", httpStatus: 200 });
    const another = await credentials(); expect((await api(another.credential, "/requests/intent-0001")).status).toBe(404);
    expect(database.sqlite.prepare("SELECT count(*) AS n FROM connect_requests WHERE token_id = ?").get(token.id)?.n).toBe(1);
  });

  it("compares revisions atomically with independent intents and browser edits", async () => {
    const { credential } = await credentials();
    const responses = await Promise.all(["First", "Second"].map((title, index) => api(credential, "/diagrams/example", "PUT", { ...example, title }, writeHeaders(`intent-000${index}`))));
    expect(responses.map((result) => result.status).sort()).toEqual([200, 412]); expect((await stored()).revision).toBe(2);
    await putDiagram(database.db, "example", diagramSchema.parse({ ...example, title: "Browser edit" }), 2);
    expect((await api(credential, "/diagrams/example", "PUT", example, writeHeaders("intent-browser", 2))).status).toBe(412);
    expect((await stored()).document.title).toBe("Browser edit");
    expect((await api(credential, "/diagrams/example", "PUT", example, { "Idempotency-Key": "intent-missing" })).status).toBe(428);
    expect((await api(credential, "/diagrams/example", "PUT", example, { "If-Match": '"example:3"' })).status).toBe(428);
  });

  it("creates, exports, deletes, and replays deletion without resurrecting a diagram", async () => {
    const { credential } = await credentials();
    const creation = await api(credential, "/diagrams/new-diagram", "PUT", example, { "If-None-Match": "*", "Idempotency-Key": "intent-create" });
    expect(creation.status).toBe(201); expect(creation.headers.get("Location")).toBe("/api/v1/diagrams/new-diagram");
    const exported = await api(credential, "/diagrams/new-diagram/export"); expect(await exported.json()).toEqual(diagramSchema.parse(example));
    const { credential: bound } = await credentials("write", "new-diagram");
    const headers = { "If-Match": '"new-diagram:1"', "Idempotency-Key": "intent-delete", "X-Steed-Confirm": "new-diagram" };
    expect((await api(bound, "/diagrams/new-diagram", "DELETE", undefined, { ...headers, "X-Steed-Confirm": "" })).status).toBe(428);
    expect((await api(bound, "/diagrams/new-diagram", "DELETE", " ", headers)).status).toBe(400);
    expect((await api(bound, "/diagrams/new-diagram", "DELETE", undefined, headers)).status).toBe(204);
    expect((await api(bound, "/diagrams/new-diagram", "DELETE", undefined, headers)).headers.get("Idempotency-Replayed")).toBe("true");
    expect((await api(bound, "/requests/intent-delete")).status).toBe(200);
    expect((await api(bound, "/diagrams/new-diagram")).status).toBe(404);
    const targets = await parse<{ data: { id: string; deleted: boolean }[] }>(await manage("/diagrams"));
    expect(targets.data.find((target) => target.id === "new-diagram")?.deleted).toBe(true);
    expect((await manage("/tokens", "POST", { name: "Unavailable", scope: "read", diagramId: "new-diagram" })).status).toBe(404);
    expect((await api(credential, "/diagrams/new-diagram", "PUT", example, { "If-None-Match": "*", "Idempotency-Key": "intent-recreate" })).status).toBe(412);
  });

  it("applies graph operations as one validated document and keeps invalid batches out of storage", async () => {
    const { credential } = await credentials();
    const before = await stored();
    const invalid = { operations: [{ op: "remove_node", id: "api" }, { op: "put_edge", value: { id: "dangling", source: "missing", target: "db" } }] };
    expect((await api(credential, "/diagrams/example/operations", "POST", invalid, { ...writeHeaders(), "X-Steed-Confirm": "example" })).status).toBe(422);
    expect(await stored()).toEqual(before);
    const operations = [
      { op: "set_metadata", title: "Agent layout", description: "Reviewed" },
      { op: "put_node", value: { id: "queue", kind: "service", label: "Queue", position: { x: 800, y: 600 }, groupId: "new-group" } },
      { op: "put_group", value: { id: "new-group", label: "Queue boundary", parentId: "cloud" } },
      { op: "put_edge", value: { id: "queue-edge", source: "api", target: "queue", evidence: "inferred", route: { waypoints: [{ x: 650, y: 300 }] } } },
      { op: "put_view", value: { id: "new-view", label: "Queue path", nodeIds: ["api", "queue"], showBoundaries: false, routes: { "queue-edge": { labelPosition: { x: 700, y: 300 } } } } },
    ];
    expect((await api(credential, "/diagrams/example/operations", "POST", { operations }, writeHeaders())).status).toBe(200);
    const saved = await stored(); expect(saved.revision).toBe(2); expect(saved.document.title).toBe("Agent layout"); expect(saved.nodeCount).toBe(7);
    expect((await api(credential, "/diagrams/example/validate", "POST", saved.document)).status).toBe(200); expect((await stored()).revision).toBe(2);
    const remove = { operations: [{ op: "remove_group", id: "new-group" }, { op: "remove_node", id: "queue" }, { op: "remove_view", id: "new-view" }] };
    expect((await api(credential, "/diagrams/example/operations", "POST", remove, { ...writeHeaders("intent-remove", 2), "X-Steed-Confirm": "example" })).status).toBe(200);
    expect((await stored()).edgeCount).toBe(6);
  });

  it.each([
    ["nodes", { id: "new", label: "New", kind: "service", position: { x: 1, y: 2 } }],
    ["edges", { id: "new", source: "client", target: "db", evidence: "inferred" }],
    ["groups", { id: "new", label: "New boundary", parentId: "cloud" }],
    ["views", { id: "new", label: "New view", nodeIds: ["client"] }],
  ] as const)("reads, paginates, replaces and removes %s through the documented routes", async (collection, value) => {
    const { credential } = await credentials();
    const path = `/diagrams/example/${collection}`;
    const list = await api(credential, `${path}?limit=1`); expect(list.status).toBe(200);
    const first = await parse<{ data: { id: string }[]; nextCursor: string | null }>(list);
    expect(first.data).toHaveLength(1);
    if (first.nextCursor) expect((await api(credential, `${path}?limit=1&cursor=${first.nextCursor}`)).status).toBe(200);
    expect((await api(credential, `${path}/new`, "PUT", value, writeHeaders())).status).toBe(200);
    expect((await api(credential, `${path}/new`)).status).toBe(200);
    expect(await (await api(credential, `${path}/new`, "HEAD")).text()).toBe("");
    expect((await api(credential, `${path}/mismatch`, "PUT", value, writeHeaders("intent-mismatch", 2))).status).toBe(422);
    expect((await api(credential, `${path}/new`, "DELETE", undefined, { ...writeHeaders("intent-remove", 2), "X-Steed-Confirm": "example" })).status).toBe(200);
    expect((await api(credential, `${path}/new`)).status).toBe(404);
  });

  it("rolls back the graph and receipt if its transactional audit cannot be committed", async () => {
    const { credential } = await credentials();
    database.sqlite.exec("CREATE TRIGGER fail_connect_audit BEFORE INSERT ON connect_audit WHEN NEW.operation = 'diagrams.put' BEGIN SELECT RAISE(ABORT, 'Audit unavailable'); END");
    expect((await api(credential, "/diagrams/example", "PUT", { ...example, title: "Must roll back" }, writeHeaders())).status).toBe(503);
    expect((await stored()).revision).toBe(1); expect(database.sqlite.prepare("SELECT count(*) AS n FROM connect_requests").get()?.n).toBe(0);
    database.sqlite.exec("DROP TRIGGER fail_connect_audit");
    expect((await api(credential, "/diagrams/example", "PUT", { ...example, title: "Must roll back" }, writeHeaders())).status).toBe(200);
    expect((await stored()).revision).toBe(2);
  });

  it("rechecks token revocation inside the graph transaction", async () => {
    const { token, credential } = await credentials();
    const original = database.db.batch.bind(database.db);
    vi.spyOn(database.db, "batch").mockImplementationOnce(async (statements) => {
      database.sqlite.prepare("UPDATE connect_tokens SET revoked_at = ?, token_hash = NULL WHERE id = ?").run(nowSeconds(), token.id);
      return original(statements);
    });
    expect((await api(credential, "/diagrams/example", "PUT", example, writeHeaders())).status).toBe(401);
    expect((await stored()).revision).toBe(1);
  });

  it("leaves permanent tombstones when receipts expire", async () => {
    const { credential } = await credentials();
    expect((await api(credential, "/diagrams/example", "PUT", example, writeHeaders())).status).toBe(200);
    database.sqlite.exec("UPDATE connect_requests SET expires_at = 1");
    expect((await api(credential, "/diagrams/example", "PUT", example, writeHeaders())).status).toBe(409);
    await manage();
    expect(database.sqlite.prepare("SELECT response_json FROM connect_requests").get()?.response_json).toBeNull();
    const outcome = await parse<{ data: { state: string } }>(await api(credential, "/requests/intent-0001"));
    expect(outcome.data.state).toBe("expired"); expect((await stored()).revision).toBe(2);
  });
});

describe("Connect limits and discovery", () => {
  it("enforces per-token and per-manager rate limits with retry headers", async () => {
    const { credential, token } = await credentials(); const window = Math.floor(nowSeconds() / 60) * 60;
    database.sqlite.prepare("INSERT INTO connect_rate_limits (key, window, count) VALUES (?, ?, ?)").run(`token:${token.id}:read`, window, 120);
    const limited = await api(credential); expect(limited.status).toBe(429); expect(limited.headers.get("Retry-After")).toBe("60");
    database.sqlite.prepare("UPDATE connect_rate_limits SET count = 60 WHERE key = ?").run(`manager:${await fingerprint("email:manager@example.com")}`);
    expect((await manage()).status).toBe(429);
  });

  it("enforces the target token limit atomically and paginates metadata and audit", async () => {
    const token = await createToken();
    const row = database.sqlite.prepare("SELECT * FROM connect_tokens WHERE id = ?").get(token.id) as unknown as TokenRow;
    for (let i = 0; i < 48; i++) database.sqlite.prepare("INSERT INTO connect_tokens (id, diagram_id, name, scope, prefix, owner, created_at) VALUES (?, NULL, 'Fixture', 'read', 'prefix', ?, ?)").run(`fixture-${i}`, row.owner, row.created_at);
    const responses = await Promise.all([manage("/tokens", "POST", { name: "One", scope: "read" }), manage("/tokens", "POST", { name: "Two", scope: "read" })]);
    expect(responses.map((response) => response.status).sort()).toEqual([201, 422]);
    const list = await parse<{ data: ConnectToken[]; nextCursor: string }>(await manage("/tokens?limit=1"));
    expect(list.data).toHaveLength(1); expect((await manage(`/tokens?limit=1&cursor=${list.nextCursor}`)).status).toBe(200);
    await putDiagram(database.db, "another", diagramSchema.parse(example), null);
    const targets = await parse<{ nextCursor: string }>(await manage("/diagrams?limit=1"));
    expect(targets.nextCursor).toBe("another");
    expect((await manage(`/diagrams?limit=1&cursor=${targets.nextCursor}`)).status).toBe(200);
    const audits = await parse<{ data: unknown[]; nextCursor: string }>(await manage("/audit?limit=1"));
    expect(audits.data).toHaveLength(1); expect((await manage(`/audit?cursor=${audits.nextCursor}`)).status).toBe(200);
  });

  it("publishes every operation and input schema through authenticated OpenAPI", async () => {
    const { credential } = await credentials();
    const response = await api(credential, "/openapi.json"); expect(response.status).toBe(200);
    const contract = await parse<{ openapi: string; paths: Record<string, Record<string, { operationId: string }>>; components: { schemas: Record<string, unknown> } }>(response);
    expect(contract.openapi).toBe("3.1.0");
    for (const operation of CONNECT_OPERATIONS) expect(contract.paths[operation.path]?.[operation.method.toLowerCase()]?.operationId).toBe(operation.id);
    expect(contract.components.schemas.Diagram).toHaveProperty("properties.nodes.maxItems", 500);
    expect(contract.components.schemas.OperationBatch).toHaveProperty("properties.operations.maxItems", 100);
    expect((await manage("/openapi.json")).status).toBe(200);
    expect((await api(credential, "/unknown")).status).toBe(404);
    expect((await api(credential, "/diagrams/example?token=ignored")).status).toBe(422);
    expect((await api(credential, "/diagrams/example/validate", "POST", { ...example, nodes: [] })).status).toBe(422);
  });
});
