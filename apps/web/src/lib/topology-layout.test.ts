import { describe, expect, it } from "vitest";
import { topologySchema, type Topology } from "@steed/api/shared";
import fixture from "../../e2e/acceptance-topology.json";
import {
  TOPOLOGY_FRAME_HEADER,
  TOPOLOGY_FRAME_PADDING,
  TOPOLOGY_HOST_HEIGHT,
  TOPOLOGY_HOST_WIDTH,
  TOPOLOGY_FRAME_MAX_DEPTH,
  TOPOLOGY_FRAME_VISUAL_DEPTH_LIMIT,
  TOPOLOGY_ITEM_GAP,
  TOPOLOGY_SATELLITE_HEIGHT,
  TOPOLOGY_SATELLITE_INDENT,
  TOPOLOGY_SATELLITE_WIDTH,
  TOPOLOGY_SECTION_GAP,
  TOPOLOGY_SECTION_HEADER,
  TOPOLOGY_SECTION_PADDING,
  TOPOLOGY_STACK_GAP,
  TOPOLOGY_SUB_SATELLITE_INDENT,
  TOPOLOGY_SUB_SATELLITE_WIDTH,
  layoutTopology,
  primaryBoundaryId,
  projectTopologyLayout,
} from "./topology-layout";
import { TOPOLOGY_HOST_SIZE_TABLE } from "./topology-style";

interface Box { x: number; y: number; width: number; height: number }

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
      { id: "alpha", label: "Alpha", kind: "trust", description: "" },
      { id: "beta", label: "Beta", kind: "trust", description: "" },
      { id: "site", label: "Site", kind: "site", description: "" },
      { id: "lan", label: "LAN", kind: "network", parentId: "site", description: "" },
    ],
    nodes: [
      { id: "host-beta", type: "host", label: "Beta host", layerId: "first", boundaryIds: ["beta"], lifecycle: "active", description: "", tags: [], attrs: {} },
      { id: "host-alpha", type: "host", label: "Alpha host", layerId: "first", boundaryIds: ["site", "alpha"], lifecycle: "active", description: "", tags: [], attrs: {} },
      { id: "net-host", type: "host", label: "Net host", layerId: "first", boundaryIds: ["lan"], lifecycle: "active", description: "", tags: [], attrs: {} },
      { id: "host-unbounded", type: "host", label: "No boundary", layerId: "first", boundaryIds: [], lifecycle: "active", description: "", tags: [], attrs: {} },
      { id: "second-root", type: "host", label: "Second root", layerId: "second", boundaryIds: [], lifecycle: "active", description: "", tags: [], attrs: {} },
      { id: "service", type: "host", label: "Service", layerId: "first", parentId: "host-alpha", role: "service", lifecycle: "active", description: "", tags: [], attrs: {} },
      { id: "port-b", type: "host", label: "Port B", layerId: "first", parentId: "service", role: "subresource", lifecycle: "active", description: "", tags: [], attrs: {} },
      { id: "port-a", type: "host", label: "Port A", layerId: "first", parentId: "service", role: "subresource", lifecycle: "active", description: "", tags: [], attrs: {} },
    ],
    edges: [],
    views: [{
      id: "overview",
      label: "Overview",
      description: "",
      filter: { layerIds: [], typeIds: [], boundaryIds: [], tags: [] },
      pins: { "net-host": { x: 700, y: 180 } },
      focusLayerId: "first",
    }],
  };
}

function overlap(a: Box, b: Box) {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

function contains(outer: Box, inner: Box) {
  return inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.width <= outer.x + outer.width && inner.y + inner.height <= outer.y + outer.height;
}

describe("partitioned topology layout", () => {
  it.each([
    ["empty", "empty", {}],
    ["single", "single", {}],
    ["default-aspect", "normal", {}],
    ["zero-aspect", "normal", { aspect: 0 }],
    ["small-aspect", "normal", { aspect: 1 }],
    ["large-aspect", "normal", { aspect: 100 }],
    ["infinite-aspect", "normal", { aspect: Number.POSITIVE_INFINITY }],
    ["nan-aspect", "normal", { aspect: Number.NaN }],
    ["origin-zero", "normal", { origin: { x: 0, y: 0 } }],
    ["origin-negative", "normal", { origin: { x: -100, y: -100 } }],
    ["pin-host", "normal", { pins: { "host-alpha": { x: 700, y: 180 } } }],
    ["pin-missing", "normal", { pins: { missing: { x: 700, y: 180 } } }],
    ["no-boundaries", "no-boundaries", {}],
    ["cycle-parent", "cycle-parent", {}],
    ["self-parent", "self-parent", {}],
    ["deep-satellites", "deep-satellites", {}],
    ["many-satellites", "many-satellites", {}],
    ["no-views", "no-views", {}],
    ["wide-hosts", "wide-hosts", {}],
    ["many-boundaries", "many-boundaries", {}],
  ] as const)("covers layout branch matrix %s", (_name, mode, options) => {
    const topology = sample();
    if (mode === "empty") topology.nodes = [];
    if (mode === "single") topology.nodes = [topology.nodes[0]!];
    if (mode === "no-boundaries") topology.boundaries = [];
    if (mode === "cycle-parent") topology.nodes[0]!.parentId = "host-beta";
    if (mode === "self-parent") topology.nodes[0]!.parentId = "host-beta";
    if (mode === "deep-satellites") topology.nodes[6]!.parentId = "port-b";
    if (mode === "many-satellites") {
      topology.nodes = Array.from({ length: 40 }, (_, index) => ({ id: `sat-${index}`, type: "host", label: `Sat ${index}`, layerId: "first", parentId: index % 2 ? "host-alpha" : "host-beta", lifecycle: "active" as const, description: "", tags: [], attrs: {} }));
    }
    if (mode === "no-views") topology.views = [];
    if (mode === "wide-hosts") topology.nodes = topology.nodes.map((node) => ({ ...node, label: node.label.repeat(8) }));
    if (mode === "many-boundaries") topology.boundaries = Array.from({ length: 20 }, (_, index) => ({ id: `b-${index}`, label: `B ${index}`, kind: "trust", description: "" }));

    const result = layoutTopology(topology, options as never);
    expect(result.width).toBeGreaterThanOrEqual(0);
    expect(result.height).toBeGreaterThanOrEqual(0);
    for (const position of Object.values(result.positions)) {
      expect([position.x, position.y, position.width, position.height].every(Number.isFinite)).toBe(true);
    }
  });

  it("is valid for the fixture and treats a constructor ID like any other ID", () => {
    const topology = sample();
    topology.nodes = topology.nodes.map((node) => ({
      ...node,
      id: node.id === "host-alpha" ? "constructor" : node.id,
      ...(node.parentId === "host-alpha" ? { parentId: "constructor" } : {}),
    }));
    topology.views = [];
    expect(topologySchema.safeParse(topology).success).toBe(true);
    const result = layoutTopology(topology, { pins: { constructor: { x: 1, y: 1 } } });
    expect(Object.keys(result.positions).sort()).toEqual(topology.nodes.map((node) => node.id).sort());
    for (const position of Object.values(result.positions)) expect(Object.values(position).every(Number.isFinite)).toBe(true);
    expect(result.blocks[0]?.hostId).toBe("constructor");
  });

  it("orders sections by layer order and stacks satellites under their host", () => {
    const result = layoutTopology(sample(), { aspect: 100 });
    expect(result.lanes.map((lane) => lane.layerId)).toEqual(["first", "second"]);
    expect(result.nodePositions).toBe(result.positions);
    const host = result.positions["host-alpha"];
    const service = result.positions.service;
    const portA = result.positions["port-a"];
    const portB = result.positions["port-b"];
    expect(service).toEqual({ x: host.x + TOPOLOGY_SATELLITE_INDENT, y: host.y + TOPOLOGY_HOST_HEIGHT + TOPOLOGY_STACK_GAP, width: TOPOLOGY_SATELLITE_WIDTH, height: TOPOLOGY_SATELLITE_HEIGHT });
    expect(portA).toEqual({ x: host.x + TOPOLOGY_SUB_SATELLITE_INDENT, y: service.y + TOPOLOGY_SATELLITE_HEIGHT + TOPOLOGY_STACK_GAP, width: TOPOLOGY_SUB_SATELLITE_WIDTH, height: TOPOLOGY_SATELLITE_HEIGHT });
    expect(portB.y).toBe(portA.y + TOPOLOGY_SATELLITE_HEIGHT + TOPOLOGY_STACK_GAP);
    const block = result.blocks.find((item) => item.hostId === "host-alpha");
    expect(block).toMatchObject({ kind: "host", x: host.x, y: host.y, width: TOPOLOGY_HOST_WIDTH, nodeIds: ["host-alpha", "service", "port-a", "port-b"] });
    expect(block?.height).toBe(TOPOLOGY_HOST_HEIGHT + 3 * TOPOLOGY_SATELLITE_HEIGHT + 3 * TOPOLOGY_STACK_GAP);
    const first = result.lanes[0];
    expect(first.nodeIds.sort()).toEqual(["host-alpha", "host-beta", "host-unbounded", "net-host", "port-a", "port-b", "service"]);
    expect(first.blockIds).toHaveLength(4);
    const second = result.lanes[1];
    expect(second.x).toBe(first.x + first.width + TOPOLOGY_SECTION_GAP);
    expect(result.positions["second-root"]).toMatchObject({ x: second.x + TOPOLOGY_SECTION_PADDING, y: second.y + TOPOLOGY_SECTION_HEADER + TOPOLOGY_SECTION_PADDING });
  });

  it("uses resolved host sizes and root-host satellite widths without overlap", () => {
    const topology = sample();
    topology.nodes = topology.nodes.map((node) => {
      if (node.id === "host-alpha") return { ...node, style: { size: "s" as const } };
      if (node.id === "host-beta") return { ...node, style: { size: "l" as const } };
      return node;
    });
    topology.nodes.push(
      { id: "beta-service", type: "host", label: "Beta service", layerId: "second", parentId: "host-beta", role: "service", lifecycle: "active", description: "", tags: [], attrs: {}, style: { size: "l" } },
      { id: "beta-port", type: "host", label: "Beta port", layerId: "second", parentId: "beta-service", role: "subresource", lifecycle: "active", description: "", tags: [], attrs: {}, style: { size: "s" } },
    );

    const result = layoutTopology(topology, { aspect: 100 });
    const small = result.positions["host-alpha"]!;
    const large = result.positions["host-beta"]!;
    const smallSatellite = result.positions.service!;
    const smallSub = result.positions["port-a"]!;
    const largeSatellite = result.positions["beta-service"]!;
    const largeSub = result.positions["beta-port"]!;

    expect(small).toMatchObject({ width: TOPOLOGY_HOST_SIZE_TABLE.s.width, height: TOPOLOGY_HOST_SIZE_TABLE.s.height });
    expect(large).toMatchObject({ width: TOPOLOGY_HOST_SIZE_TABLE.l.width, height: TOPOLOGY_HOST_SIZE_TABLE.l.height });
    expect(smallSatellite).toMatchObject({ x: small.x + TOPOLOGY_SATELLITE_INDENT, width: TOPOLOGY_HOST_SIZE_TABLE.s.width - TOPOLOGY_SATELLITE_INDENT, height: TOPOLOGY_SATELLITE_HEIGHT });
    expect(smallSub).toMatchObject({ x: small.x + TOPOLOGY_SUB_SATELLITE_INDENT, width: TOPOLOGY_HOST_SIZE_TABLE.s.width - TOPOLOGY_SUB_SATELLITE_INDENT, height: TOPOLOGY_SATELLITE_HEIGHT });
    expect(largeSatellite).toMatchObject({ x: large.x + TOPOLOGY_SATELLITE_INDENT, width: TOPOLOGY_HOST_SIZE_TABLE.l.width - TOPOLOGY_SATELLITE_INDENT, height: TOPOLOGY_SATELLITE_HEIGHT });
    expect(largeSub).toMatchObject({ x: large.x + TOPOLOGY_SUB_SATELLITE_INDENT, width: TOPOLOGY_HOST_SIZE_TABLE.l.width - TOPOLOGY_SUB_SATELLITE_INDENT, height: TOPOLOGY_SATELLITE_HEIGHT });

    const smallBlock = result.blocks.find((block) => block.hostId === "host-alpha")!;
    const largeBlock = result.blocks.find((block) => block.hostId === "host-beta")!;
    expect(smallBlock).toMatchObject({ width: TOPOLOGY_HOST_SIZE_TABLE.s.width, nodeIds: ["host-alpha", "service", "port-a", "port-b"] });
    expect(largeBlock).toMatchObject({ width: TOPOLOGY_HOST_SIZE_TABLE.l.width, nodeIds: ["host-beta", "beta-service", "beta-port"] });
    for (const id of smallBlock.nodeIds) expect(contains({ x: smallBlock.x, y: smallBlock.y, width: smallBlock.width, height: smallBlock.height }, result.positions[id]!)).toBe(true);
    for (const id of largeBlock.nodeIds) expect(contains({ x: largeBlock.x, y: largeBlock.y, width: largeBlock.width, height: largeBlock.height }, result.positions[id]!)).toBe(true);

    const cards = Object.values(result.positions);
    for (let i = 0; i < cards.length; i++) for (let j = i + 1; j < cards.length; j++) expect(overlap(cards[i], cards[j])).toBe(false);
  });

  it("widened routing gaps preserve section, frame and pin constraints", () => {
    expect(TOPOLOGY_ITEM_GAP).toBe(64);
    expect(TOPOLOGY_FRAME_PADDING).toBe(32);

    const topology = sample();
    topology.boundaries = [];
    topology.nodes = topology.nodes.map((node) => ({ ...node, boundaryIds: [], style: node.id === "host-alpha" ? { size: "s" as const } : node.id === "host-beta" ? { size: "l" as const } : node.style }));
    const result = layoutTopology(topology, { pins: { "host-beta": { x: 100, y: 10 }, "host-alpha": { x: 200, y: 20 } }, aspect: 100 });

    expect(result.lanes.map((lane) => lane.order)).toEqual([10, 20]);
    expect(result.lanes[0]!.nodeIds).not.toContain("second-root");
    expect(result.lanes[1]!.nodeIds).not.toContain("host-alpha");
    const firstLaneBlocks = result.blocks.filter((block) => result.lanes[0]!.blockIds.includes(block.id)).map((block) => block.hostId);
    expect(firstLaneBlocks.slice(0, 2)).toEqual(["host-beta", "host-alpha"]);
    for (const lane of result.lanes) for (const id of lane.nodeIds) expect(contains(lane, result.positions[id]!)).toBe(true);
  });

  it("frames every membership in a laminar ancestor tree and never overlaps", () => {
    const topology = sample();
    topology.boundaries = topology.boundaries.map((boundary) => boundary.id === "lan" ? { ...boundary, style: { color: "#0891b2", border: { style: "dotted" as const, width: 2, color: "#075985" }, icon: "network" } } : boundary);
    const result = layoutTopology(topology);

    const alphaFrames = result.frames.filter((frame) => frame.boundaryId === "alpha");
    const betaFrames = result.frames.filter((frame) => frame.boundaryId === "beta");
    const siteFrames = result.frames.filter((frame) => frame.boundaryId === "site");
    const lanFrames = result.frames.filter((frame) => frame.boundaryId === "lan");
    expect(alphaFrames).toHaveLength(1);
    expect(betaFrames).toHaveLength(1);
    expect(siteFrames).toHaveLength(2);
    expect(lanFrames).toHaveLength(1);
    expect(alphaFrames[0]?.nodeIds).toEqual(["host-alpha", "service", "port-a", "port-b"]);
    expect(lanFrames[0]?.nodeIds).toEqual(["net-host"]);
    expect(lanFrames[0]?.style.border).toEqual({ style: "dotted", width: 2, color: "#075985" });

    const lan = lanFrames[0]!;
    const parentSite = siteFrames.find((frame) => frame.nodeIds.includes("net-host"))!;
    expect(parentSite.depth).toBe(0);
    expect(lan.depth).toBe(1);
    expect(contains(parentSite, lan)).toBe(true);

    for (const frame of result.frames) {
      const lane = result.lanes.find((item) => item.layerId === frame.layerId) as Box;
      expect(contains(lane, frame)).toBe(true);
      expect(frame.visualDepth).toBeLessThan(TOPOLOGY_FRAME_VISUAL_DEPTH_LIMIT);
      for (const id of frame.nodeIds) {
        const position = result.positions[id];
        expect(contains({ x: frame.x + TOPOLOGY_FRAME_PADDING, y: frame.y + TOPOLOGY_FRAME_HEADER, width: frame.width - 2 * TOPOLOGY_FRAME_PADDING, height: frame.height - TOPOLOGY_FRAME_HEADER - TOPOLOGY_FRAME_PADDING }, position)).toBe(true);
      }
    }

    const frames = result.frames;
    for (const a of frames) for (const b of frames) {
      if (a === b) continue;
      expect(!overlap(a, b) || contains(a, b) || contains(b, a)).toBe(true);
    }

    for (const host of [topology.nodes[0]!, topology.nodes[1]!, topology.nodes[2]!]) {
      const chain = new Set(host.boundaryIds);
      const byId = new Map(topology.boundaries.map((boundary) => [boundary.id, boundary]));
      const stack = [...chain];
      while (stack.length) {
        const id = stack.pop()!;
        const parentId = byId.get(id)?.parentId;
        if (parentId && !chain.has(parentId)) {
          chain.add(parentId);
          stack.push(parentId);
        }
      }
      for (const boundaryId of chain) {
        expect(result.frames.some((frame) => frame.boundaryId === boundaryId && frame.nodeIds.includes(host.id))).toBe(true);
      }
    }

    const unbounded = result.positions["host-unbounded"];
    for (const frame of frames) expect(overlap(frame, unbounded)).toBe(false);
  });

  it("compacts top-level sibling frames and preserves nested frame containment", () => {
    const topology = sample();
    topology.layers = [{ id: "first", label: "First", provider: "Fixture", order: 10, description: "" }];
    topology.boundaries = Array.from({ length: 5 }, (_, index) => ({ id: `vendor-${index + 1}`, label: `Vendor ${index + 1}`, kind: "trust" as const, description: "" }));
    topology.nodes = [
      { id: "tall-host", type: "host", label: "Tall", layerId: "first", boundaryIds: ["vendor-1"], lifecycle: "active", description: "", tags: [], attrs: {} },
      ...Array.from({ length: 10 }, (_, index) => ({ id: `sat-${index}`, type: "host", label: `Sat ${index}`, layerId: "first", parentId: "tall-host", role: "service", lifecycle: "active", description: "", tags: [], attrs: {} })),
      ...Array.from({ length: 4 }, (_, index) => ({ id: `short-${index + 1}`, type: "host", label: `Short ${index + 1}`, layerId: "first", boundaryIds: [`vendor-${index + 2}`], lifecycle: "active", description: "", tags: [], attrs: {} })),
    ];
    topology.views = [];

    const result = layoutTopology(topology);
    const frames = topology.boundaries
      .map((boundary) => result.frames.find((frame) => frame.boundaryId === boundary.id))
      .filter((frame): frame is (typeof result.frames)[number] => frame !== undefined)
      .sort((a, b) => a.y - b.y || a.x - b.x);
    expect(frames).toHaveLength(5);
    expect(frames.at(-1)!.y).toBeLessThan(frames[0]!.y + frames[0]!.height);
    for (let i = 0; i < frames.length; i++) {
      for (let j = i + 1; j < frames.length; j++) {
        expect(!overlap(frames[i]!, frames[j]!)).toBe(true);
      }
    }

    const lanTopology = sample();
    lanTopology.layers = [{ id: "first", label: "First", provider: "Fixture", order: 10, description: "" }];
    lanTopology.boundaries = [
      { id: "site", label: "Site", kind: "site", description: "" },
      { id: "lan", label: "LAN", kind: "network", parentId: "site", description: "" },
    ];
    lanTopology.nodes = [
      { id: "nested-host", type: "host", label: "Nested host", layerId: "first", boundaryIds: ["lan"], lifecycle: "active", description: "", tags: [], attrs: {} },
      { id: "nested-satellite", type: "host", label: "Nested satellite", layerId: "first", parentId: "nested-host", role: "service", lifecycle: "active", description: "", tags: [], attrs: {} },
    ];
    lanTopology.views = [];
    const nested = layoutTopology(lanTopology);
    const site = nested.frames.find((frame) => frame.boundaryId === "site")!;
    const lan = nested.frames.find((frame) => frame.boundaryId === "lan")!;
    expect(lan.nodeIds).toEqual(["nested-host", "nested-satellite"]);
    expect(contains(site, lan)).toBe(true);
    expect(contains(lan, nested.positions["nested-host"]!)).toBe(true);
    expect(contains(lan, nested.positions["nested-satellite"]!)).toBe(true);
  });

  it("preserves pinned host order and y/x semantics while sorting only unpinned hosts", () => {
    const topology = sample();
    topology.boundaries = [];
    topology.nodes = [
      { id: "pinned-small", type: "host", label: "Pinned small", layerId: "first", boundaryIds: [], lifecycle: "active", description: "", tags: [], attrs: {} },
      { id: "tall-unpinned", type: "host", label: "Tall", layerId: "first", boundaryIds: [], lifecycle: "active", description: "", tags: [], attrs: {} },
      { id: "tall-satellite", type: "host", label: "Tall satellite", layerId: "first", parentId: "tall-unpinned", role: "service", lifecycle: "active", description: "", tags: [], attrs: {} },
      { id: "other-unpinned", type: "host", label: "Other", layerId: "first", boundaryIds: [], lifecycle: "active", description: "", tags: [], attrs: {} },
    ];
    topology.views = [];

    const result = layoutTopology(topology, { pins: {
      "pinned-small": { x: 900, y: 10 },
    } });
    const pinnedIndex = result.blocks.findIndex((block) => block.hostId === "pinned-small");
    const tallIndex = result.blocks.findIndex((block) => block.hostId === "tall-unpinned");
    const otherIndex = result.blocks.findIndex((block) => block.hostId === "other-unpinned");
    expect(pinnedIndex).toBe(0);
    expect(tallIndex).toBeGreaterThan(pinnedIndex);
    expect(otherIndex).toBeGreaterThan(pinnedIndex);
    expect(tallIndex).toBeLessThan(otherIndex);
  });

  it("compacts top-level siblings and preserves pin-first semantics", () => {
    const topology = sample();
    topology.layers = [{ id: "first", label: "First", provider: "Fixture", order: 10, description: "" }];
    topology.boundaries = [];
    topology.nodes = [
      { id: "pinned-small", type: "host", label: "Pinned small", layerId: "first", boundaryIds: [], lifecycle: "active", description: "", tags: [], attrs: {} },
      { id: "tall-unpinned", type: "host", label: "Tall", layerId: "first", boundaryIds: [], lifecycle: "active", description: "", tags: [], attrs: {} },
      { id: "tall-satellite", type: "host", label: "Tall satellite", layerId: "first", parentId: "tall-unpinned", role: "service", lifecycle: "active", description: "", tags: [], attrs: {} },
      { id: "short-unpinned", type: "host", label: "Short", layerId: "first", boundaryIds: [], lifecycle: "active", description: "", tags: [], attrs: {} },
    ];
    topology.views = [];

    const result = layoutTopology(topology, { pins: { "pinned-small": { x: 900, y: 10 } } });
    const pinned = result.blocks.findIndex((block) => block.hostId === "pinned-small");
    const tall = result.blocks.findIndex((block) => block.hostId === "tall-unpinned");
    const short = result.blocks.findIndex((block) => block.hostId === "short-unpinned");
    expect(pinned).toBe(0);
    expect(tall).toBeGreaterThan(pinned);
    expect(short).toBeGreaterThan(tall);

    for (let i = 0; i < result.blocks.length; i++) {
      for (let j = i + 1; j < result.blocks.length; j++) {
        expect(!overlap(result.blocks[i]!, result.blocks[j]!)).toBe(true);
      }
    }
  });

  it("compacts mixed-height nested frames and avoids the 760px lower child gap", () => {
    const topology = sample();
    topology.layers = [{ id: "first", label: "First", provider: "Fixture", order: 10, description: "" }];
    topology.boundaries = [
      { id: "outer", label: "Outer", kind: "trust", description: "" },
      ...Array.from({ length: 5 }, (_, index) => ({ id: `network-${index + 1}`, label: `Network ${index + 1}`, kind: "network" as const, parentId: "outer", description: "" })),
    ];
    topology.nodes = [
      { id: "tall-host", type: "host", label: "Tall", layerId: "first", boundaryIds: ["network-1"], lifecycle: "active", description: "", tags: [], attrs: {} },
      ...Array.from({ length: 10 }, (_, index) => ({ id: `sat-${index}`, type: "host", label: `Sat ${index}`, layerId: "first", parentId: "tall-host", role: "service", lifecycle: "active", description: "", tags: [], attrs: {} })),
      ...Array.from({ length: 4 }, (_, index) => ({ id: `short-host-${index + 1}`, type: "host", label: `Short ${index + 1}`, layerId: "first", boundaryIds: [`network-${index + 2}`], lifecycle: "active", description: "", tags: [], attrs: {} })),
    ];
    topology.views = [];

    const result = layoutTopology(topology);
    const outer = result.frames.find((frame) => frame.boundaryId === "outer")!;
    const children = result.frames
      .filter((frame) => frame.boundaryId.startsWith("network-") && frame.layerId === "first")
      .sort((a, b) => a.y - b.y || a.x - b.x);
    expect(children).toHaveLength(5);
    expect(children[0]!.height).toBeGreaterThan(children[1]!.height);
    expect(children.at(-1)!.y).toBeLessThanOrEqual(children[1]!.y + 276);

    for (const child of children) {
      expect(contains(outer, child)).toBe(true);
      for (const id of child.nodeIds) expect(contains(child, result.positions[id]!)).toBe(true);
    }
    for (let i = 0; i < children.length; i++) {
      for (let j = i + 1; j < children.length; j++) {
        expect(!overlap(children[i]!, children[j]!)).toBe(true);
      }
    }
  });

  it("compacts mixed-height hosts within one frame without moving pinned hosts", () => {
    const topology = sample();
    topology.layers = [{ id: "first", label: "First", provider: "Fixture", order: 10, description: "" }];
    topology.boundaries = [{ id: "frame", label: "Frame", kind: "trust", description: "" }];
    topology.nodes = [
      { id: "pinned-host", type: "host", label: "Pinned", layerId: "first", boundaryIds: ["frame"], lifecycle: "active", description: "", tags: [], attrs: {} },
      { id: "tall-host", type: "host", label: "Tall", layerId: "first", boundaryIds: ["frame"], lifecycle: "active", description: "", tags: [], attrs: {} },
      ...Array.from({ length: 10 }, (_, index) => ({ id: `sat-${index}`, type: "host", label: `Sat ${index}`, layerId: "first", parentId: "tall-host", role: "service", lifecycle: "active", description: "", tags: [], attrs: {} })),
      { id: "short-host", type: "host", label: "Short", layerId: "first", boundaryIds: ["frame"], lifecycle: "active", description: "", tags: [], attrs: {} },
    ];
    topology.views = [];

    const result = layoutTopology(topology, { pins: { "pinned-host": { x: 1, y: 1 } } });
    const frame = result.frames.find((item) => item.boundaryId === "frame")!;
    const pinned = result.positions["pinned-host"]!;
    const tall = result.positions["tall-host"]!;
    const short = result.positions["short-host"]!;
    expect(pinned.y).toBeLessThan(tall.y);
    expect(pinned.y).toBeLessThanOrEqual(short.y);
    expect(contains(frame, pinned)).toBe(true);
    expect(contains(frame, tall)).toBe(true);
    expect(contains(frame, short)).toBe(true);
    expect(!overlap(pinned, tall) && !overlap(pinned, short) && !overlap(tall, short)).toBe(true);
  });

  it("picks the primary boundary by kind priority, then ID, ignoring unknown IDs", () => {
    const topology = sample();
    const node = { ...topology.nodes[0], boundaryIds: ["missing", "site", "beta", "alpha"] };
    expect(primaryBoundaryId(topology, node)).toBe("alpha");
    expect(primaryBoundaryId(topology, { ...node, boundaryIds: ["site", "lan"] })).toBe("site");
    expect(primaryBoundaryId(topology, { ...node, boundaryIds: ["missing"] })).toBeUndefined();
  });

  it("stops at boundary parent cycles and preserves a complete deterministic layout", () => {
    const topology = sample();
    topology.boundaries = topology.boundaries.map((boundary) => boundary.id === "site" ? { ...boundary, parentId: "lan" } : boundary);
    const result = layoutTopology(topology);
    expect(result.frames.filter((frame) => frame.boundaryId === "lan" || frame.boundaryId === "site").length).toBeGreaterThan(0);
    expect(Object.keys(result.positions).sort()).toEqual(topology.nodes.map((node) => node.id).sort());
    expect(layoutTopology(topology)).toEqual(result);

    const shuffled = { ...topology, nodes: [...topology.nodes].reverse(), boundaries: [...topology.boundaries].reverse(), layers: [...topology.layers].reverse() };
    expect(layoutTopology(shuffled)).toEqual(result);
  });

  it("numbers stable fragments by lane order and frame position and shares resolved style", () => {
    const topology = sample();
    const lan = topology.boundaries.find((boundary) => boundary.id === "lan")!;
    lan.style = { color: "#0891b2", border: { style: "dotted", width: 2, color: "#075985" }, icon: "network" };
    topology.nodes.find((node) => node.id === "second-root")!.boundaryIds = ["lan"];

    const result = layoutTopology(topology);
    const lanFrames = ["first", "second"].flatMap((layerId) => result.frames.filter((frame) => frame.boundaryId === "lan" && frame.layerId === layerId).sort((a, b) => a.y - b.y || a.x - b.x));
    expect(lanFrames).toHaveLength(2);
    expect(lanFrames.map((frame) => frame.fragmentIndex)).toEqual([1, 2]);
    expect(lanFrames.map((frame) => frame.fragmentCount)).toEqual([2, 2]);
    expect(lanFrames.map((frame) => frame.title)).toEqual(["LAN (1/2)", "LAN (2/2)"]);
    expect(lanFrames.map((frame) => frame.id)).toEqual(["frame:first:lan", "frame:second:lan:2"]);
    expect(lanFrames[0]?.style).toEqual(lanFrames[1]?.style);
    expect(lanFrames[0]?.border).toEqual({ style: "dotted", width: 2, color: "#075985" });

    const rerun = layoutTopology({ ...topology, nodes: [...topology.nodes].reverse(), boundaries: [...topology.boundaries].reverse(), layers: [...topology.layers].reverse() });
    expect(rerun.frames.filter((frame) => frame.boundaryId === "lan").map((frame) => [frame.title, frame.layerId, frame.x, frame.y])).toEqual(
      lanFrames.map((frame) => [frame.title, frame.layerId, frame.x, frame.y]),
    );
  });

  it("includes ancestors and caps visual frame depth without losing card containment", () => {
    const topology = sample();
    topology.nodes.find((node) => node.id === "host-alpha")!.boundaryIds = ["lan"];
    const result = layoutTopology(topology);
    const lanFrame = result.frames.find((frame) => frame.boundaryId === "lan" && frame.nodeIds.includes("host-alpha"));
    expect(lanFrame).toBeDefined();
    expect(result.frames.some((frame) => frame.boundaryId === "site" && frame.nodeIds.includes("host-alpha") && contains(frame, lanFrame!))).toBe(true);

    const deep = sample();
    deep.boundaries = Array.from({ length: TOPOLOGY_FRAME_MAX_DEPTH }, (_, index) => ({
      id: `deep-${index + 1}`,
      label: `Deep ${index + 1}`,
      kind: "trust" as const,
      parentId: index === 0 ? undefined : `deep-${index}`,
      description: "",
    }));
    deep.nodes = [{ id: "deep-host", type: "host", label: "Deep host", layerId: "first", boundaryIds: ["deep-8"], lifecycle: "active", description: "", tags: [], attrs: {} }];
    deep.layers = [{ id: "first", label: "First", provider: "Fixture", order: 10, description: "" }];
    deep.views = [];

    expect(topologySchema.safeParse(deep).success).toBe(true);
    const deepResult = layoutTopology(deep);
    const deepFrames = deepResult.frames.filter((frame) => frame.boundaryId.startsWith("deep-")).sort((a, b) => a.depth - b.depth);
    expect(deepFrames).toHaveLength(TOPOLOGY_FRAME_MAX_DEPTH);
    expect(deepFrames.map((frame) => frame.depth)).toEqual(Array.from({ length: TOPOLOGY_FRAME_MAX_DEPTH }, (_, index) => index));
    expect(deepFrames.map((frame) => frame.visualDepth)).toEqual([0, 1, 2, 3, 4, 5, 5, 5]);
    expect(deepFrames.map((frame) => frame.depthCapped)).toEqual([false, false, false, false, false, false, true, true]);
    for (let i = 1; i < deepFrames.length; i++) expect(contains(deepFrames[i - 1]!, deepFrames[i]!)).toBe(true);
  });

  it("orders hosts by pins first (y then x then ID), from options or the selected view", () => {
    const topology = sample();
    const order = (pins?: Record<string, { x: number; y: number }>, viewId?: string) =>
      layoutTopology(topology, { pins, viewId, aspect: 100 }).blocks.map((block) => block.hostId);
    const unbounded = (ids: string[]) => ids.indexOf("host-unbounded");
    expect(order()).toEqual(["host-alpha", "host-beta", "net-host", "host-unbounded", "second-root"]);
    topology.boundaries = [];
    topology.nodes = topology.nodes.map((node) => ({ ...node, boundaryIds: [] }));
    expect(order()).toEqual(["host-alpha", "host-beta", "host-unbounded", "net-host", "second-root"]);
    expect(order({ "net-host": { x: 5, y: 5 }, "host-beta": { x: 9, y: 1 }, "host-unbounded": { x: 1, y: 1 } })).toEqual(["host-unbounded", "host-beta", "net-host", "host-alpha", "second-root"]);
    expect(order({ b: { x: 1, y: 1 }, "host-beta": { x: 1, y: 1 }, "host-alpha": { x: 1, y: 1 } })[0]).toBe("host-alpha");
    expect(order(undefined, "overview")[0]).toBe("net-host");
    expect(unbounded(layoutTopology(topology, { view: topology.views[0], aspect: 100 }).blocks.map((block) => block.hostId))).toBe(3);
    expect(order(undefined, "missing")[0]).toBe("host-alpha");
  });

  it("keeps every card and composite clear of each other on the acceptance fixture", () => {
    const topology = topologySchema.parse(fixture);
    const result = layoutTopology(topology, { origin: { x: 10, y: 20 } });
    expect(Object.keys(result.positions)).toHaveLength(topology.nodes.length);
    const cards = Object.values(result.positions);
    for (let i = 0; i < cards.length; i++) for (let j = i + 1; j < cards.length; j++) expect(overlap(cards[i], cards[j])).toBe(false);
    for (let i = 0; i < result.lanes.length; i++) for (let j = i + 1; j < result.lanes.length; j++) expect(overlap(result.lanes[i], result.lanes[j])).toBe(false);
    for (const lane of result.lanes) for (const id of lane.nodeIds) expect(contains(lane, result.positions[id])).toBe(true);
    expect(Math.min(...result.lanes.map((lane) => lane.x))).toBe(10);
    expect(Math.min(...result.lanes.map((lane) => lane.y))).toBe(20);
    expect(result.width / result.height).toBeGreaterThan(1);
    expect(result.width / result.height).toBeLessThan(3);
  });

  it("handles empty topologies and layers without hosts", () => {
    const topology = sample();
    topology.nodes = [];
    const result = layoutTopology(topology);
    expect(result.lanes.map((lane) => lane.width)).toEqual([TOPOLOGY_HOST_WIDTH + 2 * TOPOLOGY_SECTION_PADDING, TOPOLOGY_HOST_WIDTH + 2 * TOPOLOGY_SECTION_PADDING]);
    expect(result.blocks).toEqual([]);
    expect(layoutTopology({ ...topology, layers: [] })).toMatchObject({ lanes: [], width: 0, height: 0 });
    expect(projectTopologyLayout).toBe(layoutTopology);
  });
});
