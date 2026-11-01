import { createHash } from "node:crypto";
import { topologySchema, type Topology } from "../packages/api/src/shared";

export type TopologyFixtureName = "topology-200" | "topology-500";

export const TOPOLOGY_FIXTURE_SEEDS = {
  "topology-200": 200_001,
  "topology-500": 500_001,
} as const;

const SHAPES = ["rect", "rounded", "pill", "hexagon", "cylinder", "diamond", "circle", "cloud"] as const;
const SIZES = ["s", "m", "l"] as const;
const BORDER_STYLES = ["solid", "dashed", "dotted", "double"] as const;
const LIFECYCLES = ["active", "planned", "deprecated", "retired"] as const;
const EDGE_KINDS = ["traffic", "dns", "binding", "deploy", "auth", "monitor", "uses", "tunnel"] as const;
const COLORS = ["#2563eb", "#16a34a", "#9333ea", "#ea580c", "#0891b2", "#db2777"] as const;

export function mulberry32(seed: number): () => number {
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

export function generateTopologyFixture(name: TopologyFixtureName): Topology {
  const nodeCount = name === "topology-200" ? 200 : 500;
  const edgeCount = name === "topology-200" ? 400 : 1000;
  const layerCount = name === "topology-200" ? 8 : 10;
  const satelliteCount = Math.round(nodeCount * 0.3);
  const depthOneCount = Math.round(satelliteCount * 2 / 3);
  const depthTwoCount = satelliteCount - depthOneCount;
  const rootCount = nodeCount - satelliteCount;
  const seed = TOPOLOGY_FIXTURE_SEEDS[name];
  const random = mulberry32(seed);
  const prefix = name === "topology-200" ? "200" : "500";

  const layers = Array.from({ length: layerCount }, (_, index) => ({
    id: `test-${prefix}-layer-${fixed(index + 1, 2)}`,
    label: `TEST fixture ${prefix} layer ${fixed(index + 1, 2)}`,
    provider: `Synthetic provider ${fixed(index + 1, 2)}`,
    order: index,
    color: COLORS[index % COLORS.length],
    description: "Synthetic topology fixture data.",
    provenance: "synthetic-fixture",
  }));

  const types = [
    {
      id: `test-${prefix}-host`,
      label: "TEST synthetic host",
      shape: "rounded" as const,
      icon: "server",
      description: "Synthetic host type.",
      attrs: [],
      provenance: "synthetic-fixture",
    },
    {
      id: `test-${prefix}-service`,
      label: "TEST synthetic service",
      shape: "pill" as const,
      icon: "box",
      description: "Synthetic first-level satellite type.",
      attrs: [],
      provenance: "synthetic-fixture",
    },
    {
      id: `test-${prefix}-subservice`,
      label: "TEST synthetic subservice",
      shape: "circle" as const,
      icon: "cpu",
      description: "Synthetic depth-two satellite type.",
      attrs: [],
      provenance: "synthetic-fixture",
    },
  ];

  const boundaries = [
    ...Array.from({ length: 4 }, (_, index) => ({
      id: `test-${prefix}-trust-${fixed(index + 1, 2)}`,
      label: `TEST synthetic trust ${fixed(index + 1, 2)}`,
      kind: "trust" as const,
      style: {
        color: COLORS[index % COLORS.length],
        border: { style: "dashed" as const, width: 2 },
        icon: "shield",
      },
      description: "Synthetic trust boundary.",
      provenance: "synthetic-fixture",
    })),
    ...Array.from({ length: 4 }, (_, index) => ({
      id: `test-${prefix}-site-${fixed(index + 1, 2)}`,
      label: `TEST synthetic site ${fixed(index + 1, 2)}`,
      kind: "site" as const,
      parentId: `test-${prefix}-trust-${fixed(index + 1, 2)}`,
      style: {
        color: COLORS[(index + 1) % COLORS.length],
        border: { style: "solid" as const, width: 1 },
        icon: "globe",
      },
      description: "Synthetic site boundary.",
      provenance: "synthetic-fixture",
    })),
    ...Array.from({ length: 4 }, (_, index) => ({
      id: `test-${prefix}-network-${fixed(index + 1, 2)}`,
      label: `TEST synthetic network ${fixed(index + 1, 2)}`,
      kind: "network" as const,
      parentId: `test-${prefix}-site-${fixed(index + 1, 2)}`,
      style: {
        color: COLORS[(index + 2) % COLORS.length],
        border: { style: "dotted" as const, width: 2 },
        icon: "network",
      },
      description: "Synthetic network boundary.",
      provenance: "synthetic-fixture",
    })),
  ];

  const nodes: Array<{
    id: string;
    type: string;
    label: string;
    layerId: string;
    boundaryIds: string[];
    parentId?: string;
    role?: "service" | "subresource";
    lifecycle: "active" | "planned" | "deprecated" | "retired";
    tags: string[];
    attrs: Record<string, string | number | boolean | string[]>;
    style: {
      shape: (typeof SHAPES)[number];
      size: "s" | "m" | "l";
      color: string;
      border: { style: (typeof BORDER_STYLES)[number]; width: number; color: string };
      icon: string;
    };
    description: string;
    provenance: "synthetic-fixture";
  }> = [];

  const rootNodes: typeof nodes = [];
  for (let index = 0; index < rootCount; index++) {
    const hostIndex = index;
    const chainIndex = index % 4;
    const boundaryIds = hostIndex % 25 === 0
      ? Array.from({ length: 8 }, (_, boundaryIndex) => boundaries[boundaryIndex]!.id)
      : hostIndex % 4 === 0
        ? [`test-${prefix}-trust-${fixed(chainIndex + 1, 2)}`]
        : hostIndex % 4 === 1
          ? [`test-${prefix}-site-${fixed(chainIndex + 1, 2)}`]
          : hostIndex % 4 === 2
            ? [`test-${prefix}-network-${fixed((Math.floor(hostIndex / 4) % 4) + 1, 2)}`]
            : [`test-${prefix}-trust-${fixed(chainIndex + 1, 2)}`, `test-${prefix}-site-${fixed(chainIndex + 1, 2)}`];
    const node = {
      id: `test-${prefix}-node-${fixed(hostIndex + 1, 4)}`,
      type: `test-${prefix}-host`,
      label: `TEST synthetic host ${fixed(hostIndex + 1, 4)}`,
      layerId: layers[hostIndex % layerCount]!.id,
      boundaryIds,
      lifecycle: LIFECYCLES[hostIndex % LIFECYCLES.length]!,
      tags: ["synthetic-fixture", `fixture-${prefix}`],
      attrs: {},
      style: {
        shape: SHAPES[hostIndex % SHAPES.length]!,
        size: SIZES[hostIndex % SIZES.length]!,
        color: COLORS[hostIndex % COLORS.length]!,
        border: {
          style: BORDER_STYLES[hostIndex % BORDER_STYLES.length]!,
          width: hostIndex % 5,
          color: COLORS[(hostIndex + 2) % COLORS.length]!,
        },
        icon: ["server", "database", "globe", "cloud", "network", "laptop", "monitor", "hard-drive"][hostIndex % 8]!,
      },
      description: "Synthetic host fixture node.",
      provenance: "synthetic-fixture" as const,
    };
    nodes.push(node);
    rootNodes.push(node);
  }

  const depthOneNodes: typeof nodes = [];
  for (let index = 0; index < depthOneCount; index++) {
    const root = rootNodes[index % rootNodes.length]!;
    const satelliteIndex = index;
    const node = {
      id: `test-${prefix}-satellite-${fixed(satelliteIndex + 1, 4)}`,
      type: `test-${prefix}-service`,
      label: `TEST synthetic service ${fixed(satelliteIndex + 1, 4)}`,
      layerId: root.layerId,
      boundaryIds: [] as string[],
      parentId: root.id,
      role: "service" as const,
      lifecycle: LIFECYCLES[satelliteIndex % LIFECYCLES.length]!,
      tags: ["synthetic-fixture", `fixture-${prefix}`, "satellite-depth-1"],
      attrs: {},
      style: {
        shape: SHAPES[(satelliteIndex + 1) % SHAPES.length]!,
        size: satelliteIndex % 2 === 0 ? "s" as const : "m" as const,
        color: COLORS[(satelliteIndex + 1) % COLORS.length]!,
        border: {
          style: BORDER_STYLES[(satelliteIndex + 1) % BORDER_STYLES.length]!,
          width: (satelliteIndex % 5),
          color: COLORS[(satelliteIndex + 3) % COLORS.length]!,
        },
        icon: ["box", "bot", "git-branch", "shield", "key", "cpu"][satelliteIndex % 6]!,
      },
      description: "Synthetic first-level satellite fixture node.",
      provenance: "synthetic-fixture" as const,
    };
    nodes.push(node);
    depthOneNodes.push(node);
  }

  for (let index = 0; index < depthTwoCount; index++) {
    const parent = depthOneNodes[index % depthOneNodes.length]!;
    const satelliteIndex = depthOneCount + index;
    nodes.push({
      id: `test-${prefix}-satellite-${fixed(satelliteIndex + 1, 4)}`,
      type: `test-${prefix}-subservice`,
      label: `TEST synthetic subservice ${fixed(index + 1, 4)}`,
      layerId: parent.layerId,
      boundaryIds: [],
      parentId: parent.id,
      role: "subresource",
      lifecycle: LIFECYCLES[satelliteIndex % LIFECYCLES.length]!,
      tags: ["synthetic-fixture", `fixture-${prefix}`, "satellite-depth-2"],
      attrs: {},
      style: {
        shape: SHAPES[(satelliteIndex + 2) % SHAPES.length]!,
        size: satelliteIndex % 2 === 0 ? "s" : "m",
        color: COLORS[(satelliteIndex + 2) % COLORS.length]!,
        border: {
          style: BORDER_STYLES[(satelliteIndex + 2) % BORDER_STYLES.length]!,
          width: satelliteIndex % 5,
          color: COLORS[(satelliteIndex + 4) % COLORS.length]!,
        },
        icon: ["cpu", "database", "key", "box"][satelliteIndex % 4]!,
      },
      description: "Synthetic depth-two satellite fixture node.",
      provenance: "synthetic-fixture",
    });
  }

  const crossCount = Math.round(edgeCount * 0.35);
  const edges: Array<{
    id: string;
    source: string;
    target: string;
    kind: (typeof EDGE_KINDS)[number];
    label: string;
    protocol?: string;
    port?: number;
    direction: "uni" | "bi";
    evidence: "documented" | "inferred";
    description: string;
    tags: string[];
    style: { dash: "solid" | "dashed" | "dotted"; width: number; animated: boolean };
    provenance: "synthetic-fixture";
  }> = [];
  const edgeKeys = new Set<string>();

  for (let index = 0; index < edgeCount; index++) {
    let source = rootNodes[Math.floor(random() * rootNodes.length)]!;
    let target = rootNodes[Math.floor(random() * rootNodes.length)]!;
    const crossLayer = index < crossCount;
    let attempts = 0;
    while (attempts < 1000) {
      source = rootNodes[Math.floor(random() * rootNodes.length)]!;
      target = rootNodes[Math.floor(random() * rootNodes.length)]!;
      if (source.id === target.id) { attempts++; continue; }
      if (crossLayer && source.layerId === target.layerId) { attempts++; continue; }
      if (!crossLayer && source.layerId !== target.layerId) { attempts++; continue; }
      const kind = EDGE_KINDS[index % EDGE_KINDS.length]!;
      const key = `${source.id}\0${target.id}\0${kind}`;
      if (!edgeKeys.has(key)) break;
      attempts++;
    }

    const kind = EDGE_KINDS[index % EDGE_KINDS.length]!;
    const edgeKey = `${source.id}\0${target.id}\0${kind}`;
    if (source.id === target.id || edgeKeys.has(edgeKey)) continue;
    edgeKeys.add(edgeKey);

    const protocol = index % 3 === 0 ? "HTTPS" : index % 3 === 1 ? "TCP" : undefined;
    const port = index % 3 === 0 ? 443 : index % 3 === 1 ? 8443 : undefined;
    edges.push({
      id: `test-${prefix}-edge-${fixed(index + 1, 4)}`,
      source: source.id,
      target: target.id,
      kind,
      label: `TEST fixture edge ${fixed(index + 1, 4)}`,
      ...(protocol ? { protocol } : {}),
      ...(port ? { port } : {}),
      direction: index % 17 === 0 ? "bi" : "uni",
      evidence: index % 5 === 0 ? "inferred" : "documented",
      description: "Synthetic relationship fixture edge.",
      tags: ["synthetic-fixture", `fixture-${prefix}`],
      style: {
        dash: index % 3 === 0 ? "solid" : index % 3 === 1 ? "dashed" : "dotted",
        width: index % 4 + 1,
        animated: index % 7 === 0,
      },
      provenance: "synthetic-fixture",
    });
  }

  if (edges.length !== edgeCount) {
    throw new Error(`Fixture ${name} generated ${edges.length} edges instead of ${edgeCount}.`);
  }

  const candidate = {
    schemaVersion: 2 as const,
    title: `Synthetic topology fixture ${prefix}`,
    description: "Generated synthetic data for local layout testing.",
    revision: 1,
    provenance: "synthetic-fixture" as const,
    layers,
    types,
    boundaries,
    nodes,
    edges,
    views: [{
      id: `test-${prefix}-overview`,
      label: `TEST synthetic overview ${prefix}`,
      description: "Synthetic fixture overview view.",
      filter: { layerIds: [], typeIds: [], boundaryIds: [], tags: [] },
      pins: Object.fromEntries(rootNodes.slice(0, 12).map((node, index) => [node.id, { x: index % 4 * 240, y: Math.floor(index / 4) * 112 }])),
      provenance: "synthetic-fixture",
    }],
  };

  return topologySchema.parse(candidate);
}

export const generateTopology200 = () => generateTopologyFixture("topology-200");
export const generateTopology500 = () => generateTopologyFixture("topology-500");
export const topologyFixture200 = generateTopology200;
export const topologyFixture500 = generateTopology500;

export function topologyFixtureDocumentHash(topology: Topology): string {
  return createHash("sha256").update(JSON.stringify(topology)).digest("hex");
}

export const topologyFixtureHash = topologyFixtureDocumentHash;

export function topologyFixtureHashFor(name: TopologyFixtureName): string {
  return topologyFixtureDocumentHash(generateTopologyFixture(name));
}

export const TOPOLOGY_FIXTURE_NAMES: readonly TopologyFixtureName[] = ["topology-200", "topology-500"];

if (import.meta.main) {
  const name = process.argv[2] as TopologyFixtureName | undefined;
  if (name && TOPOLOGY_FIXTURE_NAMES.includes(name)) {
    console.log(JSON.stringify(generateTopologyFixture(name), null, 2));
  } else {
    console.log(JSON.stringify({
      "topology-200": topologyFixtureHashFor("topology-200"),
      "topology-500": topologyFixtureHashFor("topology-500"),
    }, null, 2));
  }
}
