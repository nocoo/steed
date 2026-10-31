import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { testDatabase } from "./__tests__/db";
import { getTopologyChange, InvalidTopologySince, laterTopologyChangeIdentities, listTopologyChanges, parseTopologySince, pruneTopologyHistoryStatement, TopologyResyncRequired } from "./topology-history";

let database: ReturnType<typeof testDatabase>;
beforeEach(() => { database = testDatabase(); });
afterEach(() => database.close());

function seedHistory() {
  database.sqlite.exec(`
    UPDATE topology_meta SET revision = 3;
    INSERT INTO topo_changes (id, revision, request_id, actor, provenance, kind, summary, created_at) VALUES
      (1, 1, 'one', 'fixture', 'manual', 'operations', '{"changed":{"nodes":1}}', 1),
      (2, 2, 'two', 'fixture', NULL, 'operations', '{"changed":{"nodes":1}}', 2),
      (3, 3, 'three', 'fixture', NULL, 'replace', '{"changed":{}}', 3);
    INSERT INTO topo_change_items (change_id, seq, collection, entity_id) VALUES
      (1, 0, 'metadata', 'main'), (1, 1, 'nodes', 'root'), (2, 0, 'nodes', 'root');
    INSERT INTO topo_change_images (change_id, seq, side, image_json) VALUES
      (1, 0, 'before', '{"title":"Before","description":""}'),
      (1, 0, 'after', '{"title":"After","description":""}'),
      (1, 1, 'after', '{"id":"root","label":"Root"}'),
      (2, 0, 'before', '{"id":"root","label":"Root"}'),
      (2, 0, 'after', '{"id":"root","label":"Updated"}');
  `);
}

describe("topology history", () => {
  it("parses non-negative integer since values without accepting malformed input", () => {
    expect(parseTopologySince(null)).toBeUndefined();
    expect(parseTopologySince("0")).toBe(0);
    expect(parseTopologySince("0005")).toBe(5);
    for (const value of ["", "-1", "+1", "1.5", "1e2", " 1", "9007199254740992"]) {
      expect(() => parseTopologySince(value)).toThrow(InvalidTopologySince);
    }
  });

  it("lists stable pages and reports stale, future and current revisions", async () => {
    const empty = await listTopologyChanges(database.db, { since: 0, limit: 2 });
    expect(empty).toEqual({ currentRevision: 0, oldestRetainedRevision: 0, data: [], nextCursor: null });
    seedHistory();
    const first = await listTopologyChanges(database.db, { limit: 2 });
    expect(first.data.map((change) => change.id)).toEqual([3, 2]);
    expect(first.nextCursor).toBe(2);
    expect((await listTopologyChanges(database.db, { cursor: first.nextCursor!, limit: 2 })).data.map((change) => change.id)).toEqual([1]);
    expect((await listTopologyChanges(database.db, { since: 1, limit: 10 })).data.map((change) => change.revision)).toEqual([3, 2]);
    expect((await listTopologyChanges(database.db, { since: 3, limit: 10 })).data).toEqual([]);
    for (const since of [0, 4]) {
      await expect(listTopologyChanges(database.db, { since, limit: 10 })).rejects.toMatchObject({
        currentRevision: 3, oldestRetainedRevision: 1, message: "resync_required",
      } satisfies Partial<TopologyResyncRequired>);
    }
  });

  it("reconstructs separate images and identifies later entity changes", async () => {
    seedHistory();
    const change = await getTopologyChange(database.db, 1);
    expect(change).toMatchObject({ id: 1, revision: 1, requestId: "one", provenance: "manual", summary: { changed: { nodes: 1 } } });
    expect(change?.items).toEqual([
      { collection: "metadata", id: "main", before: { title: "Before", description: "" }, after: { title: "After", description: "" } },
      { collection: "nodes", id: "root", before: null, after: { id: "root", label: "Root" } },
    ]);
    expect(await laterTopologyChangeIdentities(database.db, 1)).toEqual([{ collection: "nodes", id: "root" }]);
    expect((await getTopologyChange(database.db, 3))?.items).toEqual([]);
    expect(await getTopologyChange(database.db, 99)).toBeNull();
    database.sqlite.exec("DELETE FROM topo_change_images WHERE change_id = 1 AND seq = 1");
    await expect(getTopologyChange(database.db, 1)).rejects.toThrow("Topology change image is missing.");
  });

  it("prunes only a contiguous old prefix and retains revert ancestors", async () => {
    database.sqlite.exec(`
      UPDATE topology_meta SET revision = 510;
      WITH RECURSIVE numbers(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM numbers WHERE n < 510)
      INSERT INTO topo_changes (id, revision, request_id, actor, kind, summary, created_at)
      SELECT n, n, 'request-' || n, 'fixture', 'operations', '{}', 1 FROM numbers;
      UPDATE topo_changes SET kind = 'revert', reverts_change_id = 3 WHERE revision = 510;
      INSERT INTO topo_change_items (change_id, seq, collection, entity_id) VALUES (1, 0, 'nodes', 'old');
      INSERT INTO topo_change_images (change_id, seq, side, image_json) VALUES (1, 0, 'after', '{"id":"old"}');
    `);
    await pruneTopologyHistoryStatement(database.db, 10_000_000).run();
    expect(database.sqlite.prepare("SELECT MIN(revision) AS min, COUNT(*) AS n FROM topo_changes").get()).toMatchObject({ min: 3, n: 508 });
    expect(database.sqlite.prepare("SELECT COUNT(*) AS n FROM topo_change_images WHERE change_id = 1").get()?.n).toBe(0);
    expect((await listTopologyChanges(database.db, { since: 3, limit: 1 })).oldestRetainedRevision).toBe(3);
    await expect(listTopologyChanges(database.db, { since: 2, limit: 1 })).rejects.toBeInstanceOf(TopologyResyncRequired);
    database.sqlite.exec("UPDATE topo_changes SET reverts_change_id = NULL WHERE revision = 510");
    await pruneTopologyHistoryStatement(database.db, 10_000_000).run();
    expect(database.sqlite.prepare("SELECT MIN(revision) AS min, COUNT(*) AS n FROM topo_changes").get()).toMatchObject({ min: 11, n: 500 });
  });

  it("retains every change newer than 90 days even when older than the newest 500", async () => {
    database.sqlite.exec(`
      WITH RECURSIVE numbers(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM numbers WHERE n < 510)
      INSERT INTO topo_changes (id, revision, request_id, actor, kind, summary, created_at)
      SELECT n, n, 'request-' || n, 'fixture', 'operations', '{}', CASE WHEN n = 5 THEN 9999999 ELSE 1 END FROM numbers;
    `);
    await pruneTopologyHistoryStatement(database.db, 10_000_000).run();
    expect(database.sqlite.prepare("SELECT MIN(revision) AS min, COUNT(*) AS n FROM topo_changes").get()).toMatchObject({ min: 5, n: 506 });
  });

  it("retains ancestors of reverts pulled into the contiguous suffix", async () => {
    database.sqlite.exec(`
      WITH RECURSIVE numbers(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM numbers WHERE n < 510)
      INSERT INTO topo_changes (id, revision, request_id, actor, kind, summary, created_at)
      SELECT n, n, 'request-' || n, 'fixture', 'operations', '{}', 1 FROM numbers;
      UPDATE topo_changes SET kind = 'revert', reverts_change_id = 3 WHERE revision = 510;
      UPDATE topo_changes SET kind = 'revert', reverts_change_id = 1 WHERE revision = 10;
    `);
    await pruneTopologyHistoryStatement(database.db, 10_000_000).run();
    expect(database.sqlite.prepare("SELECT MIN(revision) AS min, COUNT(*) AS n FROM topo_changes").get()).toMatchObject({ min: 1, n: 510 });
    expect(database.sqlite.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });
});
