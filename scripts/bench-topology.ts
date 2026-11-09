import { strict as assert } from "node:assert";
import { randomUUID } from "node:crypto";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { emptyTopology, topologySchema, type TopologyConnectToken } from "../packages/api/src/shared";
import { processGroup, stopProcessGroup } from "./process-group";

const root = resolve(import.meta.dir, "..");
const web = resolve(root, "apps/web");
const parent = resolve(root, ".wrangler");
await mkdir(parent, { recursive: true });
const canonicalParent = realpathSync(parent);
const state = await mkdtemp(resolve(canonicalParent, "topology-bench-"));
await chmod(state, 0o700);
const marker = resolve(state, ".steed-test-owner");
const owner = randomUUID();
await writeFile(marker, owner, { flag: "wx", mode: 0o600 });
function assertOwnedState() {
  assert.equal(realpathSync(state), state);
  assert.equal(dirname(state), canonicalParent);
  assert.ok(basename(state).startsWith("topology-bench-"));
  assert.ok(lstatSync(marker).isFile());
  assert.equal(readFileSync(marker, "utf8"), owner);
}
const key = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url");
const privateEnv = resolve(state, "connect.env");
await writeFile(privateEnv, `CONNECT_MANAGERS=local:developer\nCONNECT_TOKEN_KEYS=${JSON.stringify({ active: "bench", keys: { bench: key } })}\n`, { mode: 0o600 });
const ports = [0, 1].map(() => Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response() }));
const [port, inspectorPort] = ports.map((server) => server.port);
ports.forEach((server) => server.stop(true));
const base = `http://127.0.0.1:${port}`;
const env = { ...process.env, NODE_ENV: "test", CI: "1", WRANGLER_SEND_METRICS: "false" };
const redact = (value: string) => value.replaceAll(key, "[keyring]").replace(/steedc_[A-Za-z0-9_-]{43}/g, "[credential]");
let server: ReturnType<typeof Bun.spawn> | undefined;
let serverOutput: Promise<string> | undefined;
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
  if (interrupted) throw new Error("Benchmark interrupted.");
  const child = Bun.spawn(cmd, { cwd: web, env, stdin: "ignore", stdout: "pipe", stderr: "pipe", ...processGroup });
  commands.add(child);
  try {
    const output = Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text()]);
    const status = await child.exited;
    const text = (await output).join("\n");
    if (status !== 0 || interrupted) throw new Error(`Local command failed (${status}): ${redact(text)}`);
  } finally { commands.delete(child); }
}
function request(path: string, method = "GET", body?: string, headers: Record<string, string> = {}) {
  return fetch(`${base}${path}`, { method, headers: { "Content-Type": "application/json", ...headers },
    ...(body === undefined ? {} : { body }), redirect: "error", signal: AbortSignal.timeout(120_000) });
}
async function checked(response: Response, expected = 200) {
  const text = await response.text();
  assert.equal(response.status, expected, redact(text));
  return JSON.parse(text) as { data: Record<string, unknown> };
}
const management = (path: string, method = "GET", data?: unknown, headers: Record<string, string> = {}) =>
  request(`/api/connect${path}`, method, data === undefined ? undefined : JSON.stringify(data), { Origin: base, "X-Steed-Request": "1", ...headers });
async function writer() {
  const created = await checked(await management("/tokens", "POST", { name: "Benchmark writer", scope: "topology:write" }), 201);
  const token = created.data as unknown as TopologyConnectToken;
  const version = { "If-Match": `"${token.id}:${token.version}"` };
  const challenge = await checked(await management(`/tokens/${token.id}/challenge`, "POST", { action: "reveal" }, version));
  const revealed = await checked(await management(`/tokens/${token.id}/reveal`, "POST", { challenge: challenge.data.challenge, confirmation: token.name }, version));
  return String(revealed.data.token);
}
function api(credential: string, path: string, method = "GET", body?: string, headers: Record<string, string> = {}) {
  return request(`/api/v1${path}`, method, body, { Authorization: `Bearer ${credential}`, ...headers });
}
const id = (prefix: string, value: number) => `${prefix}-${String(value).padStart(4, "0")}`;
function fixture(variant: string) {
  const layers = Array.from({ length: 30 }, (_, index) => ({ id: id("layer", index), label: `Layer ${index}`, provider: "Synthetic provider", order: index }));
  const types = Array.from({ length: 60 }, (_, index) => ({ id: id("type", index), label: `Type ${index}`, shape: "rect" }));
  const boundaries = Array.from({ length: 100 }, (_, index) => ({ id: id("boundary", index), label: `Boundary ${index}`, kind: "site" }));
  const nodes = Array.from({ length: 1000 }, (_, index) => {
    const rootIndex = index < 700 ? index : index - 700;
    return { id: id("node", index), type: id("type", index % 60), label: `Node ${index} ${variant}`, layerId: id("layer", rootIndex % 30),
      ...(index < 700 ? { boundaryIds: [id("boundary", index % 100)] } : { parentId: id("node", rootIndex), role: "service", boundaryIds: [] }),
      attrs: { cpu: index % 16, region: "fixture" } };
  });
  const edges = Array.from({ length: 5000 }, (_, index) => ({ id: id("edge", index), source: id("node", index % 700),
    target: id("node", (index % 700 + 1 + Math.floor(index / 700)) % 700), kind: "uses", label: `Edge ${index} ${variant}`,
    direction: "uni", evidence: "documented" }));
  const views = Array.from({ length: 20 }, (_, index) => ({ id: id("view", index), label: `View ${index}`, filter: { layerIds: [id("layer", index)] } }));
  return topologySchema.parse({ ...emptyTopology("Synthetic capacity fixture"), layers, types, boundaries, nodes, edges, views });
}
const percentile95 = (values: number[]) => [...values].sort((a, b) => a - b)[Math.ceil(values.length * 0.95) - 1]!;
const samples: Record<string, number[]> = { read: [], validate: [], incremental: [], replace: [] };
let requestNumber = 0;
let revision = 0;
async function measure(name: keyof typeof samples, credential: string, path: string, method: string, body?: string, mutates = false) {
  const headers = mutates ? { "If-Match": `"topology:${revision}"`, "Idempotency-Key": `bench-${String(++requestNumber).padStart(4, "0")}` } : {};
  const start = performance.now();
  const response = await api(credential, path, method, body, headers);
  const result = await checked(response);
  const duration = performance.now() - start;
  if (mutates) { revision++; assert.equal(result.data.revision, revision); }
  if (name === "read") {
    assert.equal((result.data.nodes as unknown[]).length, 1000);
    assert.equal((result.data.edges as unknown[]).length, 5000);
  }
  if (name === "validate") assert.equal(result.data.valid, true);
  if (name === "incremental") assert.equal((result.data.changed as { nodes: number }).nodes, 100);
  if (name === "replace") {
    const changed = result.data.changed as { nodes: number; edges: number };
    assert.equal(changed.nodes, 1000); assert.equal(changed.edges, 5000);
  }
  samples[name]!.push(duration);
}
try {
  const graphA = fixture("A");
  const graphB = fixture("B");
  const bodyA = JSON.stringify(graphA); const bodyB = JSON.stringify(graphB);
  await command(["bun", "run", "build"]);
  await command(["bun", "x", "--no-install", "wrangler", "d1", "migrations", "apply", "DB", "--env", "dev", "--local", "--persist-to", state]);
  assertOwnedState();
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
  const credentials = await Promise.all([writer(), writer(), writer()]);
  const first = credentials[0]!;
  await checked(await api(first, "/topology", "PUT", bodyA, { "If-Match": '"topology:0"', "Idempotency-Key": "bench-seed" }));
  revision = 1;
  await checked(await api(first, "/topology"));
  await checked(await api(first, "/topology/validate", "POST", bodyA));
  for (let index = 0; index < 20; index++) await measure("read", credentials[index % 3]!, "/topology", "GET");
  for (let index = 0; index < 20; index++) await measure("validate", credentials[index % 3]!, "/topology/validate", "POST", bodyA);
  for (let index = 0; index < 20; index++) {
    const operations = graphA.nodes.slice(0, 100).map((node) => ({ op: "put_node", value: { ...node, label: `${node.label} batch ${index}` } }));
    await measure("incremental", credentials[index % 3]!, "/topology/operations", "POST", JSON.stringify({ operations }), true);
  }
  for (let index = 0; index < 20; index++) await measure("replace", credentials[index % 3]!, "/topology", "PUT", index % 2 ? bodyA : bodyB, true);
  const limits = { read: 300, validate: 300, incremental: 300, replace: 1000 };
  for (const [name, values] of Object.entries(samples)) {
    assert.equal(values.length, 20);
    console.log(`${name} p95: ${percentile95(values).toFixed(2)} ms (n=20, target < ${limits[name as keyof typeof limits]} ms)`);
  }
  for (const [name, values] of Object.entries(samples)) assert.ok(percentile95(values) < limits[name as keyof typeof limits], `${name} p95 exceeds target`);
} catch (error) {
  console.error(redact(error instanceof Error ? error.message : String(error)));
  process.exitCode = 1;
} finally {
  await cleanup();
  if (serverOutput && process.exitCode) console.error(redact(await serverOutput));
}
