/**
 * L3 browser lane: build the app, start the full Worker on an isolated local D1,
 * load the synthetic acceptance topology through the Connect API, then drive the
 * topology page in headless Chromium.
 *
 *   bun scripts/run-browser-e2e.ts            # run the browser checks
 *   bun scripts/run-browser-e2e.ts --serve    # keep the seeded Worker running
 *   bun scripts/run-browser-e2e.ts --screens <dir>  # write overview/layer screenshots
 *
 * Set STEED_BROWSER_CHANNEL=chrome to use an installed Chrome instead of the
 * Playwright-managed Chromium.
 */
import { strict as assert } from "node:assert";
import { randomUUID } from "node:crypto";
import { chmodSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { chromium, type Page } from "playwright";
import { processGroup, stopProcessGroup } from "./process-group";

const root = resolve(import.meta.dir, "..");
const web = resolve(root, "apps/web");
const fixture = JSON.parse(readFileSync(resolve(web, "e2e/acceptance-topology.json"), "utf8")) as {
  layers: { id: string; label: string; order: number }[];
  nodes: { id: string; label: string; layerId: string; parentId?: string }[];
};
const args = process.argv.slice(2);
const serve = args.includes("--serve");
const screensIndex = args.indexOf("--screens");
const screens = screensIndex >= 0 ? resolve(args[screensIndex + 1] ?? "") : "";
const skipBuild = args.includes("--skip-build");

const stateParent = resolve(root, ".wrangler");
mkdirSync(stateParent, { recursive: true });
const canonicalParent = realpathSync(stateParent);
const state = mkdtempSync(join(canonicalParent, "browser-e2e-"));
chmodSync(state, 0o700);
const marker = join(state, ".steed-test-owner");
const owner = randomUUID();
writeFileSync(marker, owner, { flag: "wx", mode: 0o600 });
function assertOwnedState() {
  assert.equal(realpathSync(state), state);
  assert.equal(dirname(state), canonicalParent);
  assert.ok(basename(state).startsWith("browser-e2e-"));
  assert.ok(lstatSync(marker).isFile());
  assert.equal(readFileSync(marker, "utf8"), owner);
}

const key = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url");
const privateEnv = resolve(state, "connect.env");
writeFileSync(privateEnv, `CONNECT_MANAGERS=local:developer\nCONNECT_TOKEN_KEYS=${JSON.stringify({ active: "e2e", keys: { e2e: key } })}\n`, { mode: 0o600 });
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
process.on("SIGINT", () => interrupt(serve ? 0 : 130));
process.on("SIGTERM", () => interrupt(serve ? 0 : 143));

async function command(cmd: string[]) {
  assertOwnedState();
  if (interrupted) throw new Error("Browser E2E interrupted.");
  const child = Bun.spawn(cmd, { cwd: web, env, stdin: "ignore", stdout: "pipe", stderr: "pipe", ...processGroup });
  commands.add(child);
  try {
    const output = Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text()]);
    const status = await child.exited;
    const text = (await output).join("\n");
    if (status !== 0 || interrupted) throw new Error(`Local command failed (${status}): ${redact(text)}`);
  } finally { commands.delete(child); }
}

function request(path: string, method = "GET", value?: unknown, headers: Record<string, string> = {}) {
  return fetch(`${base}${path}`, { method, headers: { "Content-Type": "application/json", ...headers },
    ...(value === undefined ? {} : { body: JSON.stringify(value) }), redirect: "error", signal: AbortSignal.timeout(30_000) });
}
const manage = (path: string, method = "GET", value?: unknown, headers: Record<string, string> = {}) =>
  request(`/api/connect${path}`, method, value, { Origin: base, "X-Steed-Request": "1", ...headers });
async function ok<T>(response: Response, expected: number): Promise<T> {
  const text = await response.text();
  assert.equal(response.status, expected, redact(text));
  return JSON.parse(text) as T;
}

async function seed() {
  const token = (await ok<{ data: { id: string; version: number; name: string } }>(await manage("/tokens", "POST", { name: "Browser E2E", scope: "topology:write" }), 201)).data;
  const version = { "If-Match": `"${token.id}:${token.version}"` };
  const challenge = (await ok<{ data: { challenge: string } }>(await manage(`/tokens/${token.id}/challenge`, "POST", { action: "reveal" }, version), 200)).data.challenge;
  const credential = (await ok<{ data: { token: string } }>(await manage(`/tokens/${token.id}/reveal`, "POST", { challenge, confirmation: token.name }, version), 200)).data.token;
  await ok(await request("/api/v1/topology", "PUT", fixture, { Authorization: `Bearer ${credential}`, "Idempotency-Key": "browser-e2e-seed", "If-Match": '"topology:0"' }), 200);
}

async function openTopology(page: Page, theme: "light" | "dark" = "light") {
  await page.addInitScript((value) => { try { localStorage.setItem("theme", value); } catch { /* storage optional */ } }, theme);
  await page.goto(`${base}/`);
  await page.getByRole("region", { name: "Topology graph" }).waitFor({ timeout: 30_000 });
  await page.locator(".react-flow__node").first().waitFor({ timeout: 30_000 });
}

const crashText = /Unexpected Application Error|Maximum update depth|Minified React error|hit an error/;
const hostOf = new Map(fixture.nodes.map((node) => [node.id, node.parentId]));
function rootHost(id: string): string {
  let current = id;
  for (let parent = hostOf.get(current); parent; parent = hostOf.get(current)) current = parent;
  return current;
}
const layerOfHost = new Map(fixture.nodes.filter((node) => !node.parentId).map((node) => [node.id, node.layerId]));

async function selectedNode(page: Page): Promise<string> {
  return await page.getByRole("region", { name: "Topology graph" }).getAttribute("data-selected-node") ?? "";
}

async function assertHealthy(page: Page, errors: string[], step: string) {
  const body = await page.locator("body").innerText();
  assert.ok(!crashText.test(body), `Page crashed after ${step}`);
  assert.deepEqual(errors, [], `Browser errors after ${step}`);
  await page.getByRole("region", { name: "Topology graph" }).waitFor({ timeout: 5_000 });
}

/** Clicks every node card with the real mouse, one layer at a time (host → satellite → … transitions). */
async function clickEveryNode(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  await page.getByRole("button", { name: "Hide inspector" }).click();
  const viewport = page.viewportSize() ?? { width: 0, height: 0 };
  const done = new Set<string>();
  let revealed = 0;
  const layers = [...fixture.layers].sort((a, b) => a.order - b.order);
  for (const layer of layers) {
    // Back to the overview first: off-screen sections are not rendered.
    await page.getByRole("button", { name: "Fit topology" }).click();
    await page.getByRole("button", { name: `Focus layer ${layer.label}` }).click();
    await page.waitForTimeout(150);
    for (const node of fixture.nodes.filter((candidate) => layerOfHost.get(rootHost(candidate.id)) === layer.id)) {
      const box = await page.getByTestId(`topology-node-card-${node.id}`).boundingBox();
      const onScreen = box && box.width > 6 && box.height > 6 && box.x >= 0 && box.y >= 0 && box.x + box.width <= viewport.width && box.y + box.height <= viewport.height;
      if (!onScreen) continue;
      await page.mouse.click(box.x + box.width / 2, box.y + Math.min(box.height / 2, 18));
      await assertHealthy(page, errors, `clicking ${node.id}`);
      assert.equal(await selectedNode(page), node.id, `Clicking ${node.id} did not select it`);
      done.add(node.id);
    }
  }
  // Anything that was off-screen: reveal it through the inspector search, then click it.
  for (const node of fixture.nodes.filter((candidate) => !done.has(candidate.id))) {
    await page.getByRole("button", { name: "Show inspector" }).click();
    await page.getByLabel("Find a node").fill(node.id);
    await page.locator(`[data-node-id="${node.id}"]`).click();
    await page.getByRole("button", { name: "Hide inspector" }).click();
    await page.waitForTimeout(100);
    const box = await page.getByTestId(`topology-node-card-${node.id}`).boundingBox();
    assert.ok(box, `Node ${node.id} is not rendered after search`);
    await page.mouse.click(box.x + box.width / 2, box.y + Math.min(box.height / 2, 18));
    await assertHealthy(page, errors, `clicking ${node.id} after search`);
    assert.equal(await selectedNode(page), node.id, `Clicking ${node.id} did not select it`);
    done.add(node.id);
    revealed++;
  }
  assert.equal(done.size, fixture.nodes.length);
  return { clicked: done.size, revealed };
}

async function takeScreens(dir: string) {
  mkdirSync(dir, { recursive: true });
  const browser = await chromium.launch(process.env.STEED_BROWSER_CHANNEL ? { channel: process.env.STEED_BROWSER_CHANNEL } : {});
  try {
    for (const theme of ["light", "dark"] as const) {
      const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, colorScheme: theme, deviceScaleFactor: 1 });
      const page = await context.newPage();
      await openTopology(page, theme);
      await page.getByRole("button", { name: "Hide inspector" }).click();
      await page.waitForTimeout(600);
      await page.screenshot({ path: join(dir, `${theme}-overview.png`) });
      const layer = fixture.layers.find((candidate) => candidate.id === "test-vps") ?? fixture.layers[0];
      if (layer) {
        await page.getByRole("button", { name: `Focus layer ${layer.label}` }).click();
        await page.waitForTimeout(400);
        await page.screenshot({ path: join(dir, `${theme}-layer-${layer.id}.png`) });
        const host = fixture.nodes.find((node) => node.layerId === layer.id && !node.parentId);
        if (host) {
          await page.getByRole("button", { name: "Show inspector" }).click();
          const box = await page.getByTestId(`topology-node-card-${host.id}`).boundingBox();
          if (box) await page.mouse.click(box.x + box.width / 2, box.y + 18);
          await page.waitForTimeout(400);
          await page.screenshot({ path: join(dir, `${theme}-layer-${layer.id}-selected.png`) });
        }
      }
      await context.close();
    }
  } finally { await browser.close(); }
}

try {
  if (!skipBuild) await command(["bun", "run", "build"]);
  await command(["bun", "x", "--no-install", "wrangler", "d1", "migrations", "apply", "DB", "--env", "dev", "--local", "--persist-to", state]);
  assertOwnedState();
  server = Bun.spawn(["bun", "x", "--no-install", "wrangler", "dev", "--env", "dev", "--env-file", privateEnv, "--local", "--persist-to", state,
    "--ip", "127.0.0.1", "--port", String(port), "--inspector-port", String(inspectorPort)], { cwd: web, env, stdin: "ignore", stdout: "pipe", stderr: "pipe", ...processGroup });
  serverOutput = Promise.all([new Response(server.stdout).text(), new Response(server.stderr).text()]).then((chunks) => chunks.join("\n"));
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    try { ready = (await request("/api/live")).ok; } catch { /* Wait for the owned Worker. */ }
    if (ready) break;
    if (server.exitCode !== null) throw new Error(`Local Worker exited: ${redact(await serverOutput)}`);
    await Bun.sleep(500);
  }
  assert.ok(ready, "Local Worker did not become ready");
  await seed();
  console.log(`Seeded ${fixture.nodes.length} nodes at ${base}`);

  if (serve) {
    console.log(`Serving ${base} until interrupted.`);
    await new Promise(() => undefined);
  } else if (screens) {
    await takeScreens(screens);
    console.log(`Screenshots written to ${screens}`);
  } else {
    const browser = await chromium.launch(process.env.STEED_BROWSER_CHANNEL ? { channel: process.env.STEED_BROWSER_CHANNEL } : {});
    try {
      const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
      await openTopology(page);
      const result = await clickEveryNode(page);
      console.log(`PASS clicked all ${result.clicked} topology nodes without a crash (${result.revealed} revealed through search first)`);
    } finally { await browser.close(); }
  }
} catch (error) {
  process.exitCode = 1;
  console.error(redact(error instanceof Error ? error.stack ?? error.message : String(error)));
} finally {
  await cleanup();
}
