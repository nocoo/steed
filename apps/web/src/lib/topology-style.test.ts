import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { emptyTopology, topologySchema, type Topology } from "@steed/api/shared";
import { resolveTopologyIconComponent, TOPOLOGY_ICON_TABLE } from "../components/map/topology-icons";
import {
  TOPOLOGY_HOST_SIZE_TABLE,
  TOPOLOGY_PALETTE_VARIABLES,
  TOPOLOGY_SATELLITE_HEIGHT,
  resolveStyles,
  resolveTopologyBoundaryStyles,
  resolveTopologyIconKey,
  resolveTopologyNodeStyle,
  resolveTopologyPaletteColor,
  resolveTopologySatelliteDepth,
  topologyColorTint,
} from "./topology-style";

function sample(): Topology {
  return {
    ...emptyTopology("Style fixture"),
    revision: 7,
    layers: [
      { id: "cloud", label: "Cloud", provider: "Fixture", order: 0, color: "#0ea5e9", description: "" },
      { id: "edge", label: "Edge", provider: "Fixture", order: 1, description: "" },
    ],
    types: [
      { id: "host", label: "Host", shape: "hexagon", icon: "server", color: "emerald", description: "", attrs: [] },
      { id: "database", label: "Database", shape: "cylinder", icon: "unknown-type-icon", color: "unknown-type-token", description: "", attrs: [] },
    ],
    boundaries: [
      { id: "home", label: "Home", kind: "trust", description: "", style: { color: "violet", border: { style: "double", width: 3, color: "#9333ea" }, icon: "shield" } },
      { id: "lan", label: "LAN", kind: "network", description: "" },
    ],
    nodes: [
      { id: "node-small", type: "host", label: "Small", layerId: "cloud", boundaryIds: ["home"], lifecycle: "active", description: "", tags: [], attrs: {}, style: { shape: "pill", size: "s", icon: "database", border: { style: "dashed", width: 2, color: "#16a34a" } } },
      { id: "node-large", type: "host", label: "Large", layerId: "edge", boundaryIds: ["lan"], lifecycle: "planned", description: "", tags: [], attrs: {}, style: { size: "l", color: "rose", icon: "unknown-node-icon", border: { width: 0 } } },
      { id: "node-satellite", type: "database", label: "Satellite", layerId: "edge", parentId: "node-large", role: "service", lifecycle: "retired", description: "", tags: [], attrs: {}, style: { size: "l", icon: "box" } },
      { id: "node-sub", type: "host", label: "Sub", layerId: "edge", parentId: "node-satellite", role: "subresource", lifecycle: "deprecated", description: "", tags: [], attrs: {}, style: { size: "s" } },
      { id: "node-unknown", type: "database", label: "Unknown", layerId: "edge", boundaryIds: [], lifecycle: "active", description: "", tags: [], attrs: {}, style: { color: "unknown-node-token" } },
    ],
    edges: [],
    views: [],
  };
}

describe("topology style resolver", () => {
  it("uses node, type, layer and theme precedence for shape and color", () => {
    const topology = sample();
    const small = resolveTopologyNodeStyle(topology, topology.nodes[0]!);
    const large = resolveTopologyNodeStyle(topology, topology.nodes[1]!);
    const unknown = resolveTopologyNodeStyle(topology, topology.nodes[4]!);

    expect(small.shape).toBe("pill");
    expect(small.color).toBe("var(--topology-palette-emerald)");
    expect(small.accent).toBe("var(--topology-palette-emerald)");
    expect(small.fill).toBe("color-mix(in oklab, var(--topology-palette-emerald) 8%, transparent)");
    expect(large.shape).toBe("hexagon");
    expect(large.color).toBe("var(--topology-palette-rose)");
    expect(unknown.color).toBe("var(--color-basalt-primary, #6366f1)");
  });

  it("resolves every host size and gives satellites fixed height", () => {
    const topology = sample();
    const styles = resolveStyles(topology);

    expect(styles["node-small"]?.width).toBe(TOPOLOGY_HOST_SIZE_TABLE.s.width);
    expect(styles["node-small"]?.height).toBe(TOPOLOGY_HOST_SIZE_TABLE.s.height);
    expect(styles["node-large"]?.width).toBe(TOPOLOGY_HOST_SIZE_TABLE.l.width);
    expect(styles["node-large"]?.height).toBe(TOPOLOGY_HOST_SIZE_TABLE.l.height);
    expect(styles["node-satellite"]?.size).toBe("m");
    expect(styles["node-sub"]?.size).toBe("s");
    expect(styles["node-satellite"]?.height).toBe(TOPOLOGY_SATELLITE_HEIGHT);
    expect(styles["node-satellite"]?.width).toBe(TOPOLOGY_HOST_SIZE_TABLE.l.width - 24);
    expect(styles["node-sub"]?.width).toBe(TOPOLOGY_HOST_SIZE_TABLE.l.width - 48);
  });

  it("uses fixed icon keys and falls back through type then circle-dot", () => {
    const topology = sample();

    expect(resolveTopologyIconKey(topology, topology.nodes[0]!)).toBe("database");
    expect(resolveTopologyIconKey(topology, topology.nodes[1]!)).toBe("server");
    expect(resolveTopologyIconKey(topology, topology.nodes[2]!)).toBe("box");
    expect(resolveTopologyIconKey(topology, topology.nodes[4]!)).toBe("circle-dot");
  });

  it("resolves border widths and styles with the theme fallback", () => {
    const topology = sample();
    const small = resolveTopologyNodeStyle(topology, topology.nodes[0]!);
    const large = resolveTopologyNodeStyle(topology, topology.nodes[1]!);

    expect(small.border).toEqual({ style: "dashed", width: 2, color: "#16a34a" });
    expect(large.border).toEqual({ style: "solid", width: 0, color: "var(--color-basalt-border)" });
  });

  it("maps every palette token to a variable defined in the built app CSS", () => {
    const css = readFileSync(resolve(import.meta.dirname, "../index.css"), "utf8");
    expect(css).toContain(":root {");
    expect(css.match(/--topology-palette-primary:/g)).toHaveLength(1);
    expect(css).not.toContain("[data-mode=\"dark\"] {\n  --topology-palette-primary:");
    for (const [token, cssValue] of Object.entries(TOPOLOGY_PALETTE_VARIABLES)) {
      expect(resolveTopologyPaletteColor(token)).toBe(cssValue);
      const variable = cssValue.match(/^var\((--[^,)]+)\)/)?.[1];
      expect(variable, token).toBeDefined();
      expect(css, token).toContain(`${variable}:`);
    }
    expect(resolveTopologyPaletteColor("not-a-palette")).toBeUndefined();
    expect(resolveTopologyPaletteColor("#abcdef")).toBe("#abcdef");
    expect(topologyColorTint("#0ea5e9", 0.08)).toBe("#0ea5e914");
    expect(topologyColorTint("var(--topology-palette-blue)", 0.08)).toBe("color-mix(in oklab, var(--topology-palette-blue) 8%, transparent)");
  });

  it("resolves boundary style defaults and explicit overrides", () => {
    const topology = sample();
    const styles = resolveTopologyBoundaryStyles(topology);

    expect(styles.home).toMatchObject({
      color: "var(--topology-palette-violet)",
      tint: "color-mix(in oklab, var(--topology-palette-violet) 8%, transparent)",
      border: { style: "double", width: 3, color: "#9333ea" },
      icon: "shield",
    });
    expect(styles.lan).toMatchObject({
      color: "var(--color-basalt-primary, #6366f1)",
      border: { style: "solid", width: 1, color: "var(--color-basalt-border)" },
      icon: "circle-dot",
    });
  });

  it("derives satellite depth from parentId and produces structured-cloneable styles", () => {
    const topology = sample();
    const subresourceAtDepthOne = { ...topology.nodes[1]!, id: "subresource-depth-one", boundaryIds: [], parentId: "node-large", role: "subresource" as const };
    const serviceAtDepthTwo = { ...topology.nodes[1]!, id: "service-depth-two", boundaryIds: [], parentId: "subresource-depth-one", role: "service" as const };
    topology.nodes.push(subresourceAtDepthOne, serviceAtDepthTwo);

    expect(topologySchema.parse(topology)).toBeDefined();
    expect(resolveTopologySatelliteDepth(topology, subresourceAtDepthOne)).toBe(1);
    expect(resolveTopologySatelliteDepth(topology, serviceAtDepthTwo)).toBe(2);
    expect(resolveTopologyNodeStyle(topology, subresourceAtDepthOne).width).toBe(TOPOLOGY_HOST_SIZE_TABLE.l.width - 24);
    expect(resolveTopologyNodeStyle(topology, serviceAtDepthTwo).width).toBe(TOPOLOGY_HOST_SIZE_TABLE.l.width - 48);

    const nodeStyles = resolveStyles(topology);
    const boundaryStyles = resolveTopologyBoundaryStyles(topology);
    const cloned = structuredClone({ nodeStyles, boundaryStyles });
    expect(cloned.nodeStyles["node-small"]).not.toHaveProperty("iconComponent");
    expect(cloned.boundaryStyles.home).not.toHaveProperty("iconComponent");
  });

  it("keeps Lucide components in a UI-only table outside the pure resolver", () => {
    const resolverSource = readFileSync(resolve(import.meta.dirname, "topology-style.ts"), "utf8");
    expect(resolverSource).not.toContain("lucide-react");
    expect(resolverSource).not.toContain("LucideIcon");
    expect(TOPOLOGY_ICON_TABLE.box).toBeDefined();
    expect(resolveTopologyIconComponent("box")).toBe(TOPOLOGY_ICON_TABLE.box);
    expect(resolveTopologyIconComponent("unknown-ui-icon")).toBe(TOPOLOGY_ICON_TABLE["circle-dot"]);
  });

  it("preserves lifecycle states", () => {
    const topology = sample();
    expect(resolveTopologyNodeStyle(topology, topology.nodes[1]!)).toMatchObject({ lifecycle: "planned" });
    expect(resolveTopologyNodeStyle(topology, topology.nodes[2]!)).toMatchObject({ lifecycle: "retired" });
    expect(resolveTopologyNodeStyle(topology, topology.nodes[3]!)).toMatchObject({ lifecycle: "deprecated" });
  });
});
