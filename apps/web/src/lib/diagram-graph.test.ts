import { describe, expect, it } from "vitest";
import example from "../../../../examples/service-platform.json";
import { diagramSchema, emptyDiagram, edgeSchema } from "@steed/api/shared";
import { graphBounds, groupAncestors, moveDiagramNode, projectDiagram, reachableNodes, type Reach } from "./diagram-graph";

const sample = () => diagramSchema.parse(example);

describe("architecture projection", () => {
  it("keeps every component and connection, with outer boundaries first", () => {
    const graph = projectDiagram(sample());
    expect(graph.visibleNodeIds).toHaveLength(6);
    expect(graph.edges).toHaveLength(6);
    expect(graph.nodes[0]?.id).toBe("b:cloud");
    expect(graph.nodes.some((node) => node.id === "b:unused")).toBe(false);
    expect(graph.edges.find((edge) => edge.id === "e:query")?.style?.strokeDasharray).toBe("6 5");
  });

  it("uses authored view positions without modifying the complete source", () => {
    const source = sample();
    const graph = projectDiagram(source, { viewId: "request-path" });
    expect(graph.visibleNodeIds).toEqual(["client", "api", "db"]);
    expect(graph.edges).toHaveLength(2);
    expect(graph.nodes.find((node) => node.id === "n:api")?.position).toEqual({ x: 360, y: 80 });
    expect(source.nodes[1]?.position).toEqual({ x: 360, y: 100 });
    expect(projectDiagram(source, { viewId: "storage" }).edges.every((edge) => edge.data?.relationships[0]?.kind === "binding")).toBe(true);
  });

  it("treats Object prototype names as ordinary authored IDs", () => {
    const source = diagramSchema.parse({ schemaVersion: 1, title: "Authored IDs", nodes: [
      { id: "constructor", kind: "service", label: "Constructor", position: { x: 20, y: 30 } },
      { id: "toString", kind: "service", label: "Serializer", position: { x: 400, y: 30 } },
    ], edges: [{ id: "valueOf", source: "constructor", target: "toString", route: { sourceSide: "bottom" } }],
    views: [{ id: "overview", label: "Overview", nodeIds: ["constructor", "toString"] }] });
    const graph = projectDiagram(source, { viewId: "overview" });
    expect(graph.nodes[0]?.position).toEqual({ x: 20, y: 30 });
    expect(graph.nodes[1]?.position).toEqual({ x: 400, y: 30 });
    expect(graph.edges[0]?.sourceHandle).toBe("s-bottom");
    const moved = moveDiagramNode(source, "constructor", { x: 10, y: 10 }, "overview");
    moved.views[0]!.routes = { valueOf: { sourceSide: "top" } };
    const overridden = projectDiagram(moved, { viewId: "overview" });
    expect(overridden.nodes[0]?.position).toEqual({ x: 10, y: 10 });
    expect(overridden.edges[0]?.sourceHandle).toBe("s-top");
  });

  it("collapses a boundary and aggregates only matching authored edges", () => {
    const graph = projectDiagram(sample(), { collapsed: ["compute"] });
    expect(graph.nodes.find((node) => node.id === "g:compute")?.data.count).toBe(2);
    expect(graph.nodes.some((node) => node.id === "n:api" || node.id === "b:compute")).toBe(false);
    expect(graph.edges.find((edge) => edge.source === "n:client")?.label).toBe("2 traffic links");
    expect(graph.edges.find((edge) => edge.source === "g:compute" && edge.target === "n:db")?.data?.relationships.map((edge) => edge.id)).toEqual(["query", "job-query"]);
    const wholeCloud = projectDiagram(sample(), { collapsed: ["cloud", "compute"] });
    expect(wholeCloud.nodes.filter((node) => node.type === "component")).toHaveLength(3);
    expect(wholeCloud.nodes.some((node) => node.id === "g:compute")).toBe(false);
    expect(wholeCloud.edges.some((edge) => edge.source === edge.target)).toBe(false);
  });

  it.each<[Reach, string[]]>([
    ["neighbors", ["api", "client", "db", "cache"]],
    ["upstream", ["api", "client", "monitor"]],
    ["downstream", ["api", "db", "cache"]],
  ])("traces %s using the authored directed topology", (direction, ids) => {
    const source = sample();
    expect([...reachableNodes(source.edges, "api", direction)].sort()).toEqual(ids.sort());
    expect(projectDiagram(source, { focus: { id: "api", direction } }).visibleNodeIds.sort()).toEqual(ids.sort());
  });

  it("terminates on cycles, self loops, and disconnected nodes", () => {
    const source = sample();
    source.edges.push(edgeSchema.parse({ id: "back", source: "db", target: "api" }), edgeSchema.parse({ id: "self", source: "api", target: "api" }));
    expect([...reachableNodes(source.edges, "api", "downstream")].sort()).toEqual(["api", "cache", "db"]);
    expect([...reachableNodes(source.edges, "missing", "upstream")]).toEqual(["missing"]);
    expect(projectDiagram(source).edges.some((edge) => edge.source === edge.target)).toBe(true);
  });

  it.each([
    [{ x: -400, y: 100 }, "s-left", "t-right"],
    [{ x: 400, y: 100 }, "s-right", "t-left"],
    [{ x: 0, y: -400 }, "s-top", "t-bottom"],
    [{ x: 0, y: 400 }, "s-bottom", "t-top"],
  ])("chooses ports from relative geometry", (position, sourceHandle, targetHandle) => {
    const source = sample();
    source.nodes = [source.nodes[0]!, { ...source.nodes[1]!, position: position as { x: number; y: number } }];
    source.nodes[0]!.position = { x: 0, y: 0 };
    source.edges = [source.edges[0]!]; source.groups = []; source.views = [];
    delete source.nodes[1]!.groupId;
    const graph = projectDiagram(source);
    expect(graph.edges[0]?.sourceHandle).toBe(sourceHandle);
    expect(graph.edges[0]?.targetHandle).toBe(targetHandle);
  });

  it("persists a moved component in only the chosen coordinate space", () => {
    const source = sample();
    const point = { x: 30, y: 40 };
    expect(moveDiagramNode(source, "api", point, "").nodes[1]?.position).toEqual(point);
    const viewEdit = moveDiagramNode(source, "api", point, "request-path");
    expect(viewEdit.views[0]?.positions.api).toEqual(point);
    expect(viewEdit.views[1]).toEqual(source.views[1]);
    expect(viewEdit.nodes).toEqual(source.nodes);
  });

  it("handles empty diagrams and computes complete node bounds", () => {
    expect(projectDiagram(emptyDiagram())).toEqual({ nodes: [], edges: [], visibleNodeIds: [] });
    expect(graphBounds([])).toEqual({ x: 0, y: 0, width: 240, height: 96 });
    expect(graphBounds([{ position: { x: -20, y: 20 }, width: 80, height: 40 }, { position: { x: 0, y: 0 } }]))
      .toEqual({ x: -20, y: 0, width: 260, height: 96 });
    expect(groupAncestors({}, sample().groups)).toEqual([]);
    expect(groupAncestors({ groupId: "compute" }, sample().groups)).toEqual(["compute", "cloud"]);
  });

  it("keeps authored parallel edges and view routing, discarding routes only for collapsed endpoints", () => {
    const source = sample();
    source.edges[0]!.route = { sourceSide: "top", waypoints: [{ x: 20, y: -80 }] };
    source.edges.push({ ...source.edges[0]!, id: "parallel", label: "Second channel" });
    source.views[0]!.routes.request = { sourceSide: "bottom", targetSide: "top", waypoints: [{ x: 20, y: 300 }] };
    source.views[0]!.showBoundaries = false;
    const full = projectDiagram(source);
    expect(full.edges.filter((edge) => edge.source === "n:client" && edge.target === "n:api")).toHaveLength(2);
    expect(full.edges[0]?.data?.route).toEqual(source.edges[0]?.route);
    const view = projectDiagram(source, { viewId: "request-path" });
    expect(view.nodes.some((node) => node.type === "boundary")).toBe(false);
    expect(view.edges[0]).toMatchObject({ sourceHandle: "s-bottom", targetHandle: "t-top", data: { route: source.views[0]?.routes.request } });
    expect(projectDiagram(source, { viewId: "request-path", showBoundaries: true }).nodes.some((node) => node.type === "boundary")).toBe(true);
    const collapsed = projectDiagram(source, { collapsed: ["compute"] });
    expect(collapsed.edges[0]?.data?.relationships).toHaveLength(3);
    expect(collapsed.edges[0]?.data?.route).toBeUndefined();
  });
});
