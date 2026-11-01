import { strict as assert } from "node:assert";
import { randomUUID } from "node:crypto";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { chmod, mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { CONNECT_LIMITS, emptyTopology, TOPOLOGY_CONNECT_OPERATIONS, matchTopologyConnectOperation, type TopologyConnectToken } from "../packages/api/src/shared";
import { processGroup, stopProcessGroup } from "./process-group";

const root = resolve(import.meta.dir, "..");
const web = resolve(root, "apps/web");
const stateParent = resolve(root, ".wrangler");
await mkdir(stateParent, { recursive: true });
const canonicalParent = realpathSync(stateParent);
const state = await mkdtemp(resolve(canonicalParent, "connect-e2e-"));
await chmod(state, 0o700);
const marker = resolve(state, ".steed-test-owner");
const owner = randomUUID();
await writeFile(marker, owner, { flag: "wx", mode: 0o600 });
function assertOwnedState() {
  assert.equal(realpathSync(state), state);
  assert.equal(dirname(state), canonicalParent);
  assert.ok(basename(state).startsWith("connect-e2e-"));
  assert.ok(lstatSync(marker).isFile());
  assert.equal(readFileSync(marker, "utf8"), owner);
}
const key = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url");
const privateEnv = resolve(state, "connect.env");
await writeFile(privateEnv, `CONNECT_MANAGERS=local:developer\nCONNECT_TOKEN_KEYS=${JSON.stringify({ active: "e2e", keys: { e2e: key } })}\n`, { mode: 0o600 });
const ports = [0, 1].map(() => Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response() }));
const [port, inspectorPort] = ports.map((server) => server.port);
ports.forEach((server) => server.stop(true));
const base = `http://127.0.0.1:${port}`;
const env = { ...process.env, NODE_ENV: "test", CI: "1", WRANGLER_SEND_METRICS: "false" };
const redact = (value: string) => value.replaceAll(key, "[keyring]").replace(/steedc_[A-Za-z0-9_-]{43}/g, "[credential]");
const exercised = new Set<string>();
let server: ReturnType<typeof Bun.spawn> | undefined;
let serverOutput: Promise<string> | undefined;
let passed = 0;
let interrupted = false;
let cleanupPromise: Promise<void> | undefined;
const commands = new Set<ReturnType<typeof Bun.spawn>>();
function cleanup() {
  cleanupPromise ??= (async () => {
    await Promise.all([...commands, ...(server ? [server] : [])].map((child) => stopProcessGroup(child)));
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
    console.error(redact(error instanceof Error ? error.message : String(error)));
    process.exit(code);
  });
}
process.on("SIGINT", () => interrupt(130));
process.on("SIGTERM", () => interrupt(143));

async function command(cmd: string[]) {
  assertOwnedState();
  if (interrupted) throw new Error("Connect E2E interrupted.");
  const child = Bun.spawn(cmd, { cwd: web, env, stdin: "ignore", stdout: "pipe", stderr: "pipe", ...processGroup });
  commands.add(child);
  try {
    const output = Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text()]);
    const status = await child.exited;
    const text = (await output).join("\n");
    if (status !== 0 || interrupted) throw new Error(`Local command failed (${status}): ${redact(text)}`);
  } finally { commands.delete(child); }
}
const sql = (query: string) => command(["bun", "x", "--no-install", "wrangler", "d1", "execute", "DB", "--env", "dev", "--local", "--persist-to", state, "--command", query]);
async function check(label: string, action: () => Promise<void>) {
  await action(); passed++; console.log(`PASS ${label}`);
}
function request(path: string, method = "GET", value?: unknown, headers: Record<string, string> = {}) {
  return fetch(`${base}${path}`, { method, headers: { "Content-Type": "application/json", ...headers },
    ...(value === undefined ? {} : { body: typeof value === "string" ? value : JSON.stringify(value) }), redirect: "error", signal: AbortSignal.timeout(10_000) });
}
const manage = (path = "", method = "GET", value?: unknown, headers: Record<string, string> = {}) => request(`/api/connect${path}`, method, value, { Origin: base, "X-Steed-Request": "1", ...headers });
const api = (credential: string, path: string, method = "GET", value?: unknown, headers: Record<string, string> = {}) => {
  const route = matchTopologyConnectOperation(`/api/v1${path.split("?")[0]}`, method);
  if (route) exercised.add(route.operation.id);
  return request(`/api/v1${path}`, method, value, { Authorization: `Bearer ${credential}`, ...headers });
};
const parse = async <T>(response: Response) => await response.json() as T;
async function status(response: Response, expected: number) {
  assert.equal(response.status, expected, redact(await response.clone().text()));
  if (response.url.includes("/api/connect") || response.url.includes("/api/v1")) {
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    assert.ok(response.headers.get("X-Request-Id"));
    assert.equal(response.headers.get("Access-Control-Allow-Origin"), null);
  }
}
const version = (token: TopologyConnectToken) => ({ "If-Match": `"${token.id}:${token.version}"` });
async function createToken(scope: "topology:read" | "topology:write" = "topology:write") {
  const response = await manage("/tokens", "POST", { name: "HTTP test agent", scope });
  await status(response, 201);
  return (await parse<{ data: TopologyConnectToken }>(response)).data;
}
async function sensitive(token: TopologyConnectToken, action: "reveal" | "rotate" | "revoke", confirmation = token.name) {
  const response = await manage(`/tokens/${token.id}/challenge`, "POST", { action }, version(token));
  await status(response, 200);
  const challenge = (await parse<{ data: { challenge: string } }>(response)).data.challenge;
  return { response: await manage(`/tokens/${token.id}/${action}`, "POST", { challenge, confirmation }, version(token)), challenge };
}
async function reveal(token: TopologyConnectToken) {
  const { response } = await sensitive(token, "reveal"); await status(response, 200);
  const credential = (await parse<{ data: { token: string } }>(response)).data.token;
  assert.ok(/^steedc_[A-Za-z0-9_-]{43}$/.test(credential), "Expected an opaque 256-bit credential");
  return credential;
}
const intent = (key: string, revision: number) => ({ "Idempotency-Key": key, "If-Match": `"topology:${revision}"` });
try {
  await command(["bun", "run", "build"]);
  await command(["bun", "x", "--no-install", "wrangler", "d1", "migrations", "apply", "DB", "--env", "dev", "--local", "--persist-to", state]);
  assertOwnedState();
  if (interrupted) throw new Error("Connect E2E interrupted.");
  server = Bun.spawn(["bun", "x", "--no-install", "wrangler", "dev", "--env", "dev", "--env-file", privateEnv, "--local", "--persist-to", state,
    "--ip", "127.0.0.1", "--port", String(port), "--inspector-port", String(inspectorPort)], { cwd: web, env, stdin: "ignore", stdout: "pipe", stderr: "pipe", ...processGroup });
  serverOutput = Promise.all([new Response(server.stdout).text(), new Response(server.stderr).text()]).then((chunks) => chunks.join("\n"));
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    try { ready = (await request("/api/live")).ok; } catch { /* Wait for the owned Worker. */ }
    if (ready) break;
    if (server.exitCode !== null) throw new Error(`Local Worker exited: ${await serverOutput}`);
    await Bun.sleep(500);
  }
  assert.ok(ready, "Local Worker did not become ready");
  await check("management requires Access and same-origin writes", async () => {
    await status(await manage(), 200);
    await status(await request("/api/connect", "GET", undefined, { Host: "steed.example.com" }), 401);
    await status(await manage("/tokens", "POST", { name: "Denied", scope: "topology:read" }, { Origin: "https://attacker.example" }), 403);
    await status(await manage("/diagrams"), 404);
  });
  let token = await createToken(); let credential = await reveal(token);
  const readToken = await createToken("topology:read"); const reader = await reveal(readToken);
  await check("discovery matches the registry and bearer scopes", async () => {
    await status(await api("bad", "/topology"), 401);
    await status(await api(reader, "/topology", "PUT", emptyTopology(), intent("read-denied", 0)), 403);
    const response = await api(credential, "/openapi.json"); await status(response, 200);
    const contract = await parse<{ paths: Record<string, Record<string, { operationId: string }>> }>(response);
    for (const operation of TOPOLOGY_CONNECT_OPERATIONS) assert.equal(contract.paths[operation.path]?.[operation.method.toLowerCase()]?.operationId, operation.id);
    await status(await api(credential, "/capabilities"), 200);
    await status(await manage("/openapi.json"), 200);
  });
  await check("replace, validate, replay and read canonical topology", async () => {
    const graph = { ...emptyTopology(), layers: [{ id: "cloud", label: "Cloud", provider: "Cloud", order: 0 }] };
    await status(await api(credential, "/topology/validate", "POST", graph), 200);
    const first = await api(credential, "/topology", "PUT", graph, intent("replace-01", 0)); await status(first, 200);
    assert.equal(first.headers.get("ETag"), '"topology:1"');
    const retry = await api(credential, "/topology", "PUT", graph, intent("replace-01", 0)); await status(retry, 200);
    assert.equal(retry.headers.get("Idempotency-Replayed"), "true");
    await status(await api(credential, "/requests/replace-01"), 200);
    await status(await api(reader, "/topology/layers/cloud"), 200);
    await status(await api(reader, "/topology/layers"), 200);
    await status(await api(reader, "/topology/changes"), 200);
    await status(await api(reader, "/topology/changes/1"), 200);
    await status(await api(reader, "/topology", "GET", undefined, { "If-None-Match": '"topology:1"' }), 304);
  });
  await check("guards, resync and secret rejection", async () => {
    await status(await api(credential, "/topology", "PUT", emptyTopology()), 428);
    await status(await api(credential, "/topology", "PUT", emptyTopology(), intent("stale-001", 0)), 412);
    await status(await api(credential, "/topology/operations", "POST", { operations: [{ op: "remove_layer", id: "cloud" }] }, intent("remove-01", 1)), 428);
    const secret = `steedc_${"X".repeat(43)}`;
    const bad = await api(credential, "/topology", "PUT", { ...emptyTopology(), description: secret }, intent("secret-01", 1));
    await status(bad, 422); const text = await bad.text(); assert.ok(text.includes("secret_like_value") && text.includes("known_prefix") && !text.includes(secret));
    for (const path of ["/topology", "/topology/changes"]) {
      // History is retained from revision 1, so the delta from 0 is complete; a future revision resyncs.
      await status(await api(reader, `${path}?since=0`), 200);
      const future = await api(reader, `${path}?since=2`); await status(future, 410);
      assert.deepEqual(Object.fromEntries(Object.entries(await parse<{ current_revision: number; oldest_retained_revision: number }>(future)).filter(([key]) => key.endsWith("revision"))), { current_revision: 1, oldest_retained_revision: 1 });
      const malformed = await api(reader, `${path}?since=bad`); await status(malformed, 400);
      assert.equal((await parse<{ error: { code: string } }>(malformed)).error.code, "invalid_since");
    }
    for (const path of ["/audit?limit=100", "/tokens?limit=100"]) assert.ok(!(await (await manage(path)).text()).includes(secret));
    assert.ok(!(await (await api(reader, "/topology/changes")).text()).includes(secret));
    await status(await api(credential, "/requests/secret-01"), 404);
    await status(await api(credential, "/topology", "PUT", "x".repeat(4 * 1024 * 1024 + 1), intent("large-001", 1)), 413);
  });
  await check("revert, idempotent retry and conflict", async () => {
    await status(await api(credential, "/topology/operations", "POST", { operations: [{ op: "set_metadata", title: "Changed" }] }, intent("change-0001", 1)), 200);
    const headers = { ...intent("revert-0001", 2), "X-Steed-Confirm": "topology" };
    await status(await api(credential, "/topology/changes/2/revert", "POST", undefined, headers), 200);
    const retry = await api(credential, "/topology/changes/2/revert", "POST", undefined, headers);
    await status(retry, 200); assert.equal(retry.headers.get("Idempotency-Replayed"), "true");
    const conflict = await api(credential, "/topology/changes/2/revert", "POST", undefined, { ...intent("revert-0002", 3), "X-Steed-Confirm": "topology" });
    await status(conflict, 409); assert.equal((await parse<{ error: { code: string } }>(conflict)).error.code, "revert_conflict");
  });
  await check("every entity collection supports put, list, get and delete", async () => {
    let revision = 3;
    const records: { collection: string; id: string; value: unknown }[] = [
      { collection: "layers", id: "fixture-layer", value: { id: "fixture-layer", label: "Fixture layer", provider: "Fixture", order: 1 } },
      { collection: "types", id: "fixture-type", value: { id: "fixture-type", label: "Fixture type", shape: "rect" } },
      { collection: "boundaries", id: "fixture-boundary", value: { id: "fixture-boundary", label: "Fixture boundary", kind: "site" } },
      { collection: "nodes", id: "fixture-node", value: { id: "fixture-node", type: "fixture-type", label: "Fixture node", layerId: "fixture-layer", boundaryIds: ["fixture-boundary"] } },
      { collection: "nodes", id: "fixture-peer", value: { id: "fixture-peer", type: "fixture-type", label: "Fixture peer", layerId: "fixture-layer" } },
      { collection: "edges", id: "fixture-edge", value: { id: "fixture-edge", source: "fixture-node", target: "fixture-peer", kind: "uses", direction: "uni", evidence: "documented" } },
      { collection: "views", id: "fixture-view", value: { id: "fixture-view", label: "Fixture view", filter: {} } },
    ];
    for (const { collection, id, value } of records) {
      await status(await api(credential, `/topology/${collection}/${id}`, "PUT", value, intent(`put-${id}`, revision++)), 200);
      await status(await api(reader, `/topology/${collection}/${id}`), 200);
      await status(await api(reader, `/topology/${collection}?limit=1`), 200);
    }
    for (const { collection, id } of records.reverse()) {
      await status(await api(credential, `/topology/${collection}/${id}`, "DELETE", undefined, { ...intent(`delete-${id}`, revision++), "X-Steed-Confirm": "topology" }), 200);
      await status(await api(reader, `/topology/${collection}/${id}`), 404);
    }
    assert.equal(revision, 17);
  });
  await check("auth matrix, rate limit and receipt conflict", async () => {
    await status(await request("/api/v1/topology"), 401);
    await status(await api(reader, "/topology", "POST", {}, { Origin: "https://attacker.example" }), 403);
    await status(await api(credential, "/topology", "PUT", { ...emptyTopology(), title: "Changed intent" }, intent("replace-01", 0)), 409);
    await sql(`UPDATE connect_tokens SET expires_at = 1 WHERE id = '${readToken.id}'`);
    await status(await api(reader, "/topology"), 401);
    await sql(`UPDATE connect_tokens SET expires_at = NULL, owner = 'email:removed@example.com' WHERE id = '${readToken.id}'`);
    await status(await api(reader, "/topology"), 403);
    await sql(`UPDATE connect_tokens SET owner = 'local:developer' WHERE id = '${readToken.id}'`);
    const window = Math.floor(Date.now() / 60_000) * 60;
    await sql(`INSERT OR REPLACE INTO connect_rate_limits (key, window, count) VALUES ('token:${readToken.id}:read', ${window}, ${CONNECT_LIMITS.readPerMinute}), ('token:${readToken.id}:read', ${window + 60}, ${CONNECT_LIMITS.readPerMinute})`);
    const limited = await api(reader, "/topology"); await status(limited, 429); assert.equal(limited.headers.get("Retry-After"), "60");
    await sql("DELETE FROM connect_rate_limits");
    await status((await sensitive(readToken, "revoke")).response, 200);
    await status(await api(reader, "/topology"), 401);
  });
  await check("every graph operation applies atomically", async () => {
    const operations = [
      { op: "set_metadata", title: "Operations fixture" },
      { op: "put_layer", value: { id: "op-layer", label: "Layer", provider: "Fixture", order: 1 } },
      { op: "put_type", value: { id: "op-type", label: "Type", shape: "rect" } },
      { op: "put_boundary", value: { id: "op-boundary", label: "Boundary", kind: "site" } },
      { op: "put_node", value: { id: "op-node", label: "Node", type: "op-type", layerId: "op-layer", boundaryIds: ["op-boundary"] } },
      { op: "put_node", value: { id: "op-peer", label: "Peer", type: "op-type", layerId: "op-layer" } },
      { op: "put_edge", value: { id: "op-edge", source: "op-node", target: "op-peer", kind: "uses", direction: "uni", evidence: "documented" } },
      { op: "put_view", value: { id: "op-view", label: "View", filter: {} } },
    ];
    const response = await api(credential, "/topology/operations", "POST", { operations }, intent("all-operations", 17));
    await status(response, 200);
    const result = await parse<{ data: { revision: number; changed: { metadata: number } } }>(response);
    assert.equal(result.data.revision, 18); assert.equal(result.data.changed.metadata, 1);
    const snapshot = () => api(credential, "/topology").then((value) => parse<{ data: { revision: number } & Record<string, unknown> }>(value));
    const before = (await snapshot()).data;
    for (const [collection, id] of [["layers", "op-layer"], ["types", "op-type"], ["boundaries", "op-boundary"], ["nodes", "op-node"], ["nodes", "op-peer"], ["edges", "op-edge"], ["views", "op-view"]]) {
      assert.ok((before[collection!] as { id: string }[]).some((item) => item.id === id));
    }
    const invalid = await api(credential, "/topology/operations", "POST", { operations: [
      { op: "set_metadata", title: "Must not persist" },
      { op: "put_node", value: { id: "invalid-node", label: "Invalid", type: "missing", layerId: "op-layer" } },
    ] }, intent("invalid-batch", 18));
    await status(invalid, 422); assert.deepEqual((await snapshot()).data, before);
    await status(await api(credential, "/topology/operations", "POST", { operations: [{ op: "remove_edge", id: "op-edge" }] }, { ...intent("remove-edge-op", 18), "X-Steed-Confirm": "topology" }), 200);
    const edgeRemoved = (await snapshot()).data;
    assert.ok(!(edgeRemoved.edges as { id: string }[]).some((item) => item.id === "op-edge"));
    for (const id of ["op-node", "op-peer"]) assert.ok((edgeRemoved.nodes as { id: string }[]).some((item) => item.id === id));
    const removals = ["view", "node", "node", "boundary", "type", "layer"].map((kind, index) => ({ op: `remove_${kind}`, id: ["op-view", "op-node", "op-peer", "op-boundary", "op-type", "op-layer"][index] }));
    await status(await api(credential, "/topology/operations", "POST", { operations: removals }, { ...intent("remove-operations", 19), "X-Steed-Confirm": "topology" }), 200);
    const after = (await snapshot()).data; assert.equal(after.revision, 20);
    for (const collection of ["layers", "types", "boundaries", "nodes", "edges", "views"]) {
      assert.ok((after[collection] as { id: string }[]).every((item) => !item.id.startsWith("op-")));
    }
  });
  await check("owner acceptance builds 7 layers and 200 nodes, then reverts", async () => {
    const bulkToken = await createToken(); const bulk = await reveal(bulkToken);
    await status(await api(bulk, "/topology", "PUT", emptyTopology(), { ...intent("reset-bulk", 20), "X-Steed-Confirm": "topology" }), 200);
    const layers = Array.from({ length: 7 }, (_, index) => ({ op: "put_layer", value: { id: `layer-${index}`, label: `Layer ${index}`, provider: "Fixture", order: index } }));
    await status(await api(bulk, "/topology/operations", "POST", { operations: [...layers, { op: "put_type", value: { id: "host", label: "Host", shape: "rect" } }] }, intent("bulk-base", 21)), 200);
    const node = (index: number) => ({ op: "put_node", value: { id: `node-${index}`, type: "host", label: `Node ${index}`, layerId: `layer-${index % 7}` } });
    for (let batch = 0; batch < 2; batch++) {
      await status(await api(bulk, "/topology/operations", "POST", { operations: Array.from({ length: 100 }, (_, index) => node(batch * 100 + index)) }, intent(`bulk-nodes-${batch}`, 22 + batch)), 200);
    }
    const added = await api(bulk, "/topology/operations", "POST", { operations: [node(200)] }, intent("bulk-extra", 24)); await status(added, 200);
    const history = await parse<{ data: { id: number }[] }>(await api(bulk, "/topology/changes?limit=1"));
    const before = await parse<{ data: { nodes: { id: string }[] } }>(await api(bulk, "/topology"));
    assert.equal(before.data.nodes.length, 201); assert.ok(before.data.nodes.some((item) => item.id === "node-200"));
    const change = await parse<{ data: { items: { collection: string; id: string; before: unknown; after: { id: string } | null }[] } }>(await api(bulk, `/topology/changes/${history.data[0]?.id}`));
    assert.ok(change.data.items.some((item) => item.collection === "nodes" && item.id === "node-200" && item.before === null && item.after?.id === "node-200"));
    await status(await api(bulk, `/topology/changes/${history.data[0]?.id}/revert`, "POST", undefined, { ...intent("bulk-revert", 25), "X-Steed-Confirm": "topology" }), 200);
    const snapshot = await parse<{ data: { layers: unknown[]; nodes: { id: string }[]; revision: number } }>(await api(bulk, "/topology"));
    assert.equal(snapshot.data.layers.length, 7); assert.equal(snapshot.data.nodes.length, 200); assert.equal(snapshot.data.revision, 26);
    assert.deepEqual(snapshot.data.nodes.map((item) => item.id).sort(), before.data.nodes.map((item) => item.id).filter((id) => id !== "node-200").sort());
  });
  await check("token rename, rotate and revoke", async () => {
    const renamed = await manage(`/tokens/${token.id}`, "PATCH", { name: "Renamed agent" }, version(token)); await status(renamed, 200);
    token = (await parse<{ data: TopologyConnectToken }>(renamed)).data;
    const rotated = (await sensitive(token, "rotate")).response; await status(rotated, 200);
    token = (await parse<{ data: TopologyConnectToken }>(rotated)).data;
    await status(await api(credential, "/capabilities"), 401);
    credential = await reveal(token);
    await status(await api(credential, "/capabilities"), 200);
    await status((await sensitive(token, "revoke")).response, 200);
    await status(await api(credential, "/capabilities"), 401);
  });
  assert.deepEqual([...exercised].sort(), TOPOLOGY_CONNECT_OPERATIONS.map((operation) => operation.id).sort());
  console.log(`Topology Connect HTTP E2E: ${passed} passed; all ${exercised.size} registered operations exercised.`);
} catch (error) {
  console.error(redact(error instanceof Error ? error.message : String(error))); process.exitCode = 1;
} finally {
  await cleanup();
  if (serverOutput && process.exitCode) console.error(redact(await serverOutput));
}
