import { describe, expect, it } from "vitest";
import {
  generateTopologyFixture,
  topologyFixtureDocumentHash,
  type TopologyFixtureName,
} from "../../../../scripts/topology-fixture";
import { validateTopology, type Topology } from "./topology";

const PINNED_HASHES: Record<TopologyFixtureName, string> = {
  "topology-200": "6e2ca7866905938802eae66a8e84c87144f95d4dfb036ce5cd22322268bbffb6",
  "topology-500": "b44b06aab53f1b7604602334cf95bed2c6917060b11dfdaca159a14bcd5dc388",
};

function fixture(name: TopologyFixtureName): Topology {
  return generateTopologyFixture(name);
}

function satelliteCounts(topology: Topology) {
  const depthOne = topology.nodes.filter((node) => node.parentId !== undefined && topology.nodes.find((parent) => parent.id === node.parentId)?.parentId === undefined);
  const depthTwo = topology.nodes.filter((node) => {
    if (!node.parentId) return false;
    const parent = topology.nodes.find((candidate) => candidate.id === node.parentId);
    return parent?.parentId !== undefined;
  });
  return { depthOne: depthOne.length, depthTwo: depthTwo.length };
}

describe("seeded topology fixtures", () => {
  it.each([
    ["topology-200", 8, 200, 400, 140, 60, 40, 20],
    ["topology-500", 10, 500, 1000, 350, 150, 100, 50],
  ] as const)("generates %s with the exact synthetic mix", (name, layerCount, nodeCount, edgeCount, crossCount, satelliteCount, depthOneCount, depthTwoCount) => {
    const topology = fixture(name);
    const validation = validateTopology(topology);
    const satellites = satelliteCounts(topology);

    expect(validation.data).toBeDefined();
    expect(validation.issues).toEqual([]);
    expect(topology.layers).toHaveLength(layerCount);
    expect(topology.nodes).toHaveLength(nodeCount);
    expect(topology.edges).toHaveLength(edgeCount);
    expect(topology.boundaries).toHaveLength(12);
    expect(satellites.depthOne).toBe(depthOneCount);
    expect(satellites.depthTwo).toBe(depthTwoCount);
    expect(topology.nodes.filter((node) => node.parentId !== undefined)).toHaveLength(satelliteCount);
    expect(topology.edges.filter((edge) => {
      const source = topology.nodes.find((node) => node.id === edge.source);
      const target = topology.nodes.find((node) => node.id === edge.target);
      return source?.layerId !== target?.layerId;
    })).toHaveLength(crossCount);
  });

  it.each(["topology-200", "topology-500"] as const)("is deterministic and schema-valid: %s", (name) => {
    const first = fixture(name);
    const second = fixture(name);

    expect(second).toEqual(first);
    expect(topologyFixtureDocumentHash(second)).toBe(topologyFixtureDocumentHash(first));
    expect(validateTopology(first).issues).toEqual([]);
  });

  it.each(["topology-200", "topology-500"] as const)("pins the canonical SHA-256: %s", (name) => {
    const hash = topologyFixtureDocumentHash(fixture(name));
    expect(hash).not.toBe("PENDING");
    expect(hash).toBe(PINNED_HASHES[name]);
  });

  it.each(["topology-200", "topology-500"] as const)("covers shapes, sizes, borders and lifecycles: %s", (name) => {
    const topology = fixture(name);

    expect(new Set(topology.nodes.map((node) => node.style?.shape)).size).toBe(8);
    expect(new Set(topology.nodes.filter((node) => !node.parentId).map((node) => node.style?.size))).toEqual(new Set(["s", "m", "l"]));
    expect(new Set(topology.nodes.map((node) => node.style?.border?.style))).toEqual(new Set(["solid", "dashed", "dotted", "double"]));
    expect(new Set(topology.nodes.map((node) => node.style?.border?.width))).toEqual(new Set([0, 1, 2, 3, 4]));
    expect(new Set(topology.nodes.map((node) => node.lifecycle))).toEqual(new Set(["active", "planned", "deprecated", "retired"]));
    for (const node of topology.nodes) {
      if (node.parentId) expect(["s", "m"]).toContain(node.style?.size);
    }
  });

  it.each(["topology-200", "topology-500"] as const)("has layered boundary chains and multi-membership: %s", (name) => {
    const topology = fixture(name);
    const roots = topology.boundaries.filter((boundary) => boundary.parentId === undefined);
    const middle = topology.boundaries.filter((boundary) =>
      boundary.parentId !== undefined && roots.some((root) => root.id === boundary.parentId));
    const leaves = topology.boundaries.filter((boundary) =>
      boundary.parentId !== undefined && middle.some((parent) => parent.id === boundary.parentId));

    expect(roots).toHaveLength(4);
    expect(middle).toHaveLength(4);
    expect(leaves).toHaveLength(4);
    expect(topology.nodes.filter((node) => node.boundaryIds.length === 8).length).toBeGreaterThanOrEqual(5);
    expect(new Set(topology.nodes.flatMap((node) => node.boundaryIds)).size).toBeGreaterThanOrEqual(12);

    for (const boundary of topology.boundaries) {
      if (!boundary.parentId) continue;
      expect(topology.boundaries.some((candidate) => candidate.id === boundary.parentId)).toBe(true);
    }
  });

  it.each(["topology-200", "topology-500"] as const)("keeps satellites inside their host layer and chain: %s", (name) => {
    const topology = fixture(name);
    const nodeById = new Map(topology.nodes.map((node) => [node.id, node]));

    for (const node of topology.nodes) {
      if (!node.parentId) continue;
      const parent = nodeById.get(node.parentId);
      expect(parent).toBeDefined();
      expect(node.layerId).toBe(parent?.layerId);
      expect(node.boundaryIds).toEqual([]);

      if (parent?.parentId) {
        const root = nodeById.get(parent.parentId);
        expect(root).toBeDefined();
        expect(root?.parentId).toBeUndefined();
      }
    }
  });

  it.each(["topology-200", "topology-500"] as const)("adds labelled bidirectional and protocol edges: %s", (name) => {
    const topology = fixture(name);

    expect(topology.edges.some((edge) => edge.direction === "bi")).toBe(true);
    expect(topology.edges.some((edge) => edge.protocol !== undefined && edge.port !== undefined)).toBe(true);
    expect(topology.edges.every((edge) => edge.label.startsWith("TEST fixture edge "))).toBe(true);
    expect(topology.edges.every((edge) => edge.source !== edge.target)).toBe(true);
  });

  it.each(["topology-200", "topology-500"] as const)("contains only synthetic values: %s", (name) => {
    const topology = fixture(name);
    const document = JSON.stringify(topology);

    expect(document).not.toMatch(/(?:[0-9]{1,3}\.){3}[0-9]{1,3}/);
    expect(document).not.toMatch(/(?:[a-z0-9-]+\.)+(?:com|net|org|io)\b/i);
    expect(document).not.toContain("/Users/");
    expect(validateTopology(topology).issues).toEqual([]);
  });
});
