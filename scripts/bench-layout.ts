import { topologySchema, type Topology } from "../packages/api/src/shared";
import { generateTopologyFixture } from "./topology-fixture";
import { layoutTopology } from "../apps/web/src/lib/topology-layout";
import { routeTopology } from "../apps/web/src/lib/topology-router";

export interface LayoutBenchmarkCase {
  name: string;
  topology: Topology;
  informational: boolean;
}

export interface LayoutBenchmarkRun {
  placementMs: number;
  routingMs: number;
  reportedRoutingMs: number;
  routes: number;
  failures: number;
  noPath: number;
  timeout: number;
}

export interface LayoutBenchmarkSummary {
  name: string;
  nodes: number;
  edges: number;
  informational: boolean;
  runs: LayoutBenchmarkRun[];
  placementMedianMs: number;
  routingMedianMs: number;
  maxFailures: number;
}

export const INFORMATIONAL_EDGE_ATTEMPT_LIMIT = 1000;

function mulberry32(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value = (value + 0x6d2b79f5) | 0;
    let result = Math.imul(value ^ (value >>> 15), 1 | value);
    result ^= result + Math.imul(result ^ (result >>> 7), 61 | result);
    return ((result ^ (result >>> 14)) >>> 0) / 4294967296;
  };
}

function fixed(value: number, width: number): string {
  return String(value).padStart(width, "0");
}

export function buildInformationalTopology(nodeCount: number, edgeCount: number): Topology {
  if (nodeCount !== 1000 || edgeCount !== 5000) {
    throw new Error(`Informational benchmark only supports 1000 nodes / 5000 edges; received ${nodeCount} / ${edgeCount}.`);
  }

  const layerCount = 20;
  const rootCount = 700;
  const satelliteCount = 200;
  const subSatelliteCount = 100;
  const colors = ["#2563eb", "#16a34a", "#9333ea", "#ea580c", "#0891b2", "#db2777"] as const;

  const layers = Array.from({ length: layerCount }, (_, index) => ({
    id: `bench-1000-layer-${fixed(index + 1, 2)}`,
    label: `Benchmark 1000 layer ${fixed(index + 1, 2)}`,
    provider: "Synthetic provider",
    order: index,
    color: colors[index % colors.length],
    description: "Synthetic informational benchmark layer.",
    provenance: "synthetic-fixture",
  }));

  const types = [
    {
      id: "bench-1000-host",
      label: "Benchmark host",
      shape: "rounded" as const,
      icon: "server",
      description: "Synthetic host.",
      attrs: [],
      provenance: "synthetic-fixture",
    },
    {
      id: "bench-1000-service",
      label: "Benchmark service",
      shape: "pill" as const,
      icon: "box",
      description: "Synthetic service.",
      attrs: [],
      provenance: "synthetic-fixture",
    },
    {
      id: "bench-1000-subservice",
      label: "Benchmark subservice",
      shape: "circle" as const,
      icon: "cpu",
      description: "Synthetic subservice.",
      attrs: [],
      provenance: "synthetic-fixture",
    },
  ];

  const boundaries = [
    ...Array.from({ length: 4 }, (_, index) => ({
      id: `bench-1000-trust-${fixed(index + 1, 2)}`,
      label: `Benchmark trust ${fixed(index + 1, 2)}`,
      kind: "trust" as const,
      style: { color: colors[index % colors.length], border: { style: "dashed" as const, width: 2 }, icon: "shield" },
      description: "Synthetic trust boundary.",
      provenance: "synthetic-fixture",
    })),
    ...Array.from({ length: 4 }, (_, index) => ({
      id: `bench-1000-site-${fixed(index + 1, 2)}`,
      label: `Benchmark site ${fixed(index + 1, 2)}`,
      kind: "site" as const,
      parentId: `bench-1000-trust-${fixed(index + 1, 2)}`,
      style: { color: colors[(index + 1) % colors.length], border: { style: "solid" as const, width: 1 }, icon: "globe" },
      description: "Synthetic site boundary.",
      provenance: "synthetic-fixture",
    })),
    ...Array.from({ length: 4 }, (_, index) => ({
      id: `bench-1000-network-${fixed(index + 1, 2)}`,
      label: `Benchmark network ${fixed(index + 1, 2)}`,
      kind: "network" as const,
      parentId: `bench-1000-site-${fixed(index + 1, 2)}`,
      style: { color: colors[(index + 2) % colors.length], border: { style: "dotted" as const, width: 2 }, icon: "network" },
      description: "Synthetic network boundary.",
      provenance: "synthetic-fixture",
    })),
  ];

  const rootNodes = Array.from({ length: rootCount }, (_, index) => ({
    id: `bench-1000-node-${fixed(index + 1, 4)}`,
    type: "bench-1000-host",
    label: `Benchmark host ${fixed(index + 1, 4)}`,
    layerId: `bench-1000-layer-${fixed(index % layerCount + 1, 2)}`,
    boundaryIds: index % 25 === 0
      ? [boundaries[index % boundaries.length]!.id]
      : index % 4 === 0
        ? [`bench-1000-trust-${fixed(index % 4 + 1, 2)}`]
        : index % 4 === 1
          ? [`bench-1000-site-${fixed(index % 4 + 1, 2)}`]
          : index % 4 === 2
            ? [`bench-1000-network-${fixed(index % 4 + 1, 2)}`]
            : [`bench-1000-trust-${fixed(index % 4 + 1, 2)}`, `bench-1000-site-${fixed(index % 4 + 1, 2)}`],
    lifecycle: (["active", "planned", "deprecated", "retired"] as const)[index % 4],
    description: "Synthetic benchmark host.",
    tags: ["synthetic-fixture", "benchmark-1000"],
    attrs: { index },
    provenance: "synthetic-fixture",
  }));

  const satellites = Array.from({ length: satelliteCount }, (_, index) => {
    const root = rootNodes[index % rootNodes.length]!;
    return {
      id: `bench-1000-satellite-${fixed(index + 1, 4)}`,
      type: "bench-1000-service",
      label: `Benchmark service ${fixed(index + 1, 4)}`,
      layerId: root.layerId,
      parentId: root.id,
      role: "service" as const,
      boundaryIds: [] as string[],
      lifecycle: (["active", "planned", "deprecated", "retired"] as const)[index % 4],
      description: "Synthetic benchmark service.",
      tags: ["synthetic-fixture", "benchmark-1000", "satellite-depth-1"],
      attrs: { index },
      provenance: "synthetic-fixture",
    };
  });

  const subSatellites = Array.from({ length: subSatelliteCount }, (_, index) => {
    const parent = satellites[index % satellites.length]!;
    return {
      id: `bench-1000-sub-${fixed(index + 1, 4)}`,
      type: "bench-1000-subservice",
      label: `Benchmark subservice ${fixed(index + 1, 4)}`,
      layerId: parent.layerId,
      parentId: parent.id,
      role: "subresource" as const,
      boundaryIds: [] as string[],
      lifecycle: (["active", "planned", "deprecated", "retired"] as const)[index % 4],
      description: "Synthetic benchmark subservice.",
      tags: ["synthetic-fixture", "benchmark-1000", "satellite-depth-2"],
      attrs: { index },
      provenance: "synthetic-fixture",
    };
  });

  const nodes = [...rootNodes, ...satellites, ...subSatellites];
  const edges: Array<Record<string, unknown>> = [];
  const edgeKeys = new Set<string>();
  const kinds = ["traffic", "dns", "binding", "deploy", "auth", "monitor", "uses", "tunnel"] as const;
  const random = mulberry32(1000000 + nodeCount * 10 + edgeCount);
  const crossCount = Math.round(edgeCount * 0.35);
  const rootsByLayer = new Map<string, typeof rootNodes>();
  for (const root of rootNodes) {
    const roots = rootsByLayer.get(root.layerId) ?? [];
    roots.push(root);
    rootsByLayer.set(root.layerId, roots);
  }

  let generationAttempts = 0;
  const totalAttemptLimit = edgeCount * INFORMATIONAL_EDGE_ATTEMPT_LIMIT;
  while (edges.length < edgeCount && generationAttempts < totalAttemptLimit) {
    const cross = edges.length < crossCount;
    let edgeAdded = false;

    for (let attempt = 0; attempt < INFORMATIONAL_EDGE_ATTEMPT_LIMIT; attempt++) {
      generationAttempts++;
      if (generationAttempts > totalAttemptLimit) break;

      const source = rootNodes[Math.floor(random() * rootCount)]!;
      let target: (typeof rootNodes)[number] | undefined;

      if (cross) {
        const candidate = rootNodes[Math.floor(random() * rootCount)]!;
        if (candidate.id !== source.id && candidate.layerId !== source.layerId) target = candidate;
      } else {
        const candidates = rootsByLayer.get(source.layerId) ?? [];
        if (candidates.length > 1) {
          const candidate = candidates[Math.floor(random() * candidates.length)]!;
          if (candidate.id !== source.id) target = candidate;
        }
      }

      if (!target) continue;
      const kind = kinds[Math.floor(random() * kinds.length)]!;
      const key = `${source.id}\0${target.id}\0${kind}`;
      if (edgeKeys.has(key)) continue;

      edgeKeys.add(key);
      edges.push({
        id: `bench-1000-edge-${fixed(edges.length + 1, 4)}`,
        source: source.id,
        target: target.id,
        kind,
        label: `Benchmark edge ${fixed(edges.length + 1, 4)}`,
        protocol: edges.length % 3 === 0 ? "HTTPS" : edges.length % 3 === 1 ? "TCP" : undefined,
        port: edges.length % 3 === 0 ? 443 : edges.length % 3 === 1 ? 8443 : undefined,
        direction: edges.length % 17 === 0 ? "bi" : "uni",
        evidence: edges.length % 5 === 0 ? "inferred" : "documented",
        description: "Synthetic benchmark edge.",
        tags: ["synthetic-fixture", "benchmark-1000"],
        style: {
          dash: edges.length % 3 === 0 ? "solid" : edges.length % 3 === 1 ? "dashed" : "dotted",
          width: edges.length % 4 + 1,
          animated: edges.length % 7 === 0,
        },
        provenance: "synthetic-fixture",
      });
      edgeAdded = true;
      break;
    }

    if (!edgeAdded) {
      throw new Error(`Benchmark construction exhausted ${INFORMATIONAL_EDGE_ATTEMPT_LIMIT} attempts for edge ${edges.length + 1} (${cross ? "cross-layer" : "same-layer"}).`);
    }
  }

  if (nodes.length !== nodeCount) throw new Error(`Benchmark construction produced ${nodes.length} nodes instead of ${nodeCount}.`);
  if (edges.length !== edgeCount) throw new Error(`Benchmark construction produced ${edges.length} edges instead of ${edgeCount}.`);

  const topology = topologySchema.parse({
    schemaVersion: 2,
    title: "Synthetic layout benchmark 1000",
    description: "Synthetic informational topology benchmark.",
    revision: 1,
    provenance: "synthetic-fixture",
    layers,
    types,
    boundaries,
    nodes,
    edges,
    views: [{
      id: "bench-1000-overview",
      label: "Benchmark overview",
      description: "Synthetic informational benchmark view.",
      filter: { layerIds: [], typeIds: [], boundaryIds: [], tags: [] },
      provenance: "synthetic-fixture",
    }],
  });
  return topology;
}

export function layoutBenchmarkCases(): LayoutBenchmarkCase[] {
  return [
    { name: "topology-200/400", topology: generateTopologyFixture("topology-200"), informational: false },
    { name: "topology-500/1000", topology: generateTopologyFixture("topology-500"), informational: false },
    { name: "topology-1000/5000", topology: buildInformationalTopology(1000, 5000), informational: true },
  ];
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length >>> 1;
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!)/2;
}

export function benchmarkLayout(caseDefinition: LayoutBenchmarkCase, runCount: number): LayoutBenchmarkSummary {
  if (runCount < 1) throw new Error("Benchmark runCount must be at least 1.");

  const runs: LayoutBenchmarkRun[] = [];
  for (let run = 0; run < runCount; run++) {
    const placementStart = performance.now();
    const layout = layoutTopology(caseDefinition.topology);
    const placementMs = performance.now() - placementStart;

    const routingStart = performance.now();
    const result = routeTopology(caseDefinition.topology, layout);
    const routingMs = performance.now() - routingStart;

    const counts = { noPath: 0, timeout: 0 };
    for (const failure of result.diagnostics.routeFailures) {
      if (failure.reason === "no_path") counts.noPath++;
      if (failure.reason === "timeout") counts.timeout++;
    }

    runs.push({
      placementMs,
      routingMs,
      reportedRoutingMs: result.diagnostics.elapsedMs,
      routes: Object.keys(result.routes).length,
      failures: result.diagnostics.routeFailures.length,
      noPath: counts.noPath,
      timeout: counts.timeout,
    });
  }

  return {
    name: caseDefinition.name,
    nodes: caseDefinition.topology.nodes.length,
    edges: caseDefinition.topology.edges.length,
    informational: caseDefinition.informational,
    runs,
    placementMedianMs: median(runs.map((run) => run.placementMs)),
    routingMedianMs: median(runs.map((run) => run.routingMs)),
    maxFailures: Math.max(...runs.map((run) => run.failures)),
  };
}

export function formatLayoutBenchmark(summary: LayoutBenchmarkSummary): string {
  const header = `${summary.name}${summary.informational ? " (informational)" : ""} nodes=${summary.nodes} edges=${summary.edges}`;
  const totals = summary.runs.map((run) =>
    `placement=${run.placementMs.toFixed(2)}ms routing=${run.routingMs.toFixed(2)}ms router=${run.reportedRoutingMs.toFixed(2)}ms routes=${run.routes} failures=${run.failures} no_path=${run.noPath} timeout=${run.timeout}`,
  ).join(" | ");
  return `${header} | median placement=${summary.placementMedianMs.toFixed(2)}ms routing=${summary.routingMedianMs.toFixed(2)}ms | ${totals}`;
}

if (import.meta.main) {
  const runCount = process.argv.includes("--repeats")
    ? Number(process.argv[process.argv.indexOf("--repeats") + 1] ?? 3)
    : 3;

  if (!Number.isInteger(runCount) || runCount < 1) throw new Error("--repeats must be a positive integer.");

  for (const caseDefinition of layoutBenchmarkCases()) {
    const repeatCount = caseDefinition.informational ? Math.min(runCount, 1) : runCount;
    const summary = benchmarkLayout(caseDefinition, repeatCount);
    console.log(formatLayoutBenchmark(summary));
  }
}
