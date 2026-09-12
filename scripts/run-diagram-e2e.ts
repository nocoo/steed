import { strict as assert } from "node:assert";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { diagramSchema, type DiagramRecord } from "../packages/api/src/shared/diagram";
import example from "../examples/service-platform.json";

const root = resolve(import.meta.dir, "..");
const web = resolve(root, "apps/web");
await mkdir(resolve(root, ".wrangler"), { recursive: true });
const state = await mkdtemp(resolve(root, ".wrangler/diagrams-e2e-"));
const reservation = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response() });
const inspector = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response() });
const port = reservation.port;
const inspectorPort = inspector.port;
reservation.stop(true); inspector.stop(true);
const base = `http://127.0.0.1:${port}`;
const env = { ...process.env, CI: "1", WRANGLER_SEND_METRICS: "false" };
let server: ReturnType<typeof Bun.spawn> | undefined;
let serverOutput: Promise<string> | undefined;
let passed = 0;

async function command(cmd: string[]) {
  const child = Bun.spawn(cmd, { cwd: web, env, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  const output = new Response(child.stdout).text();
  const error = new Response(child.stderr).text();
  const status = await child.exited;
  const text = (await output) + (await error);
  if (status !== 0) throw new Error(`${cmd[2] ?? cmd[0]} failed (${status}): ${text}`);
}
async function check(label: string, action: () => Promise<void>) {
  await action(); passed++; console.log(`PASS ${label}`);
}
function request(path = "example", method = "GET", body?: unknown, headers: Record<string, string> = {}) {
  return fetch(`${base}/api/diagrams${path ? `/${path}` : ""}`, { method,
    headers: { Origin: base, "X-Steed-Request": "1", "Content-Type": "application/json", ...headers },
    ...(body === undefined ? {} : { body: typeof body === "string" ? body : JSON.stringify(body) }),
    redirect: "error", signal: AbortSignal.timeout(10_000),
  });
}
async function expectStatus(response: Response, status: number) {
  assert.equal(response.status, status, await response.clone().text());
}

try {
  await command(["bun", "run", "build"]);
  await command(["bun", "x", "--no-install", "wrangler", "d1", "migrations", "apply", "DB", "--env", "dev", "--local", "--persist-to", state]);
  server = Bun.spawn(["bun", "x", "--no-install", "wrangler", "dev", "--env", "dev", "--local", "--persist-to", state,
    "--ip", "127.0.0.1", "--port", String(port), "--inspector-port", String(inspectorPort)], { cwd: web, env, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  serverOutput = Promise.all([new Response(server.stdout).text(), new Response(server.stderr).text()]).then((chunks) => chunks.join("\n"));
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    try { ready = (await fetch(`${base}/api/live`, { signal: AbortSignal.timeout(1000) })).ok; } catch { /* The local Worker is still starting. */ }
    if (ready) break;
    if (server.exitCode !== null) throw new Error(`Local Worker exited: ${await serverOutput}`);
    await Bun.sleep(500);
  }
  assert.ok(ready, "Local Worker did not become ready");

  await check("fresh isolated D1 contains no diagrams", async () => {
    const response = await request(""); await expectStatus(response, 200);
    assert.deepEqual(await response.json(), { data: [], nextCursor: null });
  });
  await check("create complete architecture with If-None-Match", async () => {
    const response = await request("example", "PUT", example, { "If-None-Match": "*" });
    await expectStatus(response, 201); assert.equal(response.headers.get("ETag"), '"example:1"');
    const record = await response.json() as DiagramRecord;
    assert.deepEqual(record.document, diagramSchema.parse(example));
    assert.equal(record.nodeCount, 6); assert.equal(record.edgeCount, 6);
    assert.equal(response.headers.get("Cache-Control"), "no-store"); assert.ok(response.headers.get("X-Request-Id"));
  });
  await check("GET and HEAD return persisted data and version", async () => {
    const response = await request(); await expectStatus(response, 200);
    assert.deepEqual((await response.json() as DiagramRecord).document, diagramSchema.parse(example));
    const head = await request("example", "HEAD"); await expectStatus(head, 200);
    assert.equal(head.headers.get("ETag"), '"example:1"'); assert.equal(await head.text(), "");
    await expectStatus(await request("", "HEAD"), 200);
  });
  for (const [name, method, body, headers, status] of [
    ["duplicate create", "PUT", example, { "If-None-Match": "*" }, 412],
    ["missing precondition", "PUT", example, {}, 428],
    ["wrong diagram ETag", "PUT", example, { "If-Match": '"other:1"' }, 412],
    ["weak ETag", "PUT", example, { "If-Match": 'W/"example:1"' }, 412],
    ["conflicting preconditions", "PUT", example, { "If-Match": '"example:1"', "If-None-Match": "*" }, 412],
    ["malformed JSON", "PUT", "{invalid", { "If-Match": '"example:1"' }, 400],
    ["unknown fields", "PUT", { ...example, command: "unsafe" }, { "If-Match": '"example:1"' }, 422],
    ["dangling edges", "PUT", { ...example, nodes: [] }, { "If-Match": '"example:1"' }, 422],
    ["unsafe URL", "PUT", { ...example, nodes: [{ ...example.nodes[0], url: "javascript:alert(1)" }] }, { "If-Match": '"example:1"' }, 422],
    ["oversized body", "PUT", "x".repeat(1_048_577), { "If-Match": '"example:1"' }, 413],
    ["missing body", "PUT", undefined, { "If-Match": '"example:1"' }, 400],
    ["wrong content type", "PUT", example, { "If-Match": '"example:1"', "Content-Type": "text/plain" }, 415],
    ["cross-origin write", "PUT", example, { "If-Match": '"example:1"', Origin: "https://attacker.example" }, 403],
    ["missing management header", "PUT", example, { "If-Match": '"example:1"', "X-Steed-Request": "" }, 403],
    ["missing origin", "PUT", example, { "If-Match": '"example:1"', Origin: "" }, 403],
    ["unsupported method", "PATCH", {}, {}, 405],
    ["delete without precondition", "DELETE", undefined, {}, 428],
  ] as const) {
    await check(`reject ${name}`, async () => {
      await expectStatus(await request("example", method, body, headers), status);
      assert.equal((await (await request()).json() as DiagramRecord).revision, 1);
    });
  }
  await check("public-host requests cannot use the local Access bypass", async () => {
    const response = await fetch(`${base}/api/diagrams`, { headers: { Host: "steed.example.com", "Cf-Access-Authenticated-User-Email": "forged@example.com" } });
    await expectStatus(response, 401);
  });
  await check("concurrent edits compare and swap one revision", async () => {
    const responses = await Promise.all(["First", "Second"].map((title) => request("example", "PUT", { ...example, title }, { "If-Match": '"example:1"' })));
    assert.deepEqual(responses.map((response) => response.status).sort(), [200, 412]);
    const winner = await responses.find((response) => response.status === 200)!.json() as DiagramRecord;
    const stored = await (await request()).json() as DiagramRecord;
    assert.equal(stored.document.title, winner.document.title); assert.equal(stored.revision, 2);
  });
  await check("stable pagination lists each diagram once", async () => {
    await expectStatus(await request("second", "PUT", example, { "If-None-Match": "*" }), 201);
    const first = await (await request("?limit=1")).json() as { data: { id: string }[]; nextCursor: string };
    assert.equal(first.data[0]?.id, "example"); assert.equal(first.nextCursor, "example");
    const second = await (await request("?limit=1&cursor=example")).json() as { data: { id: string }[]; nextCursor: string | null };
    assert.equal(second.data[0]?.id, "second"); assert.equal(second.nextCursor, null);
  });
  await check("500 components persist without dropping graph content", async () => {
    const nodes = Array.from({ length: 500 }, (_, index) => ({ id: `node-${index}`, label: `Service ${index}`, kind: "service", position: { x: index % 20 * 280, y: Math.floor(index / 20) * 140 } }));
    const edges = Array.from({ length: 1999 }, (_, index) => ({ id: `edge-${index}`, source: `node-${index % 500}`, target: `node-${(index + 1) % 500}` }));
    const document = { schemaVersion: 1, title: "Large graph", nodes, edges, views: [], groups: [] };
    await expectStatus(await request("large", "PUT", document, { "If-None-Match": "*" }), 201);
    const stored = await (await request("large")).json() as DiagramRecord;
    assert.equal(stored.document.nodes.length, 500); assert.equal(stored.document.edges.length, 1999);
  });
  await check("delete respects current revision and never resurrects a tombstone", async () => {
    await expectStatus(await request("example", "DELETE", undefined, { "If-Match": '"example:1"' }), 412);
    await expectStatus(await request("example", "DELETE", undefined, { "If-Match": '"example:2"' }), 204);
    await expectStatus(await request(), 404);
    await expectStatus(await request("example", "PUT", example, { "If-None-Match": "*" }), 412);
  });
  console.log(`Diagram HTTP E2E: ${passed} passed; isolated D1 verified.`);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  server?.kill();
  if (server) await server.exited;
  if (serverOutput && process.exitCode) console.error(await serverOutput);
  await rm(state, { recursive: true, force: true });
}
