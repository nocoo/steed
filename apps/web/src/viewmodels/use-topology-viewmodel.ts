import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Topology, TopologyEdge, TopologyNode } from "@steed/api/shared";
import { topologyClient } from "@/lib/topology-client";

export type TopologyReach = "neighbors" | "upstream" | "downstream";

export interface TopologyFilter {
  viewId?: string;
  layerId?: string;
  typeId?: string;
  boundaryId?: string;
  tag?: string;
  search?: string;
}

export interface TopologyTrace {
  id: string;
  direction: TopologyReach;
}

export function reachableTopologyNodes(edges: TopologyEdge[], id: string, direction: TopologyReach): Set<string> {
  const found = new Set([id]);
  const queue = [id];
  for (const current of queue) {
    for (const edge of edges) {
      const sourcesBothWays = edge.direction === "bi";
      let next: string | null = null;
      if (direction === "neighbors") {
        if (edge.source === current) next = edge.target;
        else if (edge.target === current) next = edge.source;
      } else if (direction === "downstream") {
        if (edge.source === current) next = edge.target;
        else if (sourcesBothWays && edge.target === current) next = edge.source;
      } else {
        if (edge.target === current) next = edge.source;
        else if (sourcesBothWays && edge.source === current) next = edge.target;
      }
      if (next && !found.has(next)) {
        found.add(next);
        if (direction !== "neighbors") queue.push(next);
      }
    }
  }
  return found;
}

export function searchTopologyNodes(topology: Topology, query: string): TopologyNode[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  return topology.nodes.filter((node) => {
    const attrValues: string[] = [];
    for (const value of Object.values(node.attrs)) {
      if (Array.isArray(value)) attrValues.push(...value);
      else attrValues.push(String(value));
    }
    const haystack = [node.id, node.label, node.type, node.layerId, node.description, node.parentId ?? "", ...node.tags, ...attrValues]
      .join(" ").toLowerCase();
    return haystack.includes(needle);
  }).sort((a, b) => a.label.localeCompare(b.label) || a.id.localeCompare(b.id));
}

function rootAndHostBoundaries(topology: Topology, node: TopologyNode): Set<string> {
  const byId = new Map(topology.nodes.map((candidate) => [candidate.id, candidate]));
  let host = node;
  const seen = new Set<string>();
  while (host.parentId && !seen.has(host.parentId)) {
    seen.add(host.parentId);
    const parent = byId.get(host.parentId);
    if (!parent) break;
    host = parent;
  }
  return new Set([...node.boundaryIds, ...host.boundaryIds]);
}

export function filterTopologyNodes(topology: Topology, filter: TopologyFilter = {}): TopologyNode[] {
  const view = filter.viewId ? topology.views.find((candidate) => candidate.id === filter.viewId) : undefined;
  const viewFilter = view?.filter;

  return topology.nodes.filter((node) => {
    if (viewFilter?.layerIds.length && !viewFilter.layerIds.includes(node.layerId)) return false;
    if (viewFilter?.typeIds.length && !viewFilter.typeIds.includes(node.type)) return false;
    if (viewFilter?.boundaryIds.length) {
      const boundaries = rootAndHostBoundaries(topology, node);
      if (!viewFilter.boundaryIds.some((id) => boundaries.has(id))) return false;
    }
    if (viewFilter?.tags.length && !viewFilter.tags.some((tag) => node.tags.includes(tag))) return false;

    if (filter.layerId && node.layerId !== filter.layerId) return false;
    if (filter.typeId && node.type !== filter.typeId) return false;
    if (filter.boundaryId && !rootAndHostBoundaries(topology, node).has(filter.boundaryId)) return false;
    if (filter.tag && !node.tags.includes(filter.tag)) return false;
    return true;
  }).sort((a, b) => a.id.localeCompare(b.id));
}

export function filterTopology(topology: Topology, filter: TopologyFilter = {}) {
  const nodes = filterTopologyNodes(topology, filter);
  const visible = new Set(nodes.map((node) => node.id));
  const edges = topology.edges.filter((edge) => visible.has(edge.source) && visible.has(edge.target));
  return { nodes, edges };
}

export function useTopologyViewModel() {
  const [topology, setTopology] = useState<Topology | null>(null);
  const [updatedAt, setUpdatedAt] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [viewId, setViewId] = useState("");
  const [layerId, setLayerId] = useState("");
  const [typeId, setTypeId] = useState("");
  const [boundaryId, setBoundaryId] = useState("");
  const [tag, setTag] = useState("");
  const [search, setSearch] = useState("");
  const [selectedNodeId, setSelectedNodeId] = useState("");
  const [trace, setTraceState] = useState<TopologyTrace | null>(null);
  const generation = useRef(0);
  const mounted = useRef(true);

  const reload = useCallback(() => setRefresh((value) => value + 1), []);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; generation.current++; };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const current = ++generation.current;
    if (refresh > 0) setBusy(true);
    setLoading(refresh === 0);
    setError("");
    void (async () => {
      try {
        const snapshot = await topologyClient.get({ signal: controller.signal });
        if (current !== generation.current || controller.signal.aborted || !mounted.current) return;
        setTopology(snapshot.data);
        setUpdatedAt(snapshot.updatedAt);
      } catch (cause) {
        if (current === generation.current && !controller.signal.aborted && mounted.current) {
          setError(cause instanceof Error ? cause.message : "Topology is unavailable.");
        }
      } finally {
        if (current === generation.current && mounted.current) {
          setLoading(false);
          setBusy(false);
        }
      }
    })();
    return () => controller.abort();
  }, [refresh]);

  const filters = useMemo<TopologyFilter>(() => ({
    ...(viewId ? { viewId } : {}),
    ...(layerId ? { layerId } : {}),
    ...(typeId ? { typeId } : {}),
    ...(boundaryId ? { boundaryId } : {}),
    ...(tag ? { tag } : {}),
    ...(search ? { search } : {}),
  }), [viewId, layerId, typeId, boundaryId, tag, search]);

  const projected = useMemo(() => topology ? filterTopology(topology, filters) : { nodes: [], edges: [] }, [topology, filters]);
  const visibleIds = useMemo(() => {
    if (!trace) return null;
    if (!topology) return new Set<string>();
    return reachableTopologyNodes(topology.edges, trace.id, trace.direction);
  }, [topology, trace]);
  const visibleNodes = useMemo(() => {
    const nodes = visibleIds ? projected.nodes.filter((node) => visibleIds.has(node.id)) : projected.nodes;
    return nodes;
  }, [projected.nodes, visibleIds]);
  const visibleEdges = useMemo(() => {
    const visible = new Set(visibleNodes.map((node) => node.id));
    return topology ? projected.edges.filter((edge) => visible.has(edge.source) && visible.has(edge.target)) : [];
  }, [projected.edges, topology, visibleNodes]);
  const searchResults = useMemo(() => topology ? searchTopologyNodes(topology, search) : [], [topology, search]);
  const selectedNode = useMemo(() => topology?.nodes.find((node) => node.id === selectedNodeId) ?? null, [topology, selectedNodeId]);
  const selectedView = useMemo(() => topology?.views.find((view) => view.id === viewId) ?? null, [topology, viewId]);
  const focusLayerId = selectedView?.focusLayerId ?? "";

  const setFilter = useCallback((partial: Partial<TopologyFilter>) => {
    if (Object.hasOwn(partial, "viewId")) setViewId(partial.viewId ?? "");
    if (Object.hasOwn(partial, "layerId")) setLayerId(partial.layerId ?? "");
    if (Object.hasOwn(partial, "typeId")) setTypeId(partial.typeId ?? "");
    if (Object.hasOwn(partial, "boundaryId")) setBoundaryId(partial.boundaryId ?? "");
    if (Object.hasOwn(partial, "tag")) setTag(partial.tag ?? "");
    if (Object.hasOwn(partial, "search")) setSearch(partial.search ?? "");
  }, []);
  const clearFilters = useCallback(() => {
    setViewId(""); setLayerId(""); setTypeId(""); setBoundaryId(""); setTag(""); setSearch("");
  }, []);
  const traceNode = useCallback((id: string, direction: TopologyReach = "neighbors") => {
    setTraceState(id ? { id, direction } : null);
  }, []);
  const clearTrace = useCallback(() => setTraceState(null), []);
  const traceSelected = useCallback((direction: TopologyReach) => {
    if (selectedNodeId) setTraceState({ id: selectedNodeId, direction });
  }, [selectedNodeId]);

  return {
    topology, updatedAt, loading, busy, error, reload, refresh: reload,
    viewId, setViewId, layerId, setLayerId, typeId, setTypeId, boundaryId, setBoundaryId, tag, setTag,
    search, setSearch, filters, setFilter, clearFilters,
    visibleNodes, visibleEdges, searchResults,
    selectedNodeId, setSelectedNodeId, selectedNode,
    selectedView, focusLayerId,
    trace, setTrace: setTraceState, traceNode, traceSelected, clearTrace,
  };
}
