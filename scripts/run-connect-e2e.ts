import { strict as assert } from "node:assert";
import { chmod, mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { emptyTopology, TOPOLOGY_CONNECT_OPERATIONS, matchTopologyConnectOperation, type TopologyConnectToken } from "../packages/api/src/shared";
import { processGroup, stopProcessGroup } from "./process-group";

const root = resolve(import.meta.dir, "..");
const web = resolve(root, "apps/web");
await mkdir(resolve(root, ".wrangler"), { recursive: true });
const state = await mkdtemp(resolve(root, ".wrangler/connect-e2e-"));
await chmod(state, 0o700);
const key = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url");
const privateEnv = resolve(state, "connect.env");
await writeFile(privateEnv, `CONNECT_MANAGERS=local:developer\nCONNECT_TOKEN_KEYS=${JSON.stringify({ active: "e2e", keys: { e2e: key } })}\n`, { mode: 0o600 });
const ports = [0, 1].map(() => Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response() }));
const [port, inspectorPort] = ports.map((server) => server.port);
ports.forEach((server) => server.stop(true));
const base = `http://127.0.0.1:${port}`;
const env = { ...process.env, CI: "1", WRANGLER_SEND_METRICS: "false" };
const redact = (value: string) => value.replaceAll(key, "[keyring]").replace(/steedc_[A-Za-z0-9_-]{43}/g, "[credential]");
const exercised = new Set<string>();
let server: ReturnType<typeof Bun.spawn> | undefined;
let serverOutput: Promise<string> | undefined;
let passed = 0;

async function command(cmd: string[]) {
  const child = Bun.spawn(cmd, { cwd: web, env, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  const output = Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text()]);
  const status = await child.exited;
  const text = (await output).join("\n");
  if (status !== 0) throw new Error(`Local command failed (${status}): ${redact(text)}`);
}
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
  if (response.url.includes("/api/connect") || response.url.includes("/api/v1/diagrams")) {
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
    await status(bad, 422); const text = await bad.text(); assert.ok(text.includes("secret_like_value") && !text.includes(secret));
    for (const value of ["0", "2"]) { const response = await api(reader, `/topology?since=${value}`); await status(response, 410); assert.equal((await parse<{ current_revision: number }>(response)).current_revision, 1); }
    await status(await api(reader, "/topology?since=bad"), 400);
    await status(await api(credential, "/topology", "PUT", "x".repeat(4 * 1024 * 1024 + 1), intent("large-001", 1)), 413);
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
  console.log(`Topology Connect HTTP E2E: ${passed} passed; ${exercised.size} routes exercised. Full acceptance follows revert.`);
} catch (error) {
  console.error(redact(error instanceof Error ? error.message : String(error))); process.exitCode = 1;
} finally {
  if (server) await stopProcessGroup(server);
  if (serverOutput && process.exitCode) console.error(redact(await serverOutput));
  await rm(state, { recursive: true, force: true });
}
