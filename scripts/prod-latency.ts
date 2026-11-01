// Production latency probe for the Topology Connect API. Read-only: GETs plus POST /topology/validate,
// which plans an operation batch against the live graph and never writes topology data.
//
//   STEED_TOKEN=steedc_... bun scripts/prod-latency.ts      # unauthenticated + token probes
//   bun scripts/prod-latency.ts                              # unauthenticated probes only
//
// STEED_TOKEN needs topology:write for the validate probe (a read token skips it).
// STEED_BASE_URL (default https://steed.hexly.ai) and STEED_LATENCY_N (default 20) are optional.
// One run sends 4 x (N + 1) reads and N + 1 validates, inside the 120 read / 30 write per-minute
// token limits for N = 20; wait a minute between runs. The token is never printed.

const base = (process.env.STEED_BASE_URL ?? "https://steed.hexly.ai").replace(/\/+$/, "");
const samples = Number(process.env.STEED_LATENCY_N ?? "20");
const token = process.env.STEED_TOKEN?.trim() || undefined;
if (!Number.isInteger(samples) || samples < 1 || samples > 25) throw new Error("STEED_LATENCY_N must be an integer from 1 to 25.");

interface Probe { name: string; path: string; method?: "GET" | "POST"; auth: boolean; expect: number; body?: unknown }
const validateBody = { operations: [{ op: "set_metadata", description: "latency probe" }] };
const probes: Probe[] = [
  { name: "live", path: "/api/live", auth: false, expect: 200 },
  { name: "capabilities (no token)", path: "/api/v1/capabilities", auth: false, expect: 401 },
];
if (token) probes.push(
  { name: "capabilities", path: "/api/v1/capabilities", auth: true, expect: 200 },
  { name: "topology", path: "/api/v1/topology", auth: true, expect: 200 },
  { name: "changes", path: "/api/v1/topology/changes?limit=20", auth: true, expect: 200 },
  { name: "nodes", path: "/api/v1/topology/nodes", auth: true, expect: 200 },
  { name: "validate", path: "/api/v1/topology/validate", method: "POST", auth: true, expect: 200, body: validateBody },
);

function quantile(sorted: number[], q: number) {
  return sorted[Math.min(sorted.length - 1, Math.ceil(q * sorted.length) - 1)]!;
}

async function once(probe: Probe) {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (probe.auth && token) headers.Authorization = `Bearer ${token}`;
  if (probe.body !== undefined) headers["Content-Type"] = "application/json";
  const started = performance.now();
  const response = await fetch(`${base}${probe.path}`, {
    method: probe.method ?? "GET", headers, ...(probe.body === undefined ? {} : { body: JSON.stringify(probe.body) }),
  });
  await response.arrayBuffer();
  return { ms: performance.now() - started, status: response.status, colo: response.headers.get("cf-ray")?.split("-")[1] ?? "?",
    placement: response.headers.get("cf-placement") ?? "-" };
}

const rows: string[][] = [];
let failed = false;
for (const probe of probes) {
  const warm = await once(probe);
  if (warm.status === 403 && probe.name === "validate") { rows.push([probe.name, "skipped: token lacks topology:write"]); continue; }
  const results = [];
  for (let index = 0; index < samples; index += 1) results.push(await once(probe));
  const times = results.map((result) => result.ms).sort((a, b) => a - b);
  const statuses = [...new Set(results.map((result) => result.status))].join("/");
  if (results.some((result) => result.status !== probe.expect)) failed = true;
  rows.push([probe.name, statuses, String(samples), ...[0.5, 0.95].map((q) => quantile(times, q).toFixed(0)), times.at(-1)!.toFixed(0),
    results[0]!.colo, results[0]!.placement]);
}
const header = ["endpoint", "status", "n", "p50 ms", "p95 ms", "max ms", "colo", "cf-placement"];
const table = [header, ...rows];
const widths = header.map((_, column) => Math.max(...table.map((row) => (row[column] ?? "").length)));
console.log(`${base} at ${new Date().toISOString()}${token ? "" : " (no STEED_TOKEN: unauthenticated probes only)"}`);
for (const row of table) console.log(row.map((cell, column) => cell.padEnd(widths[column]!)).join("  ").trimEnd());
if (failed) { console.error("Some responses had an unexpected status (see the status column)."); process.exitCode = 1; }
