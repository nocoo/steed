import { z } from "zod";
import {
  TOPOLOGY_LIMITS,
  topologyBoundarySchema,
  topologyEdgeSchema,
  topologyIdSchema,
  topologyLayerSchema,
  topologyNodeSchema,
  topologyTypeDefSchema,
  topologyViewSchema,
  validateTopology,
  type Topology,
  type TopologyValidationIssue,
} from "./topology";

export const topologyOperationSchema = z.discriminatedUnion("op", [
  z.strictObject({ op: z.literal("set_metadata"), title: z.string().optional(), description: z.string().optional(), provenance: z.string().nullable().optional() }),
  z.strictObject({ op: z.literal("put_layer"), value: topologyLayerSchema }),
  z.strictObject({ op: z.literal("put_type"), value: topologyTypeDefSchema }),
  z.strictObject({ op: z.literal("put_boundary"), value: topologyBoundarySchema }),
  z.strictObject({ op: z.literal("put_node"), value: topologyNodeSchema }),
  z.strictObject({ op: z.literal("put_edge"), value: topologyEdgeSchema }),
  z.strictObject({ op: z.literal("put_view"), value: topologyViewSchema }),
  z.strictObject({ op: z.literal("remove_layer"), id: topologyIdSchema }),
  z.strictObject({ op: z.literal("remove_type"), id: topologyIdSchema }),
  z.strictObject({ op: z.literal("remove_boundary"), id: topologyIdSchema }),
  z.strictObject({ op: z.literal("remove_node"), id: topologyIdSchema, cascade: z.boolean().default(false) }),
  z.strictObject({ op: z.literal("remove_edge"), id: topologyIdSchema }),
  z.strictObject({ op: z.literal("remove_view"), id: topologyIdSchema }),
]);

export const topologyOperationBatchSchema = z.strictObject({
  operations: z.array(topologyOperationSchema).min(1).max(TOPOLOGY_LIMITS.operations),
});

export type TopologyOperation = z.infer<typeof topologyOperationSchema>;

export class TopologyOperationError extends Error {
  constructor(public readonly code: string, public readonly issues: TopologyValidationIssue[] = []) {
    super(code);
  }
}

function put<T extends { id: string }>(items: T[], value: T): T[] {
  const index = items.findIndex((item) => item.id === value.id);
  if (index < 0) return [...items, value];
  return items.map((item, current) => current === index ? value : item);
}

function removeNode(topology: Topology, id: string, cascade: boolean): void {
  if (!topology.nodes.some((node) => node.id === id)) return;
  const ids = new Set([id]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const node of topology.nodes) {
      if (node.parentId && ids.has(node.parentId) && !ids.has(node.id)) {
        if (!cascade) throw new TopologyOperationError("node_has_satellites");
        ids.add(node.id);
        changed = true;
      }
    }
  }
  topology.nodes = topology.nodes.filter((node) => !ids.has(node.id));
  topology.edges = topology.edges.filter((edge) => !ids.has(edge.source) && !ids.has(edge.target));
  topology.views = topology.views.map((view) => ({
    ...view,
    pins: Object.fromEntries(Object.entries(view.pins).filter(([nodeId]) => !ids.has(nodeId))),
  }));
}

function removeBoundary(topology: Topology, id: string): void {
  const boundary = topology.boundaries.find((item) => item.id === id);
  if (!boundary) return;
  topology.boundaries = topology.boundaries.filter((item) => item.id !== id).map((item) => {
    if (item.parentId !== id) return item;
    const { parentId: _parentId, ...rest } = item;
    return boundary.parentId === undefined ? rest : { ...rest, parentId: boundary.parentId };
  });
  topology.nodes = topology.nodes.map((node) => ({ ...node, boundaryIds: node.boundaryIds.filter((boundaryId) => boundaryId !== id) }));
  topology.views = topology.views.map((view) => ({ ...view, filter: { ...view.filter, boundaryIds: view.filter.boundaryIds.filter((boundaryId) => boundaryId !== id) } }));
}

export function applyTopologyOperations(topology: Topology, operations: TopologyOperation[]): Topology {
  const next = structuredClone(topology);
  for (const operation of operations) {
    switch (operation.op) {
      case "set_metadata":
        if (operation.title !== undefined) next.title = operation.title;
        if (operation.description !== undefined) next.description = operation.description;
        if (operation.provenance === null) delete next.provenance;
        else if (operation.provenance !== undefined) next.provenance = operation.provenance;
        break;
      case "put_layer": next.layers = put(next.layers, operation.value); break;
      case "put_type": next.types = put(next.types, operation.value); break;
      case "put_boundary": next.boundaries = put(next.boundaries, operation.value); break;
      case "put_node": next.nodes = put(next.nodes, operation.value); break;
      case "put_edge": next.edges = put(next.edges, operation.value); break;
      case "put_view": next.views = put(next.views, operation.value); break;
      case "remove_layer":
        if (!next.layers.some((layer) => layer.id === operation.id)) break;
        if (next.nodes.some((node) => node.layerId === operation.id) || next.types.some((type) => type.defaultLayerId === operation.id) || next.views.some((view) => view.focusLayerId === operation.id || view.filter.layerIds.includes(operation.id))) throw new TopologyOperationError("layer_in_use");
        next.layers = next.layers.filter((layer) => layer.id !== operation.id);
        break;
      case "remove_type":
        if (!next.types.some((type) => type.id === operation.id)) break;
        if (next.nodes.some((node) => node.type === operation.id) || next.views.some((view) => view.filter.typeIds.includes(operation.id))) throw new TopologyOperationError("type_in_use");
        next.types = next.types.filter((type) => type.id !== operation.id);
        break;
      case "remove_boundary": removeBoundary(next, operation.id); break;
      case "remove_node": removeNode(next, operation.id, operation.cascade); break;
      case "remove_edge": next.edges = next.edges.filter((edge) => edge.id !== operation.id); break;
      case "remove_view": next.views = next.views.filter((view) => view.id !== operation.id); break;
    }
  }
  const result = validateTopology(next);
  if (!result.data) throw new TopologyOperationError("invalid_topology", result.issues);
  return result.data;
}

export const TOPOLOGY_COLLECTIONS = ["layers", "types", "boundaries", "nodes", "edges", "views"] as const;
export type TopologyCollection = typeof TOPOLOGY_COLLECTIONS[number];
export type TopologyEntity = Topology[TopologyCollection][number];
export type TopologyMetadata = Pick<Topology, "title" | "description" | "provenance">;
export type TopologyChangeItem =
  | { collection: "metadata"; id: "main"; before: TopologyMetadata; after: TopologyMetadata }
  | { collection: TopologyCollection; id: string; before: TopologyEntity | null; after: TopologyEntity | null };

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object).filter((key) => object[key] !== undefined).sort().map((key) => `${JSON.stringify(key)}:${canonical(object[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function metadata(topology: Topology): TopologyMetadata {
  return { title: topology.title, description: topology.description, ...(topology.provenance === undefined ? {} : { provenance: topology.provenance }) };
}

export function diffTopology(before: Topology, after: Topology): TopologyChangeItem[] {
  const items: TopologyChangeItem[] = [];
  const oldMetadata = metadata(before);
  const newMetadata = metadata(after);
  if (canonical(oldMetadata) !== canonical(newMetadata)) items.push({ collection: "metadata", id: "main", before: oldMetadata, after: newMetadata });
  for (const collection of TOPOLOGY_COLLECTIONS) {
    const oldItems = new Map(before[collection].map((item) => [item.id, item]));
    const newItems = new Map(after[collection].map((item) => [item.id, item]));
    const ids = [...new Set([...oldItems.keys(), ...newItems.keys()])].sort();
    for (const id of ids) {
      const oldItem = oldItems.get(id) ?? null;
      const newItem = newItems.get(id) ?? null;
      if (canonical(oldItem) !== canonical(newItem)) items.push({ collection, id, before: structuredClone(oldItem), after: structuredClone(newItem) });
    }
  }
  return items;
}

export function revertTopologyChange(current: Topology, items: TopologyChangeItem[], laterItems: Pick<TopologyChangeItem, "collection" | "id">[]): Topology {
  const laterKeys = new Set(laterItems.map((item) => `${item.collection}\0${item.id}`));
  if (items.some((item) => laterKeys.has(`${item.collection}\0${item.id}`))) throw new TopologyOperationError("revert_conflict");
  const next = structuredClone(current);
  for (const item of items) {
    if (item.collection === "metadata") {
      next.title = item.before.title;
      next.description = item.before.description;
      if (item.before.provenance === undefined) delete next.provenance;
      else next.provenance = item.before.provenance;
      continue;
    }
    const restored = next[item.collection].filter((entity) => entity.id !== item.id);
    if (item.before !== null) restored.push(structuredClone(item.before));
    switch (item.collection) {
      case "layers": next.layers = restored as Topology["layers"]; break;
      case "types": next.types = restored as Topology["types"]; break;
      case "boundaries": next.boundaries = restored as Topology["boundaries"]; break;
      case "nodes": next.nodes = restored as Topology["nodes"]; break;
      case "edges": next.edges = restored as Topology["edges"]; break;
      case "views": next.views = restored as Topology["views"]; break;
    }
  }
  const result = validateTopology(next);
  if (!result.data) throw new TopologyOperationError("invalid_topology", result.issues);
  return result.data;
}
