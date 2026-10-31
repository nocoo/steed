import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { testDatabase } from "./__tests__/db";
import { fingerprint } from "./connect-crypto";
import { pruneConnect, runConnect, tokenContext, tokenMetadata, type ConnectEnv, type TokenRow } from "./topology-connect-core";

let database: ReturnType<typeof testDatabase>;
let env: ConnectEnv;
const credential = `steedc_${"A".repeat(43)}`;
const origin = "https://fixture.example";
const user = { email: "manager@example.com", sub: "manager" };
const row: TokenRow = { id: "fixture", name: "Fixture", scope: "topology:read", prefix: "steedc_fixture", token_hash: null, ciphertext: null,
  owner: "email:manager@example.com", version: 1, created_at: 1, expires_at: null, last_used_at: null, revoked_at: null };
beforeEach(async () => {
  database = testDatabase(9);
  database.sqlite.exec(`DROP TABLE connect_confirmations; DROP TABLE connect_requests; DROP TABLE connect_tokens;
    CREATE TABLE connect_tokens (id TEXT PRIMARY KEY, name TEXT, scope TEXT, prefix TEXT, token_hash TEXT, ciphertext TEXT,
      owner TEXT, version INTEGER, created_at INTEGER, expires_at INTEGER, last_used_at INTEGER, revoked_at INTEGER);
    CREATE TABLE connect_confirmations (expires_at INTEGER); CREATE TABLE connect_requests (expires_at INTEGER, response_json TEXT);
    ALTER TABLE connect_audit RENAME COLUMN diagram_id TO target;`);
  env = { DB: database.db, CONNECT_DEPLOYMENT_ID: "fixture", CONNECT_MANAGERS: user.email ? `email:${user.email}` : "" };
  database.sqlite.prepare("INSERT INTO connect_tokens VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(row.id, row.name, row.scope, row.prefix,
    await fingerprint(`fixture:${credential}`), row.ciphertext, row.owner, row.version, row.created_at, row.expires_at, row.last_used_at, row.revoked_at);
});
afterEach(() => database.close());

const request = (method = "GET", token = credential) => new Request(`${origin}/api/v1/topology`, { method, headers: { Authorization: `Bearer ${token}` } });
const action = async () => Response.json({ ok: true });

describe("prepared topology Connect core", () => {
  it("authorizes scoped bearer requests and audits a topology target", async () => {
    expect((await runConnect(request(), env, "bearer", action)).status).toBe(200);
    expect((await runConnect(request("POST"), env, "bearer", action)).status).toBe(403);
    database.sqlite.exec("UPDATE connect_tokens SET scope = 'topology:write'");
    expect((await runConnect(request("POST"), env, "bearer", action)).status).toBe(200);
    const audit = database.sqlite.prepare("SELECT target, status FROM connect_audit ORDER BY id").all();
    expect(audit.map((item) => [item.target, item.status])).toEqual([["topology", 200], ["topology", 403], ["topology", 200]]);
    expect(JSON.stringify(audit)).not.toContain(credential);
  });

  it("rejects expired, revoked and unauthorized credentials and cross-origin requests", async () => {
    expect((await runConnect(request("GET", "bad"), env, "bearer", action)).status).toBe(401);
    database.sqlite.exec("UPDATE connect_tokens SET expires_at = 1");
    expect((await runConnect(request(), env, "bearer", action)).status).toBe(401);
    database.sqlite.exec("UPDATE connect_tokens SET expires_at = NULL, revoked_at = 1");
    expect((await runConnect(request(), env, "bearer", action)).status).toBe(401);
    database.sqlite.exec("UPDATE connect_tokens SET revoked_at = NULL");
    env.CONNECT_MANAGERS = "";
    expect((await runConnect(request(), env, "bearer", action)).status).toBe(403);
    expect((await runConnect(new Request(`${origin}/api/v1/topology`, { headers: { Origin: "https://attacker.example" } }), env, "bearer", action)).status).toBe(403);
  });

  it("requires a manager for management and binds ciphertext context to topology scope", async () => {
    const management = new Request(`${origin}/api/connect`, { method: "POST", headers: { Origin: origin, "X-Steed-Request": "1" } });
    expect((await runConnect(management, env, "manager", action)).status).toBe(401);
    expect((await runConnect(management, env, "manager", action, user)).status).toBe(200);
    expect(JSON.parse(tokenContext(env, row))).toEqual(["token", "fixture", "fixture", "topology:read", "email:manager@example.com", null]);
    expect(tokenMetadata(row)).not.toHaveProperty("diagramId");
    expect(tokenMetadata(row).scope).toBe("topology:read");
  });

  it("prunes expired Connect state and topology history in one sweep", async () => {
    database.sqlite.exec("INSERT INTO connect_confirmations VALUES (1); INSERT INTO connect_requests VALUES (1, 'receipt'); INSERT INTO connect_rate_limits VALUES ('old', 1, 1)");
    await pruneConnect(database.db);
    expect(database.sqlite.prepare("SELECT COUNT(*) AS n FROM connect_confirmations").get()?.n).toBe(0);
    expect(database.sqlite.prepare("SELECT response_json FROM connect_requests").get()?.response_json).toBeNull();
    expect(database.sqlite.prepare("SELECT COUNT(*) AS n FROM connect_rate_limits").get()?.n).toBe(0);
  });
});
