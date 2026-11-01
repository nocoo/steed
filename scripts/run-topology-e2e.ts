import { strict as assert } from "node:assert";
import { randomUUID } from "node:crypto";
import { chmodSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { processGroup, stopProcessGroup } from "./process-group";

const root = resolve(import.meta.dir, "..");
const web = resolve(root, "apps/web");
const stateParent = resolve(root, ".wrangler");
mkdirSync(stateParent, { recursive: true });
const canonicalParent = realpathSync(stateParent);
const state = mkdtempSync(join(canonicalParent, "topology-e2e-"));
chmodSync(state, 0o700);
const marker = join(state, ".steed-test-owner");
const owner = randomUUID();
writeFileSync(marker, owner, { flag: "wx", mode: 0o600 });
function assertOwnedState() {
  assert.equal(realpathSync(state), state);
  assert.equal(dirname(state), canonicalParent);
  assert.ok(basename(state).startsWith("topology-e2e-"));
  assert.ok(lstatSync(marker).isFile());
  assert.equal(readFileSync(marker, "utf8"), owner);
}
const reservation = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response() });
const inspector = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response() });
const port = reservation.port;
const inspectorPort = inspector.port;
reservation.stop(true);
inspector.stop(true);
const base = `http://127.0.0.1:${port}`;
// Stub for the lizheng.blog author profile service, reached through the real Workers runtime fetch.
const profileHits: string[] = [];
const profileUpstream = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch(request) {
    const url = new URL(request.url);
    profileHits.push(`${url.pathname}?${url.searchParams.toString()}`);
    return Response.json({ name: "E2E Author", avatar: "https://avatars.example/e2e.png" });
  },
});
const env = { ...process.env, NODE_ENV: "test", CI: "1", WRANGLER_SEND_METRICS: "false" };
let server: ReturnType<typeof Bun.spawn> | undefined;
let serverOutput: Promise<string> | undefined;
let passed = 0;
let interrupted = false;
let cleanupPromise: Promise<void> | undefined;
const commands = new Set<ReturnType<typeof Bun.spawn>>();

function cleanup() {
  cleanupPromise ??= (async () => {
    await Promise.all([...commands, ...(server ? [server] : [])].map((child) => stopProcessGroup(child)));
    void profileUpstream.stop(true);
    assertOwnedState();
    await rm(state, { recursive: true });
  })();
  return cleanupPromise;
}

function interrupt(code: number) {
  if (interrupted) return;
  interrupted = true;
  process.exitCode = code;
  void cleanup().then(() => process.exit(code), (error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(code);
  });
}
process.on("SIGINT", () => interrupt(130));
process.on("SIGTERM", () => interrupt(143));

async function command(cmd: string[]) {
  assertOwnedState();
  if (interrupted) throw new Error("Topology E2E interrupted.");
  const child = Bun.spawn(cmd, { cwd: web, env, stdin: "ignore", stdout: "pipe", stderr: "pipe", ...processGroup });
  commands.add(child);
  try {
    const output = Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text()]);
    const status = await child.exited;
    const text = (await output).join("\n");
    if (status !== 0 || interrupted) throw new Error(`Local command failed (${status}): ${text}`);
  } finally {
    commands.delete(child);
  }
}

const sql = (query: string) => command(["bun", "x", "--no-install", "wrangler", "d1", "execute", "DB", "--env", "dev", "--local", "--persist-to", state, "--command", query]);

async function check(label: string, action: () => Promise<void>) {
  await action();
  passed++;
  console.log(`PASS ${label}`);
}

function request(path: string, method = "GET", body?: unknown, headers: Record<string, string> = {}) {
  return fetch(`${base}${path}`, {
    method,
    headers: { Origin: base, "X-Steed-Request": "1", "Content-Type": "application/json", ...headers },
    ...(body === undefined ? {} : { body: typeof body === "string" ? body : JSON.stringify(body) }),
    redirect: "error",
    signal: AbortSignal.timeout(10_000),
  });
}

async function expectStatus(response: Response, expected: number) {
  assert.equal(response.status, expected, await response.clone().text());
}

try {
  await command(["bun", "run", "build"]);
  await command(["bun", "x", "--no-install", "wrangler", "d1", "migrations", "apply", "DB", "--env", "dev", "--local", "--persist-to", state]);
  await sql(`UPDATE topology_meta
    SET title = 'Local E2E topology', description = 'Synthetic local fixture', revision = 2,
        updated_at = '2026-10-31T00:00:00.000Z'
    WHERE id = 'main';
  INSERT INTO topo_layers (id, label, provider, sort_order, description, updated_rev)
    VALUES ('cloud', 'Cloud', 'Synthetic Provider', 0, 'Local test layer', 2);
  INSERT INTO topo_types (id, label, shape, description, attrs_schema, updated_rev)
    VALUES ('host', 'Host', 'rect', 'Synthetic host type', '[]', 2);
  INSERT INTO topo_boundaries (id, label, kind, description, updated_rev)
    VALUES ('home', 'Home', 'site', 'Synthetic local site', 2);
  INSERT INTO topo_nodes (id, type_id, label, layer_id, lifecycle, description, tags, attrs, updated_rev)
    VALUES ('root', 'host', 'Root host', 'cloud', 'active', 'Synthetic root node', '["fixture"]', '{}', 2);
  INSERT INTO topo_nodes (id, type_id, label, layer_id, lifecycle, description, tags, attrs, updated_rev)
    VALUES ('peer', 'host', 'Peer host', 'cloud', 'active', 'Synthetic peer node', '[]', '{}', 2);
  INSERT INTO topo_node_boundaries (node_id, boundary_id) VALUES ('root', 'home');
  INSERT INTO topo_edges (id, source_id, target_id, kind, label, direction, evidence, description, tags, updated_rev)
    VALUES ('root-peer', 'root', 'peer', 'uses', 'Fixture edge', 'uni', 'documented', 'Synthetic edge', '[]', 2);
  INSERT INTO topo_views (id, label, description, filter, pins, updated_rev)
    VALUES ('overview', 'Overview', 'Synthetic view', '{"layerIds":["cloud"],"typeIds":[],"boundaryIds":[],"tags":[]}', '{}', 2);
  INSERT INTO topo_changes (revision, request_id, actor, token_id, provenance, kind, reverts_change_id, summary, created_at)
    VALUES (1, 'e2e-request-1', 'local-e2e', NULL, NULL, 'replace', NULL, '{"changed":{"layers":0}}', 1798761600);
  INSERT INTO topo_changes (revision, request_id, actor, token_id, provenance, kind, reverts_change_id, summary, created_at)
    VALUES (2, 'e2e-request-2', 'local-e2e', NULL, NULL, 'replace', NULL, '{"changed":{"layers":1}}', 1798761601);`);

  assertOwnedState();
  if (interrupted) throw new Error("Topology E2E interrupted.");
  server = Bun.spawn(["bun", "x", "--no-install", "wrangler", "dev", "--env", "dev", "--local", "--persist-to", state,
    "--ip", "127.0.0.1", "--port", String(port), "--inspector-port", String(inspectorPort),
    "--var", `AUTHOR_PROFILE_ORIGIN:http://127.0.0.1:${profileUpstream.port}`], {
    cwd: web,
    env,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    ...processGroup,
  });
  serverOutput = Promise.all([new Response(server.stdout).text(), new Response(server.stderr).text()]).then((chunks) => chunks.join("\n"));

  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      ready = (await fetch(`${base}/api/live`, { signal: AbortSignal.timeout(1000) })).ok;
    } catch {
      // The owned local Worker is still starting.
    }
    if (ready) break;
    if (server.exitCode !== null) throw new Error(`Local Worker exited: ${await serverOutput}`);
    await Bun.sleep(500);
  }
  assert.ok(ready, "Local Worker did not become ready");

  await check("fresh isolated D1 returns the synthetic topology snapshot", async () => {
    const response = await request("/api/topology");
    await expectStatus(response, 200);
    assert.equal(response.headers.get("ETag"), '"topology:2"');
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    assert.ok(response.headers.get("X-Request-Id"));
    const body = await response.json() as { data: { schemaVersion: number; title: string; revision: number; layers: { id: string }[]; nodes: { id: string }[]; edges: { id: string }[]; views: { id: string }[] }; updatedAt: string };
    assert.equal(body.data.schemaVersion, 2);
    assert.equal(body.data.title, "Local E2E topology");
    assert.equal(body.data.revision, 2);
    assert.deepEqual(body.data.layers.map((layer) => layer.id), ["cloud"]);
    assert.deepEqual(body.data.nodes.map((node) => node.id), ["peer", "root"]);
    assert.deepEqual(body.data.edges.map((edge) => edge.id), ["root-peer"]);
    assert.deepEqual(body.data.views.map((view) => view.id), ["overview"]);
    assert.equal(body.updatedAt, "2026-10-31T00:00:00.000Z");
  });

  await check("HEAD and conditional snapshot reads", async () => {
    const head = await request("/api/topology", "HEAD");
    await expectStatus(head, 200);
    assert.equal(head.headers.get("ETag"), '"topology:2"');
    assert.equal(await head.text(), "");
    for (const condition of ['"topology:2"', 'W/"topology:2"', '"other", "topology:2"', '*']) {
      await expectStatus(await request("/api/topology", "GET", undefined, { "If-None-Match": condition }), 304);
    }
    await expectStatus(await request("/api/topology", "GET", undefined, { "If-None-Match": '"topology:1"' }), 200);
  });

  await check("topology browser writes are method-rejected", async () => {
    for (const method of ["POST", "PUT", "PATCH", "DELETE", "OPTIONS"] ) {
      const response = await request("/api/topology", method, {});
      await expectStatus(response, 405);
      assert.equal(response.headers.get("Allow"), "GET, HEAD");
    }
  });

  await check("cross-origin reads and unknown topology routes are denied", async () => {
    await expectStatus(await request("/api/topology", "GET", undefined, { Origin: "https://attacker.example" }), 403);
    await expectStatus(await request("/api/topology/unknown"), 404);
  });

  await check("profile endpoint fetches and caches the author profile in the Workers runtime", async () => {
    const hash = new Bun.CryptoHasher("sha256").update("dev@local").digest("hex");
    for (let attempt = 0; attempt < 2; attempt++) {
      const response = await request("/api/me");
      await expectStatus(response, 200);
      assert.equal(response.headers.get("Cache-Control"), "no-store");
      assert.deepEqual(await response.json(), { email: "dev@local", name: "E2E Author", avatar: "https://avatars.example/e2e.png" });
    }
    assert.deepEqual(profileHits, [`/api/authors/profile?hash=${hash}`]);
  });

  await check("retired diagram browser APIs return 404", async () => {
    for (const path of ["/api/diagrams", "/api/diagrams/old"]) {
      await expectStatus(await request(path), 404);
      await expectStatus(await request(path, "PUT", {}), 404);
    }
  });

  await check("snapshot delta handles current and valid retained revisions", async () => {
    const delta = await request("/api/topology?since=1");
    await expectStatus(delta, 200);
    const body = await delta.json() as { data: { since: number; revision: number; metadata: { title: string }; changed: Record<string, unknown[]>; deleted: Record<string, unknown[]> } };
    assert.equal(body.data.since, 1);
    assert.equal(body.data.revision, 2);
    assert.equal(body.data.metadata.title, "Local E2E topology");
    assert.deepEqual(Object.fromEntries(Object.entries(body.data.changed).map(([collection, items]) => [collection, items.length])),
      { layers: 1, types: 1, boundaries: 1, nodes: 2, edges: 1, views: 1 });
    assert.ok(Object.values(body.data.deleted).every((items) => items.length === 0));

    const current = await request("/api/topology?since=2");
    await expectStatus(current, 200);
    const currentBody = await current.json() as { data: { metadata?: unknown; changed: Record<string, unknown[]>; deleted: Record<string, unknown[]> } };
    assert.equal(currentBody.data.metadata, undefined);
    assert.ok(Object.values(currentBody.data.changed).every((items) => items.length === 0));
    assert.ok(Object.values(currentBody.data.deleted).every((items) => items.length === 0));
  });

  await check("snapshot stale and future since values resync instead of being masked by ETag", async () => {
    for (const value of ["0", "3"]) {
      const response = await request(`/api/topology?since=${value}`, "GET", undefined, { "If-None-Match": '"topology:2"' });
      await expectStatus(response, 410);
      const body = await response.json() as { error: { code: string }; current_revision: number; oldest_retained_revision: number };
      assert.equal(body.error.code, "resync_required");
      assert.equal(body.current_revision, 2);
      assert.equal(body.oldest_retained_revision, 1);
    }
  });

  await check("snapshot malformed since values return invalid_since", async () => {
    for (const value of ["", "-1", "1.5", "1e2", "abc", "9007199254740992"]) {
      const response = await request(`/api/topology?since=${encodeURIComponent(value)}`, "GET", undefined, { "If-None-Match": '"topology:2"' });
      await expectStatus(response, 400);
      const body = await response.json() as { error: { code: string; message: string; requestId: string } };
      assert.equal(body.error.code, "invalid_since");
      assert.equal(body.error.message, "Since must be a non-negative integer.");
      assert.ok(body.error.requestId);
    }
    const head = await request("/api/topology?since=bad", "HEAD");
    await expectStatus(head, 400);
    assert.equal(await head.text(), "");
  });

  await check("history summaries are bounded, item-free and paginated", async () => {
    const first = await request("/api/topology/changes?limit=1");
    await expectStatus(first, 200);
    const firstBody = await first.json() as { data: { changes: { id: number; items?: unknown }[]; nextCursor: number | null } };
    assert.deepEqual(firstBody.data.changes.map((change) => change.id), [2]);
    assert.equal(firstBody.data.changes[0]?.items, undefined);
    assert.equal(firstBody.data.nextCursor, 2);

    const second = await request("/api/topology/changes?limit=1&cursor=2");
    await expectStatus(second, 200);
    const secondBody = await second.json() as { data: { changes: { id: number; items?: unknown }[]; nextCursor: number | null } };
    assert.deepEqual(secondBody.data.changes.map((change) => change.id), [1]);
    assert.equal(secondBody.data.nextCursor, null);

    const head = await request("/api/topology/changes", "HEAD");
    await expectStatus(head, 200);
    assert.equal(await head.text(), "");
  });

  await check("history conditional reads use the returned history ETag", async () => {
    const response = await request("/api/topology/changes");
    await expectStatus(response, 200);
    const etag = response.headers.get("ETag");
    assert.ok(etag);
    await expectStatus(await request("/api/topology/changes", "GET", undefined, { "If-None-Match": etag }), 304);
  });

  await check("history since, stale and malformed values are validated", async () => {
    await expectStatus(await request("/api/topology/changes?since=1"), 200);
    await expectStatus(await request("/api/topology/changes?since=2"), 200);
    for (const value of ["0", "3"]) {
      const response = await request(`/api/topology/changes?since=${value}`);
      await expectStatus(response, 410);
      assert.equal((await response.json() as { error: { code: string } }).error.code, "resync_required");
    }
    await expectStatus(await request("/api/topology/changes?since=bad"), 400);
    for (const suffix of ["?limit=0", "?limit=501", "?cursor=-1", "?unknown=1", "?since=1&since=2"]) {
      await expectStatus(await request(`/api/topology/changes${suffix}`), 400);
    }
  });

  console.log(`Topology HTTP E2E: ${passed} passed; isolated D1 snapshot, delta, conditional and history reads verified.`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  await cleanup();
  if (serverOutput && process.exitCode) console.error(await serverOutput);
}
