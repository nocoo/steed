import type { Topology, TopologyCollection, TopologyNode } from "@steed/api/shared";

export interface TopologyCollectionQuery {
  cursor: string;
  limit: number;
  layer?: string;
  type?: string;
  tag?: string;
  boundary?: string;
  parent?: string;
  node?: string;
  kind?: string;
}

export function topologyCollectionPage<K extends TopologyCollection>(topology: Topology, collection: K, query: TopologyCollectionQuery) {
  const nodesById = new Map(topology.nodes.map((node) => [node.id, node]));
  function boundaries(node: TopologyNode): string[] {
    let current = node;
    while (current.parentId) {
      const parent = nodesById.get(current.parentId);
      if (!parent) break;
      current = parent;
    }
    return current.boundaryIds;
  }
  const matches = (item: Topology[K][number]) => {
    if (collection === "nodes") {
      const node = item as TopologyNode;
      return (query.layer === undefined || node.layerId === query.layer)
        && (query.type === undefined || node.type === query.type)
        && (query.tag === undefined || node.tags.includes(query.tag))
        && (query.boundary === undefined || boundaries(node).includes(query.boundary))
        && (query.parent === undefined || node.parentId === query.parent);
    }
    if (collection === "edges") {
      const edge = item as Topology["edges"][number];
      return (query.node === undefined || edge.source === query.node || edge.target === query.node)
        && (query.kind === undefined || edge.kind === query.kind);
    }
    return true;
  };
  const items = [...topology[collection]].filter((item) => item.id > query.cursor && matches(item))
    .sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const data = items.slice(0, query.limit);
  return { data, nextCursor: items.length > query.limit ? data.at(-1)?.id ?? null : null };
}

export function topologyCollectionItem<K extends TopologyCollection>(topology: Topology, collection: K, id: string) {
  return topology[collection].find((item) => item.id === id) ?? null;
}
