import { describe, expect, it } from "vitest";
import { topologySchema } from "@steed/api/shared";
import { topologyCollectionItem, topologyCollectionPage } from "./topology-collections";

const topology = topologySchema.parse({
  schemaVersion: 2,
  title: "Fixture",
  layers: [{ id: "cloud", label: "Cloud", provider: "Fixture", order: 0 }],
  types: [{ id: "host", label: "Host", shape: "rect", attrs: [] }],
  boundaries: [{ id: "home", label: "Home", kind: "site" }],
  nodes: [
    { id: "root", label: "Root", type: "host", layerId: "cloud", boundaryIds: ["home"], tags: ["fixture"] },
    { id: "service", label: "Service", type: "host", layerId: "cloud", parentId: "root", role: "service" },
    { id: "peer", label: "Peer", type: "host", layerId: "cloud" },
  ],
  edges: [{ id: "link", source: "service", target: "peer", kind: "uses", label: "", direction: "uni", evidence: "documented" }],
});

describe("topology collections", () => {
  it("pages in stable ID order without mutating the snapshot", () => {
    const before = JSON.stringify(topology);
    const first = topologyCollectionPage(topology, "nodes", { cursor: "", limit: 2 });
    expect(first.data.map((node) => node.id)).toEqual(["peer", "root"]);
    expect(first.nextCursor).toBe("root");
    const last = topologyCollectionPage(topology, "nodes", { cursor: first.nextCursor!, limit: 2 });
    expect(last.data.map((node) => node.id)).toEqual(["service"]);
    expect(last.nextCursor).toBeNull();
    expect(JSON.stringify(topology)).toBe(before);
  });

  it("intersects node filters and inherits host boundary membership", () => {
    expect(topologyCollectionPage(topology, "nodes", { cursor: "", limit: 10, layer: "cloud", type: "host", boundary: "home" }).data.map((node) => node.id))
      .toEqual(["root", "service"]);
    expect(topologyCollectionPage(topology, "nodes", { cursor: "", limit: 10, tag: "fixture" }).data.map((node) => node.id)).toEqual(["root"]);
    expect(topologyCollectionPage(topology, "nodes", { cursor: "", limit: 10, parent: "root" }).data.map((node) => node.id)).toEqual(["service"]);
    expect(topologyCollectionPage(topology, "nodes", { cursor: "", limit: 10, layer: "other" }).data).toEqual([]);
  });

  it("filters edges by either endpoint and kind", () => {
    for (const node of ["service", "peer"]) {
      expect(topologyCollectionPage(topology, "edges", { cursor: "", limit: 10, node, kind: "uses" }).data.map((edge) => edge.id)).toEqual(["link"]);
    }
    expect(topologyCollectionPage(topology, "edges", { cursor: "", limit: 10, node: "root" }).data).toEqual([]);
    expect(topologyCollectionPage(topology, "edges", { cursor: "", limit: 10, kind: "dns" }).data).toEqual([]);
  });

  it("lists other collections and returns entities or null", () => {
    expect(topologyCollectionPage(topology, "layers", { cursor: "", limit: 10 }).data.map((layer) => layer.id)).toEqual(["cloud"]);
    expect(topologyCollectionPage(topology, "types", { cursor: "", limit: 10 }).data.map((type) => type.id)).toEqual(["host"]);
    expect(topologyCollectionPage(topology, "boundaries", { cursor: "", limit: 10 }).data.map((boundary) => boundary.id)).toEqual(["home"]);
    expect(topologyCollectionPage(topology, "views", { cursor: "", limit: 10 }).data).toEqual([]);
    expect(topologyCollectionItem(topology, "nodes", "root")?.label).toBe("Root");
    expect(topologyCollectionItem(topology, "nodes", "missing")).toBeNull();
  });
});
