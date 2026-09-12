import { strict as assert } from "node:assert";
import { chmod, mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { CONNECT_OPERATIONS, matchConnectOperation, type ConnectToken } from "../packages/api/src/shared/connect";
import { diagramSchema, type DiagramRecord } from "../packages/api/src/shared/diagram";
import example from "../examples/service-platform.json";

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
  const route = matchConnectOperation(`/api/v1${path.split("?")[0]}`, method);
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
const version = (token: ConnectToken) => ({ "If-Match": `"${token.id}:${token.version}"` });
async function createToken(scope: "read" | "write" = "write", diagramId: string | null = null) {
  const response = await manage("/tokens", "POST", { name: "HTTP test agent", scope, diagramId });
  await status(response, 201);
  const token = (await parse<{ data: ConnectToken }>(response)).data;
  assert.ok(!("token" in token));
  return token;
}
async function sensitive(token: ConnectToken, action: "reveal" | "rotate" | "revoke", confirmation = token.name) {
  const response = await manage(`/tokens/${token.id}/challenge`, "POST", { action }, version(token));
  await status(response, 200);
  const challenge = (await parse<{ data: { challenge: string } }>(response)).data.challenge;
  return { response: await manage(`/tokens/${token.id}/${action}`, "POST", { challenge, confirmation }, version(token)), challenge };
}
async function reveal(token: ConnectToken) {
  const { response } = await sensitive(token, "reveal"); await status(response, 200);
  const credential = (await parse<{ data: { token: string } }>(response)).data.token;
  assert.ok(/^steedc_[A-Za-z0-9_-]{43}$/.test(credential), "Expected an opaque 256-bit credential");
  return credential;
}
const headers = (intent: string, revision: number, id = "example") => ({ "Idempotency-Key": intent, "If-Match": `"${id}:${revision}"` });
const stored = async (credential: string, id = "example") => (await parse<{ data: DiagramRecord }>(await api(credential, `/diagrams/${id}`))).data;

try {
  await command(["bun", "run", "build"]);
  await command(["bun", "x", "--no-install", "wrangler", "d1", "migrations", "apply", "DB", "--env", "dev", "--local", "--persist-to", state]);
  server = Bun.spawn(["bun", "x", "--no-install", "wrangler", "dev", "--env", "dev", "--env-file", privateEnv, "--local", "--persist-to", state,
    "--ip", "127.0.0.1", "--port", String(port), "--inspector-port", String(inspectorPort)], { cwd: web, env, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  serverOutput = Promise.all([new Response(server.stdout).text(), new Response(server.stderr).text()]).then((chunks) => chunks.join("\n"));
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    try { ready = (await request("/api/live")).ok; } catch { /* Wait for this owned local Worker. */ }
    if (ready) break;
    if (server.exitCode !== null) throw new Error(`Local Worker exited: ${await serverOutput}`);
    await Bun.sleep(500);
  }
  assert.ok(ready, "Local Worker did not become ready");
  await check("isolated D1, public SPA and explicit local manager", async () => {
    await status(await manage(), 200);
    const response = await manage("/diagrams"); await status(response, 200);
    assert.deepEqual((await parse<{ data: unknown[] }>(response)).data, []);
    assert.equal((await request("/connect")).status, 200);
    await status(await manage("", "HEAD"), 200);
    await status(await request("/api/connect", "GET", undefined, { Host: "steed.example.com", "Cf-Access-Authenticated-User-Email": "forged@example.com" }), 401);
    await status(await manage("/tokens", "POST", { name: "Denied", scope: "read" }, { Origin: "https://attacker.example" }), 403);
    await status(await manage("/tokens", "POST", {}, { "X-Steed-Request": "" }), 403);
    await status(await api("legacy-token", "/diagrams"), 401);
  });
  let token = await createToken(); let credential = await reveal(token);
  await check("browser navigations reach API authentication and download responses before the SPA fallback", async () => {
    const navigation = { "Sec-Fetch-Mode": "navigate" };
    await status(await request("/api/v1/diagrams", "GET", undefined, navigation), 401);
    const response = await manage("/openapi.json", "GET", undefined, navigation); await status(response, 200);
    assert.ok(response.headers.get("Content-Type")?.includes("application/json"));
    assert.ok(response.headers.get("Content-Disposition")?.includes("attachment"));
    await status(await request("/api/connect/openapi.json", "GET", undefined, { ...navigation, Host: "steed.example.com" }), 401);
    assert.ok((await request("/connect", "GET", undefined, navigation)).headers.get("Content-Type")?.includes("text/html"));
  });
  await check("authenticated discovery matches every implemented route", async () => {
    for (const path of ["/capabilities", "/openapi.json"]) { await status(await api(credential, path), 200); await status(await api(credential, path, "HEAD"), 200); }
    const contract = await parse<{ paths: Record<string, Record<string, { operationId: string }>> }>(await api(credential, "/openapi.json"));
    for (const operation of CONNECT_OPERATIONS) assert.equal(contract.paths[operation.path]?.[operation.method.toLowerCase()]?.operationId, operation.id);
    const download = await manage("/openapi.json"); await status(download, 200); assert.ok(download.headers.get("Content-Disposition")?.includes("attachment"));
    await status(await api(credential, "/diagrams/example/unknown"), 404);
    assert.equal((await request("/api/v1/hosts", "GET", undefined, { Authorization: `Bearer ${credential}` })).status, 401);
    assert.equal((await request("/api/v1/hosts", "GET", undefined, { Authorization: "Bearer dev-token" })).status, 200);
  });
  await check("full create, read, HEAD, validation and lossless export", async () => {
    const response = await api(credential, "/diagrams/example", "PUT", example, { "If-None-Match": "*", "Idempotency-Key": "create-example" });
    await status(response, 201); assert.equal(response.headers.get("ETag"), '"example:1"'); assert.equal(response.headers.get("Location"), "/api/v1/diagrams/example");
    assert.ok(!("document" in (await parse<{ data: object }>(response)).data), "A write returns a small receipt");
    assert.deepEqual((await stored(credential)).document, diagramSchema.parse(example));
    const head = await api(credential, "/diagrams/example", "HEAD"); await status(head, 200); assert.equal(await head.text(), "");
    assert.deepEqual(await (await api(credential, "/diagrams/example/export")).json(), diagramSchema.parse(example));
    await status(await api(credential, "/diagrams/example/export", "HEAD"), 200);
    await status(await api(credential, "/diagrams/example/validate", "POST", example), 200);
    assert.equal((await stored(credential)).revision, 1);
  });
  const readToken = await createToken("read", "example"); const reader = await reveal(readToken);
  await check("scoped read access, filtered pagination and no cross-origin/legacy authorization", async () => {
    const list = await parse<{ data: { id: string }[]; nextCursor: string | null }>(await api(reader, "/diagrams?limit=1"));
    assert.deepEqual(list.data.map((diagram) => diagram.id), ["example"]); assert.equal(list.nextCursor, null);
    await status(await api(reader, "/diagrams", "HEAD"), 200);
    await status(await api(reader, "/diagrams/another"), 404);
    await status(await api(reader, "/diagrams/example", "PUT", example, headers("denied-write", 1)), 403);
    await status(await api(reader, "/diagrams/example/validate", "POST", example), 403);
    await status(await api(reader, "/diagrams/example", "OPTIONS"), 403);
    await status(await api(reader, "/diagrams/example", "GET", undefined, { Origin: "https://attacker.example" }), 403);
    await status(await api(reader, "/diagrams?token=ignored"), 422);
  });
  await check("D1 atomically executes concurrent identical retries once", async () => {
    const document = { ...example, title: "Same intent" }; const intent = headers("same-intent", 1);
    const responses = await Promise.all([api(credential, "/diagrams/example", "PUT", document, intent), api(credential, "/diagrams/example", "PUT", document, intent)]);
    for (const response of responses) await status(response, 200);
    assert.ok(responses.some((response) => response.headers.get("Idempotency-Replayed") === "true"));
    assert.deepEqual(await responses[0]!.json(), await responses[1]!.json());
    assert.equal((await stored(reader)).revision, 2);
    await status(await api(credential, "/diagrams/example", "PUT", { ...document, title: "Different intent" }, intent), 409);
    const outcome = await api(credential, "/requests/same-intent"); await status(outcome, 200);
    assert.equal((await parse<{ data: { state: string } }>(outcome)).data.state, "completed");
    await status(await api(credential, "/requests/same-intent", "HEAD"), 200);
    await status(await api(reader, "/requests/same-intent"), 404);
  });
  await check("independent machine and browser edits never overwrite an unseen revision", async () => {
    const responses = await Promise.all(["First", "Second"].map((title, index) => api(credential, "/diagrams/example", "PUT", { ...example, title }, headers(`race-intent-${index}`, 2))));
    assert.deepEqual(responses.map((response) => response.status).sort(), [200, 412]);
    assert.equal((await stored(reader)).revision, 3);
    const browser = await request("/api/diagrams/example", "PUT", { ...example, title: "Browser edit" }, { Origin: base, "X-Steed-Request": "1", "If-Match": '"example:3"' });
    assert.equal(browser.status, 200);
    await status(await api(credential, "/diagrams/example", "PUT", example, headers("stale-browser", 3)), 412);
    assert.equal((await stored(reader)).document.title, "Browser edit");
  });
  for (const [label, method, value, extra, expected] of [
    ["missing idempotency", "PUT", example, { "If-Match": '"example:4"' }, 428],
    ["missing ETag", "PUT", example, { "Idempotency-Key": "missing-etag" }, 428],
    ["malformed JSON", "PUT", "{bad", headers("invalid-json", 4), 400],
    ["oversized input", "PUT", "x".repeat(1_048_577), headers("oversize-intent", 4), 413],
    ["wrong content type", "PUT", example, { ...headers("wrong-content", 4), "Content-Type": "text/plain" }, 415],
    ["invalid references", "PUT", { ...example, nodes: [] }, headers("invalid-refs", 4), 422],
    ["missing destructive confirmation", "DELETE", undefined, headers("delete-confirm", 4), 428],
  ] as const) await check(`reject ${label} without changing state`, async () => {
    await status(await api(credential, "/diagrams/example", method, value, extra), expected);
    assert.equal((await stored(reader)).revision, 4);
  });
  await check("graph batches preserve metadata, validate final references and roll back invalid operations", async () => {
    const input = { operations: [
      { op: "set_metadata", title: "AI architecture" },
      { op: "put_node", value: { id: "queue", label: "Queue", kind: "service", groupId: "queue-group", position: { x: 800, y: 200 } } },
      { op: "put_group", value: { id: "queue-group", label: "Async boundary", parentId: "cloud" } },
      { op: "put_edge", value: { id: "queue-edge", source: "api", target: "queue", evidence: "inferred", route: { waypoints: [{ x: 500, y: 300 }] } } },
      { op: "put_view", value: { id: "queue-view", label: "Dispatch", nodeIds: ["api", "queue"], routes: { "queue-edge": { labelPosition: { x: 550, y: 300 } } } } },
    ] };
    await status(await api(credential, "/diagrams/example/operations", "POST", input, headers("batch-create", 4)), 200);
    const saved = await stored(reader); assert.equal(saved.nodeCount, 7); assert.equal(saved.document.description, example.description);
    const invalid = { operations: [{ op: "remove_node", id: "api" }, { op: "put_edge", value: { id: "broken", source: "absent", target: "queue" } }] };
    await status(await api(credential, "/diagrams/example/operations", "POST", invalid, { ...headers("invalid-batch", 5), "X-Steed-Confirm": "example" }), 422);
    assert.deepEqual(await stored(reader), saved);
  });
  await sql("DELETE FROM connect_rate_limits");
  let revision = 5;
  for (const [collection, value] of [
    ["nodes", { id: "http-new", label: "HTTP component", kind: "service", position: { x: 1, y: 2 } }],
    ["edges", { id: "http-new", source: "client", target: "db", evidence: "inferred" }],
    ["groups", { id: "http-new", label: "HTTP boundary", parentId: "cloud" }],
    ["views", { id: "http-new", label: "HTTP view", nodeIds: ["client"] }],
  ] as const) await check(`complete ${collection} HTTP operations and pagination`, async () => {
    const path = `/diagrams/example/${collection}`;
    const first = await api(reader, `${path}?limit=1`); await status(first, 200);
    const page = await parse<{ data: { id: string }[]; nextCursor: string | null }>(first);
    assert.equal(page.data.length, 1); assert.ok(page.nextCursor);
    const second = await parse<{ data: { id: string }[] }>(await api(reader, `${path}?limit=1&cursor=${page.nextCursor}`));
    assert.notEqual(second.data[0]?.id, page.data[0]?.id);
    await status(await api(reader, path, "HEAD"), 200);
    await status(await api(credential, `${path}/http-new`, "PUT", value, headers(`put-${collection}`, revision)), 200); revision++;
    const detail = await api(reader, `${path}/http-new`); await status(detail, 200); assert.equal((await parse<{ data: { id: string } }>(detail)).data.id, "http-new");
    await status(await api(reader, `${path}/http-new`, "HEAD"), 200);
    await status(await api(credential, `${path}/http-new`, "DELETE", undefined, { ...headers(`delete-${collection}`, revision), "X-Steed-Confirm": "example" }), 200); revision++;
    await status(await api(reader, `${path}/http-new`), 404);
  });
  await check("D1 rolls back graph and receipt together when audit fails", async () => {
    await sql("CREATE TRIGGER fail_connect_audit BEFORE INSERT ON connect_audit WHEN NEW.operation = 'diagrams.put' BEGIN SELECT RAISE(ABORT, 'Test audit outage'); END");
    const intent = headers("audit-outage", revision); const document = { ...example, title: "Audit protected" };
    await status(await api(credential, "/diagrams/example", "PUT", document, intent), 503);
    assert.equal((await stored(reader)).revision, revision);
    await sql("DROP TRIGGER fail_connect_audit");
    await status(await api(credential, "/diagrams/example", "PUT", document, intent), 200); revision++;
    assert.equal((await stored(reader)).revision, revision);
  });
  await check("token rename, repeat reveal, rotation, old-key rejection and single-use confirmation", async () => {
    const renamed = await manage(`/tokens/${token.id}`, "PATCH", { name: "Renamed HTTP agent" }, version(token)); await status(renamed, 200);
    token = (await parse<{ data: ConnectToken }>(renamed)).data;
    assert.ok(await reveal(token) === credential, "Rename preserves the credential");
    const { response, challenge } = await sensitive(token, "reveal"); await status(response, 200);
    await status(await manage(`/tokens/${token.id}/reveal`, "POST", { challenge, confirmation: token.name }, version(token)), 403);
    const rotated = (await sensitive(token, "rotate")).response; await status(rotated, 200);
    token = (await parse<{ data: ConnectToken }>(rotated)).data;
    await status(await api(credential, "/capabilities"), 401);
    credential = await reveal(token); await status(await api(credential, "/capabilities"), 200);
    await status(await manage(`/tokens/${token.id}`), 200); await status(await manage(`/tokens/${token.id}`, "HEAD"), 200);
  });
  await check("metadata/audit pagination never contains plaintext credentials", async () => {
    for (const path of ["/tokens?limit=1", "/tokens?diagramId=example&limit=1", "/audit?limit=1", "/audit?diagramId=example&limit=1"]) {
      const response = await manage(path); await status(response, 200);
      const text = await response.text(); assert.ok(!text.includes(credential) && !text.includes(reader));
      const page = JSON.parse(text) as { nextCursor: string | null };
      if (page.nextCursor) await status(await manage(`${path}&cursor=${page.nextCursor}`), 200);
    }
  });
  await check("bound writer can delete and replay its own receipt without resurrecting a tombstone", async () => {
    const bound = await createToken("write", "example"); const writer = await reveal(bound);
    const intent = { ...headers("final-delete", revision), "X-Steed-Confirm": "example" };
    await status(await api(writer, "/diagrams/example", "DELETE", undefined, intent), 204);
    const retry = await api(writer, "/diagrams/example", "DELETE", undefined, intent); await status(retry, 204); assert.equal(retry.headers.get("Idempotency-Replayed"), "true");
    await status(await api(writer, "/requests/final-delete"), 200);
    await status(await api(writer, "/diagrams/example"), 404);
    const targets = await parse<{ data: { id: string; deleted: boolean }[] }>(await manage("/diagrams"));
    assert.equal(targets.data.find((target) => target.id === "example")?.deleted, true);
    await status(await api(credential, "/diagrams/example", "PUT", example, { "If-None-Match": "*", "Idempotency-Key": "no-resurrection" }), 412);
    await status((await sensitive(bound, "revoke")).response, 200);
    await status(await api(writer, "/capabilities"), 401);
  });
  await check("expired receipts retain intent tombstones and active tokens honor D1 rate limits", async () => {
    await sql("UPDATE connect_requests SET expires_at = 1; UPDATE connect_rate_limits SET count = 120 WHERE key LIKE 'token:%:read'");
    const limited = await api(reader, "/capabilities"); await status(limited, 429); assert.equal(limited.headers.get("Retry-After"), "60");
    await sql("DELETE FROM connect_rate_limits");
    await status(await manage(), 200);
    const outcome = await api(credential, "/requests/same-intent"); await status(outcome, 200);
    assert.equal((await parse<{ data: { state: string } }>(outcome)).data.state, "expired");
    await status(await api(credential, "/diagrams/example", "PUT", { ...example, title: "Same intent" }, headers("same-intent", 1)), 409);
    await status((await sensitive(token, "revoke")).response, 200);
    await status((await sensitive(readToken, "revoke")).response, 200);
    await status(await api(credential, "/capabilities"), 401);
  });
  assert.deepEqual([...exercised].sort(), CONNECT_OPERATIONS.map((operation) => operation.id).sort());
  console.log(`Connect HTTP E2E: ${passed} passed; all ${exercised.size} machine operations and isolated D1 transactions verified.`);
} catch (error) {
  console.error(redact(error instanceof Error ? error.message : String(error))); process.exitCode = 1;
} finally {
  server?.kill(); if (server) await server.exited;
  if (serverOutput && process.exitCode) console.error(redact(await serverOutput));
  await rm(state, { recursive: true, force: true });
}
