import { z } from "zod";

export const DIAGRAM_LIMITS = { nodes: 500, edges: 2000, groups: 100, views: 40, bytes: 1_048_576 } as const;
export const diagramIdSchema = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,95}$/);
export const pointSchema = z.strictObject({
  x: z.number().finite().min(-100_000).max(100_000),
  y: z.number().finite().min(-100_000).max(100_000),
});
export const NODE_KINDS = ["client", "gateway", "worker", "service", "database", "cache", "storage", "host", "container", "monitor", "external"] as const;
export const EDGE_KINDS = ["traffic", "binding", "deployment", "monitoring", "dependency"] as const;
export const edgeRouteSchema = z.strictObject({
  sourceSide: z.enum(["left", "right", "top", "bottom"]).optional(),
  targetSide: z.enum(["left", "right", "top", "bottom"]).optional(),
  waypoints: z.array(pointSchema).max(30).optional(),
  labelPosition: pointSchema.optional(),
});
export const nodeSchema = z.strictObject({
  id: diagramIdSchema,
  label: z.string().trim().min(1).max(200),
  kind: z.enum(NODE_KINDS),
  description: z.string().max(4000).default(""),
  url: z.url({ protocol: /^https?$/ }).max(2048).optional(),
  groupId: diagramIdSchema.optional(),
  tags: z.array(z.string().min(1).max(100)).max(20).default([]),
  position: pointSchema,
});
export const edgeSchema = z.strictObject({
  id: diagramIdSchema,
  source: diagramIdSchema,
  target: diagramIdSchema,
  label: z.string().max(160).default(""),
  kind: z.enum(EDGE_KINDS).default("dependency"),
  evidence: z.enum(["documented", "inferred"]).default("documented"),
  description: z.string().max(4000).default(""),
  route: edgeRouteSchema.optional(),
});
export const groupSchema = z.strictObject({
  id: diagramIdSchema,
  label: z.string().trim().min(1).max(160),
  parentId: diagramIdSchema.optional(),
  description: z.string().max(2000).default(""),
});
export const viewSchema = z.strictObject({
  id: diagramIdSchema,
  label: z.string().trim().min(1).max(120),
  description: z.string().max(2000).default(""),
  nodeIds: z.array(diagramIdSchema).max(DIAGRAM_LIMITS.nodes),
  edgeKinds: z.array(z.enum(EDGE_KINDS)).max(EDGE_KINDS.length).optional(),
  positions: z.record(diagramIdSchema, pointSchema).default({}),
  routes: z.record(diagramIdSchema, edgeRouteSchema).default({}),
  showBoundaries: z.boolean().default(true),
});

export const diagramSchema = z.strictObject({
  schemaVersion: z.literal(1),
  title: z.string().trim().min(1).max(200),
  description: z.string().max(12_000).default(""),
  nodes: z.array(nodeSchema).max(DIAGRAM_LIMITS.nodes),
  edges: z.array(edgeSchema).max(DIAGRAM_LIMITS.edges),
  groups: z.array(groupSchema).max(DIAGRAM_LIMITS.groups).default([]),
  views: z.array(viewSchema).max(DIAGRAM_LIMITS.views).default([]),
}).superRefine((diagram, ctx) => {
  const fail = (path: (string | number)[], message: string) => ctx.addIssue({ code: "custom", path, message });
  if (new TextEncoder().encode(JSON.stringify(diagram)).byteLength > DIAGRAM_LIMITS.bytes) {
    fail([], "The normalized diagram exceeds 1 MiB.");
  }
  for (const collection of ["nodes", "edges", "groups", "views"] as const) {
    const seen = new Set<string>();
    diagram[collection].forEach((item, i) => {
      if (seen.has(item.id)) fail([collection, i, "id"], `Duplicate ID: ${item.id}`);
      seen.add(item.id);
    });
  }
  const nodes = new Set(diagram.nodes.map((node) => node.id));
  const edges = new Map(diagram.edges.map((edge) => [edge.id, edge]));
  const groups = new Map(diagram.groups.map((group) => [group.id, group]));
  diagram.nodes.forEach((node, i) => {
    if (groups.has(node.id)) fail(["nodes", i, "id"], "Node and group IDs must be distinct.");
    if (node.groupId && !groups.has(node.groupId)) fail(["nodes", i, "groupId"], "Unknown group.");
  });
  diagram.edges.forEach((edge, i) => {
    if (!nodes.has(edge.source)) fail(["edges", i, "source"], "Unknown source node.");
    if (!nodes.has(edge.target)) fail(["edges", i, "target"], "Unknown target node.");
  });
  diagram.groups.forEach((group, i) => {
    const visited = new Set([group.id]);
    let parent = group.parentId;
    while (parent) {
      if (!groups.has(parent)) { fail(["groups", i, "parentId"], "Unknown parent group."); break; }
      if (visited.has(parent)) { fail(["groups", i, "parentId"], "Group hierarchy contains a cycle."); break; }
      visited.add(parent);
      parent = groups.get(parent)?.parentId;
    }
  });
  diagram.views.forEach((view, i) => {
    if (new Set(view.nodeIds).size !== view.nodeIds.length) fail(["views", i, "nodeIds"], "Duplicate view node.");
    for (const id of view.nodeIds) {
      if (!nodes.has(id)) fail(["views", i, "nodeIds"], `Unknown view node: ${id}`);
    }
    for (const id of Object.keys(view.positions)) {
      if (!view.nodeIds.includes(id)) fail(["views", i, "positions", id], "Position must belong to a node in this view.");
    }
    for (const id of Object.keys(view.routes)) {
      const edge = edges.get(id);
      if (!edge || !view.nodeIds.includes(edge.source) || !view.nodeIds.includes(edge.target)) {
        fail(["views", i, "routes", id], "Route must belong to an edge in this view.");
      }
    }
  });
});

export type Diagram = z.infer<typeof diagramSchema>;
export type DiagramNode = z.infer<typeof nodeSchema>;
export type DiagramEdge = z.infer<typeof edgeSchema>;
export type DiagramGroup = z.infer<typeof groupSchema>;
export type DiagramView = z.infer<typeof viewSchema>;
export type DiagramPoint = z.infer<typeof pointSchema>;
export type DiagramEdgeRoute = z.infer<typeof edgeRouteSchema>;
export interface DiagramSummary {
  id: string;
  title: string;
  description: string;
  revision: number;
  nodeCount: number;
  edgeCount: number;
  createdAt: string;
  updatedAt: string;
}
export interface DiagramRecord extends DiagramSummary { document: Diagram }
export interface DiagramList { data: DiagramSummary[]; nextCursor: string | null }
export const diagramEtag = (id: string, revision: number) => `"${id}:${revision}"`;

export function emptyDiagram(title = "Untitled architecture"): Diagram {
  return { schemaVersion: 1, title, description: "", nodes: [], edges: [], groups: [], views: [] };
}

export function removeDiagramNode(diagram: Diagram, id: string): Diagram {
  const edges = diagram.edges.filter((edge) => edge.source !== id && edge.target !== id);
  const edgeIds = new Set(edges.map((edge) => edge.id));
  return {
    ...diagram,
    nodes: diagram.nodes.filter((node) => node.id !== id),
    edges,
    views: diagram.views.map((view) => ({
      ...view,
      nodeIds: view.nodeIds.filter((nodeId) => nodeId !== id),
      positions: Object.fromEntries(Object.entries(view.positions).filter(([nodeId]) => nodeId !== id)),
      routes: Object.fromEntries(Object.entries(view.routes).filter(([edgeId]) => edgeIds.has(edgeId))),
    })),
  };
}

export function removeDiagramEdge(diagram: Diagram, id: string): Diagram {
  return {
    ...diagram,
    edges: diagram.edges.filter((edge) => edge.id !== id),
    views: diagram.views.map((view) => ({
      ...view,
      routes: Object.fromEntries(Object.entries(view.routes).filter(([edgeId]) => edgeId !== id)),
    })),
  };
}
