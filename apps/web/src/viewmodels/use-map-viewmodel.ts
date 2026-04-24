import { useCallback, useEffect, useMemo, useState } from "react";
import { useApiClient } from "@/contexts/api-client";
import type { MapPayload } from "@steed/api/client";
import {
  buildGraph,
  LANE_ORDER,
  type LaneKey,
  type MapGraph,
} from "@steed/api/shared";

export type { MapPayload };

export interface MapFilters {
  lanes: LaneKey[];
  hostId: string | null;
  orphansOnly: boolean;
}

const DEFAULT_FILTERS: MapFilters = {
  lanes: [...LANE_ORDER],
  hostId: null,
  orphansOnly: false,
};

interface State {
  data: MapPayload | null;
  loading: boolean;
  error: string | null;
}

export function useMapViewModel() {
  const apiClient = useApiClient();
  const [state, setState] = useState<State>({
    data: null,
    loading: true,
    error: null,
  });
  const [filters, setFilters] = useState<MapFilters>(DEFAULT_FILTERS);

  const fetchMap = useCallback(async () => {
    setState((prev) => ({ ...prev, loading: true, error: null }));
    try {
      const data = await apiClient.map.get();
      setState({ data, loading: false, error: null });
    } catch (err) {
      setState({
        data: null,
        loading: false,
        error: err instanceof Error ? err.message : "Unknown error",
      });
    }
  }, [apiClient]);

  useEffect(() => {
    void fetchMap();
  }, [fetchMap]);

  const fullGraph = useMemo<MapGraph>(() => {
    if (!state.data) return { nodes: [], edges: [] };
    return buildGraph(state.data);
  }, [state.data]);

  const filteredGraph = useMemo<MapGraph>(
    () => applyFilters(fullGraph, filters),
    [fullGraph, filters]
  );

  return {
    ...state,
    filters,
    setFilters,
    fullGraph,
    filteredGraph,
    refetch: fetchMap,
  };
}

export function applyFilters(graph: MapGraph, filters: MapFilters): MapGraph {
  const allLanes = filters.lanes.length === LANE_ORDER.length;
  const laneSet = new Set(filters.lanes);

  const keepNode = (id: string): boolean => {
    const n = graph.nodes.find((x) => x.id === id);
    if (!n) return false;
    if (filters.hostId) {
      if (n.kind === "host" && n.id !== filters.hostId) return false;
      if (n.kind === "agent" && n.data.kind === "agent") {
        if (n.data.raw.host_id !== filters.hostId) return false;
      }
      if (n.kind === "data_source" && n.data.kind === "data_source") {
        if (n.data.raw.host_id !== filters.hostId) return false;
      }
    }
    if (!allLanes) {
      if (n.kind === "agent" || n.kind === "data_source") {
        const has = n.data.laneKeys.some((k) => laneSet.has(k));
        if (!has) return false;
      }
    }
    return true;
  };

  let nodes = graph.nodes.filter((n) => keepNode(n.id));
  let edges = graph.edges.filter(
    (e) => keepNode(e.source) && keepNode(e.target)
  );

  if (filters.orphansOnly) {
    const orphanIds = new Set(
      nodes.filter((n) => n.data.orphan).map((n) => n.id)
    );
    nodes = nodes.filter((n) => orphanIds.has(n.id));
    edges = edges.filter(
      (e) => orphanIds.has(e.source) && orphanIds.has(e.target)
    );
  }

  return { nodes, edges };
}
