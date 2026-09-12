import { MarkerType, type Edge, type Node } from "reactflow";
import type { Diagram, DiagramEdge, DiagramEdgeRoute, DiagramGroup, DiagramNode, DiagramPoint } from "@steed/api/shared";

export const COMPONENT_WIDTH = 240;
export const COMPONENT_HEIGHT = 96;
export const EDGE_COLORS = { traffic: "#0891b2", binding: "#8b5cf6", deployment: "#64748b", monitoring: "#d97706", dependency: "#059669" } as const;
export type Reach = "neighbors" | "upstream" | "downstream";
export interface DiagramFilter { viewId?: string; collapsed?: string[]; showBoundaries?: boolean; focus?: { id: string; direction: Reach } }
export interface DiagramCanvasNode {
  label: string;
  kind: DiagramNode["kind"] | "group";
  node?: DiagramNode;
  group?: DiagramGroup;
  count?: number;
}
export interface DiagramCanvasEdge { relationships: DiagramEdge[]; route?: DiagramEdgeRoute }

export function reachableNodes(edges: DiagramEdge[], id: string, direction: Reach): Set<string> {
  const found = new Set([id]);
  const queue = [id];
  for (const current of queue) {
    for (const edge of edges) {
      const next = direction === "upstream" ? (edge.target === current ? edge.source : null)
        : direction === "downstream" ? (edge.source === current ? edge.target : null)
          : edge.source === current ? edge.target : edge.target === current ? edge.source : null;
      if (next && !found.has(next)) { found.add(next); if (direction !== "neighbors") queue.push(next); }
    }
  }
  return found;
}

export function groupAncestors(node: { groupId?: string }, groups: DiagramGroup[]): string[] {
  const byId = new Map(groups.map((group) => [group.id, group]));
  const ancestors: string[] = [];
  let id = node.groupId;
  while (id && !ancestors.includes(id)) { ancestors.push(id); id = byId.get(id)?.parentId; }
  return ancestors;
}

export function graphBounds(nodes: { position: DiagramPoint; width?: number | null; height?: number | null }[]) {
  if (!nodes.length) return { x: 0, y: 0, width: COMPONENT_WIDTH, height: COMPONENT_HEIGHT };
  const x = Math.min(...nodes.map((node) => node.position.x));
  const y = Math.min(...nodes.map((node) => node.position.y));
  return { x, y,
    width: Math.max(...nodes.map((node) => node.position.x + (node.width ?? COMPONENT_WIDTH))) - x,
    height: Math.max(...nodes.map((node) => node.position.y + (node.height ?? COMPONENT_HEIGHT))) - y,
  };
}

export function projectDiagram(document: Diagram, filter: DiagramFilter = {}) {
  const view = document.views.find((candidate) => candidate.id === filter.viewId);
  const positions = new Map(Object.entries(view?.positions ?? {}));
  const routes = new Map(Object.entries(view?.routes ?? {}));
  const viewIds = view ? new Set(view.nodeIds) : null;
  const edges = document.edges.filter((edge) => !view?.edgeKinds || view.edgeKinds.includes(edge.kind));
  const reach = filter.focus ? reachableNodes(edges, filter.focus.id, filter.focus.direction) : null;
  const visible = document.nodes.filter((node) => (!viewIds || viewIds.has(node.id)) && (!reach || reach.has(node.id)));
  const ancestors = new Map(visible.map((node) => [node.id, groupAncestors(node, document.groups)]));
  const ancestry = (id: string) => ancestors.get(id) ?? [];
  const displayIds = new Map<string, string>();
  const nodes: Node<DiagramCanvasNode>[] = [];
  const members = new Map<string, DiagramNode[]>();
  const position = (node: DiagramNode) => positions.get(node.id) ?? node.position;

  for (const node of visible) {
    const collapsed = ancestry(node.id).filter((id) => filter.collapsed?.includes(id)).at(-1);
    displayIds.set(node.id, collapsed ? `g:${collapsed}` : `n:${node.id}`);
    if (collapsed) {
      const list = members.get(collapsed) ?? [];
      list.push(node);
      members.set(collapsed, list);
    } else {
      nodes.push({ id: `n:${node.id}`, type: "component", position: position(node), width: COMPONENT_WIDTH, height: COMPONENT_HEIGHT,
        data: { label: node.label, kind: node.kind, node }, zIndex: 2 });
    }
  }
  for (const [id, list] of members) {
    const group = document.groups.find((candidate) => candidate.id === id);
    if (!group) continue;
    const bounds = graphBounds(list.map((node) => ({ position: position(node) })));
    nodes.push({ id: `g:${id}`, type: "component", position: { x: bounds.x, y: bounds.y }, width: COMPONENT_WIDTH, height: COMPONENT_HEIGHT,
      draggable: false, data: { label: group.label, kind: "group", group, count: list.length }, zIndex: 2 });
  }

  const boundaries: (Node<DiagramCanvasNode> & { width: number; height: number })[] = [];
  for (const group of (filter.showBoundaries ?? view?.showBoundaries ?? true) ? document.groups : []) {
    if (filter.collapsed?.includes(group.id) || groupAncestors({ groupId: group.parentId }, document.groups).some((id) => filter.collapsed?.includes(id))) continue;
    const memberIds = new Set(visible.filter((node) => ancestry(node.id).includes(group.id)).map((node) => displayIds.get(node.id)));
    const children = nodes.filter((node) => memberIds.has(node.id));
    if (!children.length) continue;
    const depth = Math.max(...visible.filter((node) => ancestry(node.id).includes(group.id)).map((node) => ancestry(node.id).indexOf(group.id)));
    const padding = 24 + depth * 20;
    const top = 48 + depth * 40;
    const bounds = graphBounds(children);
    boundaries.push({ id: `b:${group.id}`, type: "boundary", draggable: false, selectable: false,
      position: { x: bounds.x - padding, y: bounds.y - top }, width: bounds.width + padding * 2, height: bounds.height + top + padding,
      style: { width: bounds.width + padding * 2, height: bounds.height + top + padding }, zIndex: -1,
      data: { label: group.label, kind: "group", group, count: memberIds.size } });
  }
  boundaries.sort((a, b) => b.width * b.height - a.width * a.height);

  const aggregated = new Map<string, Edge<DiagramCanvasEdge> & { data: DiagramCanvasEdge }>();
  for (const edge of edges) {
    const source = displayIds.get(edge.source);
    const target = displayIds.get(edge.target);
    if (!source || !target || (source === target && edge.source !== edge.target)) continue;
    const isAggregated = source.startsWith("g:") || target.startsWith("g:");
    const key = isAggregated ? JSON.stringify([source, target, edge.kind, edge.evidence]) : edge.id;
    const previous = aggregated.get(key);
    if (previous) {
      previous.data.relationships.push(edge);
      previous.label = `${previous.data.relationships.length} ${edge.kind} links`;
      continue;
    }
    const sourceNode = nodes.find((node) => node.id === source);
    const targetNode = nodes.find((node) => node.id === target);
    if (!sourceNode || !targetNode) continue;
    const from = sourceNode.position;
    const to = targetNode.position;
    const horizontal = Math.abs(to.x - from.x) >= Math.abs(to.y - from.y);
    const route = isAggregated ? undefined : routes.get(edge.id) ?? edge.route;
    const sourceSide = route?.sourceSide ?? (horizontal ? (to.x >= from.x ? "right" : "left") : to.y >= from.y ? "bottom" : "top");
    const targetSide = route?.targetSide ?? (source === target ? "top" : { left: "right", right: "left", top: "bottom", bottom: "top" }[sourceSide]);
    aggregated.set(key, { id: `e:${edge.id}`, source, target, type: "architecture",
      sourceHandle: `s-${sourceSide}`, targetHandle: `t-${targetSide}`,
      label: edge.label || edge.kind, data: { relationships: [edge], route },
      style: { stroke: EDGE_COLORS[edge.kind], strokeWidth: 1.5, strokeDasharray: edge.evidence === "inferred" ? "6 5" : undefined },
      markerEnd: { type: MarkerType.ArrowClosed, color: EDGE_COLORS[edge.kind], width: 16, height: 16 },
      labelStyle: { fill: "var(--diagram-ink)", fontSize: 10 }, labelBgStyle: { fill: "var(--diagram-paper)" }, labelBgPadding: [5, 4], labelBgBorderRadius: 4,
    });
  }
  return { nodes: [...boundaries, ...nodes], edges: [...aggregated.values()], visibleNodeIds: visible.map((node) => node.id) };
}

export function moveDiagramNode(document: Diagram, id: string, position: DiagramPoint, viewId: string): Diagram {
  if (viewId) return { ...document, views: document.views.map((view) => view.id === viewId ? { ...view, positions: { ...view.positions, [id]: position } } : view) };
  return { ...document, nodes: document.nodes.map((node) => node.id === id ? { ...node, position } : node) };
}
