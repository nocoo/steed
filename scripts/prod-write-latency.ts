// Production incremental-write latency probe, read from Server-Timing. It WRITES to production:
// it requires an empty topology, seeds the `test-` acceptance fixture (245 nodes, 105 edges), sends
// N single put_node operations, then always replaces the topology with an empty one carrying the
// original title, description and provenance, and checks that 0 entities remain.
//
//   STEED_TOKEN=steedc_... bun scripts/prod-write-latency.ts
//
// STEED_TOKEN needs topology:write. STEED_BASE_URL (default https://steed.hexly.ai), STEED_WRITE_N
// (default 100, 1-200) and STEED_WRITE_GAP_MS (default 2200, at least 2000) are optional. The gap
// keeps writes under the 30 per minute token limit (100 writes take about five minutes). The token
// is never printed. `<segment>-net` is the segment minus its D1-reported SQL time: round trip,
// queueing and commit outside SQL.
import { emptyTopology, type Topology } from "@steed/api/shared";

const base = (process.env.STEED_BASE_URL ?? "https://steed.hexly.ai").replace(/\/+$/, "");
const token = process.env.STEED_TOKEN?.trim();
const samples = Number(process.env.STEED_WRITE_N ?? "100");
const gap = Number(process.env.STEED_WRITE_GAP_MS ?? "2200");
if (!token) throw new Error("STEED_TOKEN (topology:write) is required.");
if (!Number.isInteger(samples) || samples < 1 || samples > 200) throw new Error("STEED_WRITE_N must be an integer from 1 to 200.");
if (!Number.isFinite(gap) || gap < 2000) throw new Error("STEED_WRITE_GAP_MS must be at least 2000.");
const collections = ["layers", "types", "boundaries", "nodes", "edges", "views"] as const;
const fixture = await Bun.file(new URL("../apps/web/e2e/acceptance-topology.json", import.meta.url)).json() as Topology;
for (const collection of collections) for (const entity of fixture[collection]) {
  if (!entity.id.startsWith("test-")) throw new Error(`Fixture id ${entity.id} is not test- prefixed.`);
}

interface Sample { ms: number; status: number; etag: string | null; timing: Record<string, number>; cold: boolean; colo: string }
async function call(path: string, method = "GET", body?: unknown, headers: Record<string, string> = {}): Promise<Sample & { json: unknown }> {
  const started = performance.now();
  const response = await fetch(`${base}${path}`, { method, headers: { Accept: "application/json", Authorization: `Bearer ${token}`,
    ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const json = await response.json().catch(() => null);
  const ms = performance.now() - started;
  const timing: Record<string, number> = {};
  let cold = false;
  for (const part of (response.headers.get("Server-Timing") ?? "").split(",").map((value) => value.trim()).filter(Boolean)) {
    const [name, ...params] = part.split(";");
    if (name === "cold") cold = true;
    const dur = params.find((param) => param.startsWith("dur="));
    if (name && dur) timing[name] = Number(dur.slice(4));
  }
  for (const segment of ["auth", "read", "write"]) {
    const sql = timing[`${segment}-sql`];
    if (timing[segment] !== undefined && sql !== undefined) timing[`${segment}-net`] = Math.round((timing[segment] - sql) * 10) / 10;
  }
  return { ms, status: response.status, etag: response.headers.get("ETag"), timing, cold, colo: response.headers.get("X-Steed-Colo") ?? "-", json };
}
const key = () => `prod-write-latency-${crypto.randomUUID()}`;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
function quantile(values: number[], q: number) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(q * sorted.length) - 1)] ?? NaN;
}

const before = await call("/api/v1/topology");
if (before.status !== 200 || !before.etag) throw new Error(`Topology read failed with ${before.status}.`);
const current = (before.json as { data: Topology }).data;
const counts = collections.map((collection) => current[collection].length);
if (counts.some(Boolean)) throw new Error(`Production topology is not empty (${counts.join("/")}); refusing to write.`);
const metadata = { title: current.title, description: current.description, ...(current.provenance === undefined ? {} : { provenance: current.provenance }) };
let etag = before.etag;
const writes: Sample[] = [];
const live: number[] = [];
let seeded = false;
try {
  const seed = await call("/api/v1/topology", "PUT", fixture, { "If-Match": etag, "Idempotency-Key": key() });
  if (seed.status !== 200 || !seed.etag) throw new Error(`Seeding failed with ${seed.status}.`);
  seeded = true; etag = seed.etag;
  const hosts = fixture.nodes.slice(0, samples);
  for (let index = 0; index < samples; index++) {
    await sleep(gap);
    const node = { ...hosts[index % hosts.length]!, description: `write-latency probe ${index}` };
    const write = await call("/api/v1/topology/operations", "POST", { operations: [{ op: "put_node", value: node }] }, { "If-Match": etag, "Idempotency-Key": key() });
    if (write.status !== 200 || !write.etag) throw new Error(`Write ${index} failed with ${write.status}.`);
    etag = write.etag; writes.push(write);
    const started = performance.now();
    await (await fetch(`${base}/api/live`)).arrayBuffer();
    live.push(performance.now() - started);
    console.log(`write ${String(index).padStart(2)}  client ${write.ms.toFixed(0).padStart(5)} ms  ${Object.entries(write.timing).map(([name, value]) => `${name}=${value}`).join(" ")}${write.cold ? " cold" : ""}`);
  }
} finally {
  if (seeded) {
    const cleared = await call("/api/v1/topology", "PUT", { ...emptyTopology(metadata.title), ...metadata },
      { "If-Match": etag, "Idempotency-Key": key(), "X-Steed-Confirm": "topology" });
    console.log(`clear: ${cleared.status} ${cleared.etag ?? ""}`);
  }
  const after = await call("/api/v1/topology");
  const left = after.status === 200 ? collections.map((collection) => (after.json as { data: Topology }).data[collection].length) : [];
  console.log(`final: ${after.status} ${after.etag ?? ""} entities ${left.join("/")}`);
  if (after.status !== 200 || left.some(Boolean)) process.exitCode = 1;
}
const metrics = ["client", ...new Set(writes.flatMap((write) => Object.keys(write.timing)))];
console.log(`\n${base} at ${new Date().toISOString()}, ${writes.length} put_node writes, colo ${[...new Set(writes.map((write) => write.colo))].join("/")}, cold ${writes.filter((write) => write.cold).length}`);
console.log(`live baseline p50 ${quantile(live, 0.5).toFixed(0)} ms, p95 ${quantile(live, 0.95).toFixed(0)} ms`);
console.log("metric       p50     p90     p95     p99     max");
for (const metric of metrics) {
  const values = writes.map((write) => metric === "client" ? write.ms : write.timing[metric]).filter((value): value is number => typeof value === "number");
  if (values.length) console.log(`${metric.padEnd(10)} ${[0.5, 0.9, 0.95, 0.99, 1].map((q) => quantile(values, q).toFixed(1).padStart(7)).join(" ")}`);
}
