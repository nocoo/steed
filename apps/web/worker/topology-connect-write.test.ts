import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { testDatabase } from "./__tests__/db";
import { loadTopology } from "./topology-store";
import { topologyConnectWriteStatements, type TopologyConnectWrite } from "./topology-connect-write";

let database: ReturnType<typeof testDatabase>;
beforeEach(() => {
  database = testDatabase(9);
  database.sqlite.exec(`DROP TABLE connect_confirmations; DROP TABLE connect_requests; DROP TABLE connect_tokens;
    CREATE TABLE connect_tokens (id TEXT PRIMARY KEY, token_hash TEXT, scope TEXT, revoked_at INTEGER, expires_at INTEGER);
    CREATE TABLE connect_requests (token_id TEXT, key_hash TEXT, request_hash TEXT, request_id TEXT UNIQUE, operation TEXT,
      http_status INTEGER NOT NULL DEFAULT 0, response_json TEXT, etag TEXT, created_at INTEGER, expires_at INTEGER,
      PRIMARY KEY (token_id, key_hash));
    ALTER TABLE connect_audit RENAME COLUMN diagram_id TO target;
    INSERT INTO connect_tokens VALUES ('token', 'hash', 'topology:write', NULL, NULL);`);
});
afterEach(() => database.close());

async function fixture(overrides: Partial<TopologyConnectWrite> = {}) {
  const before = (await loadTopology(database.db)).topology;
  return { before, after: { ...before, title: "Changed" }, revision: before.revision ?? 0, requestId: "request-1",
    actor: "token:token", tokenId: "token", tokenHash: "hash", keyHash: "key", requestHash: "intent",
    operation: "topology.operations", kind: "operations", revertsChangeId: null, warnings: [],
    createdAt: 1, updatedAt: "2026-01-01T00:00:00.000Z", ...overrides } satisfies TopologyConnectWrite;
}

async function write(input: TopologyConnectWrite) {
  const results = await database.db.batch(topologyConnectWriteStatements(database.db, input));
  return results.at(-1)?.results[0];
}

describe("topology Connect transactional writes", () => {
  it("commits the graph, history, receipt and audit together and replays the original receipt", async () => {
    const input = await fixture();
    const result = await write(input);
    expect(result).toMatchObject({ http_status: 200, request_id: "request-1", etag: '"topology:1"' });
    expect(JSON.parse(String(result?.response_json))).toMatchObject({ data: { revision: 1, changed: { metadata: 1 }, counts: { nodes: 0 } }, requestId: "request-1" });
    expect((await loadTopology(database.db)).topology).toMatchObject({ revision: 1, title: "Changed" });
    expect(database.sqlite.prepare("SELECT COUNT(*) AS n FROM topo_changes").get()?.n).toBe(1);
    expect(database.sqlite.prepare("SELECT target, status, code FROM connect_audit").get()).toMatchObject({ target: "topology", status: 200, code: null });
    expect(await write({ ...input, requestId: "retry" })).toEqual(result);
    expect((await loadTopology(database.db)).topology.revision).toBe(1);
    expect(database.sqlite.prepare("SELECT COUNT(*) AS n FROM connect_audit").get()?.n).toBe(1);
  });

  it("stores a conflict without changing topology when the revision lost its race", async () => {
    const input = await fixture();
    await write(input);
    const result = await write({ ...input, keyHash: "other-key", requestId: "stale" });
    expect(result).toMatchObject({ http_status: 412, etag: null });
    expect(JSON.parse(String(result?.response_json)).error.code).toBe("version_conflict");
    expect(database.sqlite.prepare("SELECT status, code FROM connect_audit WHERE request_id = 'stale'").get()).toMatchObject({ status: 412, code: "version_conflict" });
    expect((await loadTopology(database.db)).topology.revision).toBe(1);
  });

  it("rechecks token hash, scope, revocation and expiry in the transaction", async () => {
    for (const [index, update] of ["token_hash = 'different'", "scope = 'topology:read'", "revoked_at = 1", "expires_at = 1"].entries()) {
      database.sqlite.exec("UPDATE connect_tokens SET token_hash = 'hash', scope = 'topology:write', revoked_at = NULL, expires_at = NULL");
      database.sqlite.exec(`UPDATE connect_tokens SET ${update}`);
      const input = await fixture({ requestId: `blocked-${index}`, keyHash: `key-${index}` });
      const result = await write(input);
      expect(result?.http_status).toBe(401);
      expect(JSON.parse(String(result?.response_json)).error.code).toBe("invalid_token");
      expect((await loadTopology(database.db)).topology.revision).toBe(0);
    }
  });

  it("rolls graph, history and receipt back if audit insertion fails", async () => {
    database.sqlite.exec("CREATE TRIGGER reject_audit BEFORE INSERT ON connect_audit BEGIN SELECT RAISE(ABORT, 'audit failure'); END");
    await expect(write(await fixture())).rejects.toThrow();
    expect((await loadTopology(database.db)).topology.revision).toBe(0);
    expect(database.sqlite.prepare("SELECT COUNT(*) AS n FROM topo_changes").get()?.n).toBe(0);
    expect(database.sqlite.prepare("SELECT COUNT(*) AS n FROM connect_requests").get()?.n).toBe(0);
  });
});
