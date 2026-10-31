import { describe, expect, it } from "vitest";
import { topologySchema, type Topology } from "@steed/api/shared";
import {
  TOPOLOGY_HOST_HEIGHT,
  TOPOLOGY_HOST_WIDTH,
  TOPOLOGY_LAYOUT_GAP_X,
  TOPOLOGY_LAYOUT_GAP_Y,
  TOPOLOGY_LANE_PADDING_X,
  TOPOLOGY_LANE_PADDING_Y,
  TOPOLOGY_SATELLITE_HEIGHT,
  TOPOLOGY_SUB_SATELLITE_INDENT,
  layoutTopology,
  projectTopologyLayout,
} from "./topology-layout";

function sample(): Topology {
  return {
    schemaVersion: 2,
    title: "Layout fixture",
    description: "",
    revision: 5,
    layers: [
      { id: "second", label: "Second", provider: "Fixture", order: 20, description: "" },
      { id: "first", label: "First", provider: "Fixture", order: 10, description: "" },
    ],
    types: [{ id: "host", label: "Host", shape: "rect", description: "", attrs: [] }],
    boundaries: [
      { id: "alpha", label: "Alpha", kind: "site", description: "" },
      { id: "beta", label: "Beta", kind: "site", description: "" },
    ],
    nodes: [
      { id: "host-beta", type: "host", label: "Beta host", layerId: "first", boundaryIds: ["beta"], lifecycle: "active", description: "", tags: [], attrs: {} },
      { id: "host-alpha", type: "host", label: "Alpha host", layerId: "first", boundaryIds: ["alpha"], lifecycle: "active", description: "", tags: [], attrs: {} },
      { id: "host-unbounded", type: "host", label: "No boundary", layerId: "first", boundaryIds: [], lifecycle: "active", description: "", tags: [], attrs: {} },
      { id: "second-root", type: "host", label: "Second root", layerId: "second", boundaryIds: [], lifecycle: "active", description: "", tags: [], attrs: {} },
      { id: "service", type: "host", label: "Service", layerId: "first", parentId: "host-alpha", role: "service", lifecycle: "active", description: "", tags: [], attrs: {} },
      { id: "port-a", type: "host", label: "Port A", layerId: "first", parentId: "service", role: "subresource", lifecycle: "active", description: "", tags: [], attrs: {} },
      { id: "port-b", type: "host", label: "Port B", layerId: "first", parentId: "service", role: "subresource", lifecycle: "active", description: "", tags: [], attrs: {} },
    ],
    edges: [],
    views: [{
      id: "overview",
      label: "Overview",
      description: "",
      filter: { layerIds: [], typeIds: [], boundaryIds: [], tags: [] },
      pins: { "host-alpha": { x: 700, y: 180 }, service: { x: 980, y: 210 } },
      focusLayerId: "first",
    }],
  };
}

function overlap(a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }) {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

describe("interim topology lane layout", () => {
  it.each(["host-alpha", "service", "port-a"])("treats a constructor ID as unpinned at %s", (originalId) => {
    const topology = sample();
    topology.nodes = topology.nodes.map((node) => ({
      ...node,
      id: node.id === originalId ? "constructor" : node.id,
      ...(node.parentId === originalId ? { parentId: "constructor" } : {}),
    }));
    topology.views = [];
    expect(topologySchema.safeParse(topology).success).toBe(true);

    const unpinned = layoutTopology(topology);
    for (const position of Object.values(unpinned.positions)) {
      expect(Object.values(position).every(Number.isFinite)).toBe(true);
    }
    for (const lane of unpinned.lanes) {
      expect([lane.x, lane.y, lane.width, lane.height].every(Number.isFinite)).toBe(true);
    }
    const pinned = layoutTopology(topology, { pins: { constructor: { x: 1200, y: 800 } } });
    expect(pinned.positions.constructor).toMatchObject({ x: 1200, y: 800 });
  });

  it("orders layers by order and root hosts by first boundary then ID", () => {
    const result = layoutTopology(sample());
    expect(result.lanes.map((lane) => lane.layerId)).toEqual(["first", "second"]);
    expect(result.lanes.map((lane) => lane.order)).toEqual([10, 20]);

    const firstLane = result.blocks.filter((block) => block.kind === "host" && block.id !== "second-root");
    expect(firstLane.map((block) => block.id)).toEqual(["host-alpha", "host-beta", "host-unbounded"]);
    expect(result.positions["host-alpha"]?.x).toBe(TOPOLOGY_LANE_PADDING_X);
    expect(result.positions["host-beta"]?.x).toBeGreaterThan(result.positions["host-alpha"]!.x);
    expect(result.positions["host-unbounded"]?.y).toBe(result.positions["host-beta"]?.y);
  });

  it("places two satellite levels beside and indented below their host", () => {
    const result = layoutTopology(sample(), { origin: { x: 100, y: 200 } });
    const host = result.positions["host-alpha"]!;
    const satellite = result.positions.service!;
    const subA = result.positions["port-a"]!;
    const subB = result.positions["port-b"]!;

    expect(host.width).toBe(TOPOLOGY_HOST_WIDTH);
    expect(satellite.x).toBe(host.x + TOPOLOGY_HOST_WIDTH + TOPOLOGY_LAYOUT_GAP_X);
    expect(satellite.y).toBe(host.y);
    expect(subA.x).toBe(satellite.x + TOPOLOGY_SUB_SATELLITE_INDENT);
    expect(subA.y).toBe(satellite.y + TOPOLOGY_SATELLITE_HEIGHT + TOPOLOGY_LAYOUT_GAP_Y);
    expect(subB.y).toBe(subA.y + TOPOLOGY_SATELLITE_HEIGHT + TOPOLOGY_LAYOUT_GAP_Y);

    const satelliteBlock = result.blocks.find((block) => block.id === "service")!;
    expect(satelliteBlock.nodeIds).toEqual(["service", "port-a", "port-b"]);
    expect(satelliteBlock.hostId).toBe("host-alpha");
    expect(satelliteBlock.height).toBeGreaterThan(TOPOLOGY_SATELLITE_HEIGHT);
  });

  it("computes composite block size before grid packing so satellites cannot overlap peers", () => {
    const topology = sample();
    const extra = {
      id: "peer",
      type: "host",
      label: "Peer with satellite",
      layerId: "first",
      boundaryIds: ["beta"],
      lifecycle: "active",
      description: "",
      tags: [],
      attrs: {},
    } as const;
    topology.nodes.push(extra, {
      id: "peer-service",
      type: "host",
      label: "Peer service",
      layerId: "first",
      parentId: "peer",
      role: "service",
      lifecycle: "active",
      description: "",
      tags: [],
      attrs: {},
    });
    const result = layoutTopology(topology);
    const hosts = result.blocks.filter((block) => block.kind === "host");
    for (let a = 0; a < hosts.length; a++) {
      for (let b = a + 1; b < hosts.length; b++) {
        expect(overlap(hosts[a]!, hosts[b]!)).toBe(false);
      }
    }
    expect(result.positions["peer-service"]!.x).toBe(result.positions.peer!.x + TOPOLOGY_HOST_WIDTH + TOPOLOGY_LAYOUT_GAP_X);
  });

  it("moves a host pin and its complete composite block together", () => {
    const result = layoutTopology(sample(), { pins: { "host-alpha": { x: 700, y: 180 } } });
    expect(result.positions["host-alpha"]).toMatchObject({ x: 700, y: 180, width: expect.any(Number), height: expect.any(Number) });
    const host = result.positions["host-alpha"]!;
    const satellite = result.positions.service!;
    expect(satellite.x).toBe(host.x + TOPOLOGY_HOST_WIDTH + TOPOLOGY_LAYOUT_GAP_X);
    expect(satellite.y).toBe(host.y);
  });

  it("pre-reserves a pinned host before packing unpinned peers", () => {
    const result = layoutTopology(sample(), { pins: { "host-beta": { x: 32, y: 32 } } });
    const pinned = result.blocks.find((block) => block.id === "host-beta")!;
    const unpinned = result.blocks.find((block) => block.id === "host-alpha")!;
    expect(pinned).toMatchObject({ x: 32, y: 32 });
    expect(overlap(pinned, unpinned)).toBe(false);
    expect(unpinned.x).not.toBe(32);
  });

  it("terminates when a fixed satellite and pinned host are far apart", () => {
    const result = layoutTopology(sample(), {
      pins: {
        service: { x: 1000, y: 350 },
        "host-beta": { x: 700, y: 400 },
      },
    });
    expect(result.positions.service).toMatchObject({ x: 1000, y: 350 });
    expect(result.positions["host-beta"]).toMatchObject({ x: 700, y: 400 });

    const pinnedHost = result.blocks.find((block) => block.id === "host-beta")!;
    const fixedSatellite = result.blocks.find((block) => block.id === "service")!;
    const pinnedHostBlock = { x: pinnedHost.x, y: pinnedHost.y, width: pinnedHost.width, height: pinnedHost.height };
    const satelliteBlock = { x: fixedSatellite.x, y: fixedSatellite.y, width: fixedSatellite.width, height: fixedSatellite.height };
    expect(overlap(pinnedHostBlock, satelliteBlock)).toBe(false);
  });

  it("allows pinned-vs-pinned overlap while keeping pins absolute", () => {
    const result = layoutTopology(sample(), { pins: {
      "host-beta": { x: 32, y: 32 },
      service: { x: 32, y: 32 },
    } });
    expect(result.positions["host-beta"]?.x).toBe(32);
    expect(result.positions["host-beta"]?.y).toBe(32);
    expect(result.positions.service?.x).toBe(32);
    expect(result.positions.service?.y).toBe(32);

    const pinnedHost = result.blocks.find((block) => block.id === "host-beta")!;
    const pinnedSatellite = result.blocks.find((block) => block.id === "service")!;
    expect(overlap(pinnedHost, pinnedSatellite)).toBe(true);
  });

  it("moves an unpinned host away from a satellite pinned at 32,32 and leaves default satellites clear", () => {
    const topology = sample();
    topology.nodes.push({
      id: "worker",
      type: "host",
      label: "Worker",
      layerId: "first",
      parentId: "host-alpha",
      role: "service",
      lifecycle: "active",
      description: "",
      tags: [],
      attrs: {},
    });
    const result = layoutTopology(topology, { pins: { service: { x: 32, y: 32 } } });
    const pinnedSatellite = result.positions.service!;
    const unpinnedHost = result.positions["host-alpha"]!;
    const defaultSatellite = result.positions.worker!;
    expect(pinnedSatellite).toMatchObject({ x: 32, y: 32 });
    expect(overlap(unpinnedHost, pinnedSatellite)).toBe(false);
    expect(overlap(defaultSatellite, pinnedSatellite)).toBe(false);

    const hosts = result.blocks.filter((block) => block.kind === "host");
    for (let a = 0; a < hosts.length; a++) {
      for (let b = a + 1; b < hosts.length; b++) {
        expect(overlap(hosts[a]!, hosts[b]!)).toBe(false);
      }
    }
  });

  it("pre-reserves moved satellite geometry before packing a peer host", () => {
    const result = layoutTopology(sample(), { pins: { service: { x: 296, y: 32 } } });
    const peer = result.blocks.find((block) => block.id === "host-beta")!;
    const satellite = result.blocks.find((block) => block.id === "service")!;
    expect(satellite.x).toBe(296);
    expect(satellite.y).toBe(32);
    expect(overlap(peer, satellite)).toBe(false);

    const hosts = result.blocks.filter((block) => block.kind === "host");
    for (let a = 0; a < hosts.length; a++) {
      for (let b = a + 1; b < hosts.length; b++) {
        expect(overlap(hosts[a]!, hosts[b]!)).toBe(false);
      }
    }
  });

  it("gives a host pin precedence over inconsistent descendant pins", () => {
    const result = layoutTopology(sample(), { pins: {
      "host-alpha": { x: 700, y: 180 },
      service: { x: 980, y: 210 },
      "port-a": { x: 1100, y: 400 },
    } });
    expect(result.positions.service).toMatchObject({ x: 964, y: 180 });
    expect(result.positions["port-a"]?.x).toBe(996);
    expect(result.positions["port-a"]?.y).toBe(180 + TOPOLOGY_SATELLITE_HEIGHT + TOPOLOGY_LAYOUT_GAP_Y);
  });

  it("gives a direct satellite pin precedence over child pins", () => {
    const direct = layoutTopology(sample(), { pins: {
      service: { x: 1000, y: 350 },
      "port-a": { x: 1100, y: 400 },
      "port-b": { x: 1080, y: 500 },
    } });
    expect(direct.positions.service).toMatchObject({ x: 1000, y: 350 });
    expect(direct.positions["port-a"]?.x).toBe(1032);
    expect(direct.positions["port-a"]?.y).toBe(350 + TOPOLOGY_SATELLITE_HEIGHT + TOPOLOGY_LAYOUT_GAP_Y);
  });

  it("moves a satellite pin with all of its sub-satellites and accepts direct pins", () => {
    const direct = layoutTopology(sample(), { pins: { service: { x: 1000, y: 350 } } });
    expect(direct.positions.service).toMatchObject({ x: 1000, y: 350 });
    expect(direct.positions["port-a"]?.x).toBe(1000 + TOPOLOGY_SUB_SATELLITE_INDENT);
    expect(direct.positions["port-a"]?.y).toBe(350 + TOPOLOGY_SATELLITE_HEIGHT + TOPOLOGY_LAYOUT_GAP_Y);
    expect(direct.positions["port-b"]?.y).toBeGreaterThan(direct.positions["port-a"]!.y);
  });

  it("supports pins on sub-satellites by translating their containing satellite block", () => {
    const result = layoutTopology(sample(), { pins: { "port-a": { x: 1100, y: 400 } } });
    const satelliteY = 400 - TOPOLOGY_SATELLITE_HEIGHT - TOPOLOGY_LAYOUT_GAP_Y;
    expect(result.positions.service).toMatchObject({ x: 1068, y: satelliteY });
    expect(result.positions["port-a"]?.x).toBe(1100);
    expect(result.positions["port-a"]?.y).toBe(400);
    expect(result.positions["port-b"]?.x).toBe(1100);
    expect(result.positions["port-b"]?.y).toBe(satelliteY + TOPOLOGY_SATELLITE_HEIGHT + TOPOLOGY_LAYOUT_GAP_Y + TOPOLOGY_SATELLITE_HEIGHT + TOPOLOGY_LAYOUT_GAP_Y);
  });

  it("puts the lowest-ID sub-satellite pin exactly at its coordinates when multiple children are pinned", () => {
    const result = layoutTopology(sample(), { pins: {
      "port-a": { x: 1100, y: 400 },
      "port-b": { x: 1080, y: 500 },
    } });
    const satelliteY = 400 - TOPOLOGY_SATELLITE_HEIGHT - TOPOLOGY_LAYOUT_GAP_Y;
    expect(result.positions["port-a"]?.x).toBe(1100);
    expect(result.positions["port-a"]?.y).toBe(400);
    expect(result.positions.service).toMatchObject({ x: 1068, y: satelliteY });
    expect(result.positions["port-b"]?.x).toBe(1100);
    expect(result.positions["port-b"]?.y).toBe(satelliteY + TOPOLOGY_SATELLITE_HEIGHT + TOPOLOGY_LAYOUT_GAP_Y + TOPOLOGY_SATELLITE_HEIGHT + TOPOLOGY_LAYOUT_GAP_Y);
  });

  it("translates the block from the requested second child offset", () => {
    const result = layoutTopology(sample(), { pins: { "port-b": { x: 1200, y: 500 } } });
    const satelliteY = 500 - TOPOLOGY_SATELLITE_HEIGHT - TOPOLOGY_LAYOUT_GAP_Y - TOPOLOGY_SATELLITE_HEIGHT - TOPOLOGY_LAYOUT_GAP_Y;
    expect(result.positions.service).toMatchObject({ x: 1168, y: satelliteY });
    expect(result.positions["port-a"]?.x).toBe(1200);
    expect(result.positions["port-a"]?.y).toBe(satelliteY + TOPOLOGY_SATELLITE_HEIGHT + TOPOLOGY_LAYOUT_GAP_Y);
    expect(result.positions["port-b"]?.x).toBe(1200);
    expect(result.positions["port-b"]?.y).toBe(500);
  });

  it("is deterministic, handles empty topology, and exposes the compatibility projection alias", () => {
    const topology = sample();
    const first = layoutTopology(topology);
    const second = layoutTopology(topology);
    expect(second).toEqual(first);
    expect(projectTopologyLayout(topology)).toEqual(first);

    const empty = layoutTopology({ ...topology, layers: [], nodes: [], edges: [], views: [] });
    expect(empty.positions).toEqual({});
    expect(empty.blocks).toEqual([]);
    expect(empty.lanes).toEqual([]);
    expect(empty.width).toBe(0);
    expect(empty.height).toBe(0);

    expect(layoutTopology({ ...topology, nodes: [], layers: [{ id: "empty-lane", label: "Empty", provider: "Fixture", order: 0, description: "" }], views: [] }).lanes[0]).toMatchObject({ layerId: "empty-lane", blockIds: [] });
  });

  it("does not overlap unpinned host blocks in fixed-grid packing", () => {
    const topology = sample();
    topology.nodes = topology.nodes.filter((node) => node.parentId === undefined || node.id === "second-root");
    const result = layoutTopology(topology);
    const hosts = result.blocks.filter((block) => block.kind === "host");
    for (let a = 0; a < hosts.length; a++) {
      for (let b = a + 1; b < hosts.length; b++) {
        expect(overlap(hosts[a]!, hosts[b]!)).toBe(false);
      }
    }
    const laneHeight = result.lanes.find((lane) => lane.layerId === "first")!.height;
    expect(laneHeight).toBeGreaterThanOrEqual(TOPOLOGY_HOST_HEIGHT + TOPOLOGY_LANE_PADDING_Y * 2);
  });
});
