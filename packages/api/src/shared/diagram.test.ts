import { describe, expect, it } from "vitest";
import example from "../../../../examples/service-platform.json";
import { diagramSchema, diagramEtag, emptyDiagram, removeDiagramEdge, removeDiagramNode, type Diagram } from "./diagram";

const sample = () => diagramSchema.parse(example);

describe("diagram document", () => {
  it("normalizes a complete graph and round trips it without losing evidence or views", () => {
    const graph = sample();
    expect(diagramSchema.parse(JSON.parse(JSON.stringify(graph)))).toEqual(graph);
    expect(graph.edges.find((edge) => edge.id === "query")?.evidence).toBe("inferred");
    expect(graph.nodes.find((node) => node.id === "client")?.tags).toEqual([]);
    expect(diagramSchema.parse(emptyDiagram())).toEqual(emptyDiagram());
    expect(emptyDiagram("Test").title).toBe("Test");
    expect(diagramEtag("example", 2)).toBe('"example:2"');
  });

  const invalid: [string, (graph: Diagram) => unknown][] = [
    ["duplicate nodes", (g) => ({ ...g, nodes: [...g.nodes, g.nodes[0]] })],
    ["duplicate edges", (g) => ({ ...g, edges: [...g.edges, g.edges[0]] })],
    ["duplicate groups", (g) => ({ ...g, groups: [...g.groups, g.groups[0]] })],
    ["duplicate views", (g) => ({ ...g, views: [...g.views, g.views[0]] })],
    ["unknown group", (g) => ({ ...g, nodes: [{ ...g.nodes[0], groupId: "missing" }] })],
    ["node/group collision", (g) => ({ ...g, groups: [...g.groups, { id: "api", label: "Collision" }] })],
    ["dangling source", (g) => ({ ...g, edges: [{ ...g.edges[0], source: "missing" }] })],
    ["dangling target", (g) => ({ ...g, edges: [{ ...g.edges[0], target: "missing" }] })],
    ["unknown parent", (g) => ({ ...g, groups: [...g.groups, { id: "child", label: "Child", parentId: "missing" }] })],
    ["cyclic group hierarchy", (g) => ({ ...g, groups: g.groups.map((group) => group.id === "cloud" ? { ...group, parentId: "compute" } : group) })],
    ["self-parent", (g) => ({ ...g, groups: [...g.groups, { id: "self", label: "Self", parentId: "self" }] })],
    ["unknown view member", (g) => ({ ...g, views: [{ id: "view", label: "View", nodeIds: ["missing"] }] })],
    ["duplicate view member", (g) => ({ ...g, views: [{ id: "view", label: "View", nodeIds: ["api", "api"] }] })],
    ["position outside view", (g) => ({ ...g, views: [{ id: "view", label: "View", nodeIds: ["api"], positions: { client: { x: 0, y: 0 } } }] })],
    ["unknown routed edge", (g) => ({ ...g, views: [{ ...g.views[0], routes: { missing: { waypoints: [] } } }] })],
    ["route outside view", (g) => ({ ...g, views: [{ ...g.views[0], routes: { cached: { waypoints: [] } } }] })],
    ["nonfinite waypoint", (g) => ({ ...g, edges: [{ ...g.edges[0], route: { waypoints: [{ x: 0, y: Infinity }] } }] })],
    ["invalid port", (g) => ({ ...g, edges: [{ ...g.edges[0], route: { sourceSide: "middle" } }] })],
    ["excessive waypoints", (g) => ({ ...g, edges: [{ ...g.edges[0], route: { waypoints: Array.from({ length: 31 }, () => ({ x: 0, y: 0 })) } }] })],
    ["executable URL", (g) => ({ ...g, nodes: [{ ...g.nodes[0], url: "javascript:alert(1)" }] })],
    ["nonfinite position", (g) => ({ ...g, nodes: [{ ...g.nodes[0], position: { x: Infinity, y: 0 } }] })],
    ["excessive position", (g) => ({ ...g, nodes: [{ ...g.nodes[0], position: { x: 100001, y: 0 } }] })],
    ["unknown top-level fields", (g) => ({ ...g, sql: "DROP TABLE diagrams" })],
    ["unknown node fields", (g) => ({ ...g, nodes: [{ ...g.nodes[0], html: "<script>bad</script>" }] })],
    ["too many nodes", (g) => ({ ...g, nodes: Array.from({ length: 501 }, (_, i) => ({ ...g.nodes[0], id: `n${i}` })) })],
    ["document too large to export and reimport", (g) => ({ ...g, edges: Array.from({ length: 300 }, (_, i) => ({ ...g.edges[0], id: `e${i}`, description: "x".repeat(4000) })) })],
  ];
  it.each(invalid)("rejects %s before persistence", (_, change) => {
    expect(diagramSchema.safeParse(change(sample())).success).toBe(false);
  });

  it("permits directed cycles without confusing them with invalid containment cycles", () => {
    const graph = sample();
    graph.edges.push({ ...graph.edges[0]!, id: "back", source: "db", target: "api" });
    expect(diagramSchema.safeParse(graph).success).toBe(true);
  });

  it("removes incident edges and view positions atomically with a component", () => {
    const graph = sample();
    graph.views[0]!.routes = { request: { sourceSide: "right", waypoints: [] }, query: { labelPosition: { x: 0, y: 0 } } };
    const next = removeDiagramNode(graph, "api");
    expect(next.nodes.some((node) => node.id === "api")).toBe(false);
    expect(next.edges.some((edge) => edge.source === "api" || edge.target === "api")).toBe(false);
    expect(next.views[0]?.positions.api).toBeUndefined();
    expect(next.views[0]?.routes).toEqual({});
    expect(next.views[0]?.positions.client).toEqual(graph.views[0]?.positions.client);
    expect(diagramSchema.safeParse(next).success).toBe(true);
    expect(graph.nodes).toHaveLength(6);
  });

  it("round trips explicit routing and removes only the deleted edge's view routes", () => {
    const graph = sample();
    graph.views[0]!.routes = { request: { sourceSide: "bottom", targetSide: "top", waypoints: [{ x: 300, y: 200 }], labelPosition: { x: 280, y: 180 } }, query: {} };
    expect(diagramSchema.parse(JSON.parse(JSON.stringify(graph)))).toEqual(graph);
    const next = removeDiagramEdge(graph, "request");
    expect(next.edges).toHaveLength(5);
    expect(next.views[0]?.routes).toEqual({ query: {} });
    expect(next.nodes).toEqual(graph.nodes);
    expect(diagramSchema.safeParse(next).success).toBe(true);
    expect(graph.views[0]?.routes.request).toBeDefined();
  });
});
