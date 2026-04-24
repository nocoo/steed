import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { buildGraph, LANE_ORDER } from "@steed/api/shared";
import type { MapPayload } from "@steed/api/client";
import { createMockApiClient } from "./test-utils";

const mockApiClient = createMockApiClient();

vi.mock("@/contexts/api-client", () => ({
  useApiClient: () => mockApiClient,
}));

import { applyFilters, useMapViewModel } from "../use-map-viewmodel";

const payload: MapPayload = {
  hosts: [
    {
      id: "h1",
      name: "host_a",
      api_key_hash: "x",
      created_at: "",
      last_seen_at: null,
      status: "online",
    },
    {
      id: "h2",
      name: "host_b",
      api_key_hash: "x",
      created_at: "",
      last_seen_at: null,
      status: "offline",
    },
  ],
  agents: [
    {
      id: "a1",
      host_id: "h1",
      match_key: "agent_1",
      nickname: null,
      role: null,
      lane_id: "lane_work",
      runtime_app: "node",
      runtime_version: null,
      status: "running",
      created_at: "",
      last_seen_at: null,
    },
    {
      id: "a2",
      host_id: "h2",
      match_key: "agent_2",
      nickname: null,
      role: null,
      lane_id: "lane_life",
      runtime_app: "python",
      runtime_version: null,
      status: "running",
      created_at: "",
      last_seen_at: null,
    },
  ],
  data_sources: [
    {
      id: "ds1",
      host_id: "h1",
      type: "personal_cli",
      name: "claude",
      version: null,
      auth_status: "authenticated",
      status: "active",
      metadata: {},
      created_at: "",
      last_seen_at: null,
      lane_ids: ["lane_work"],
    },
  ],
  bindings: [{ agent_id: "a1", data_source_id: "ds1", created_at: "" }],
  lanes: [],
  graph: { nodes: [], edges: [] },
};

describe("useMapViewModel — fetching", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("loads payload on mount and exposes graphs", async () => {
    vi.mocked(mockApiClient.map.get).mockResolvedValueOnce(payload);

    const { result } = renderHook(() => useMapViewModel());

    expect(result.current.loading).toBe(true);

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toEqual(payload);
    expect(result.current.fullGraph.nodes.length).toBeGreaterThan(0);
    expect(mockApiClient.map.get).toHaveBeenCalledTimes(1);
  });

  it("captures fetch failure as error", async () => {
    vi.mocked(mockApiClient.map.get).mockRejectedValueOnce(
      new Error("Network error")
    );

    const { result } = renderHook(() => useMapViewModel());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("Network error");
  });

  it("refetch triggers another network call", async () => {
    vi.mocked(mockApiClient.map.get).mockResolvedValue(payload);

    const { result } = renderHook(() => useMapViewModel());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(mockApiClient.map.get).toHaveBeenCalledTimes(1);

    await act(async () => {
      await result.current.refetch();
    });

    expect(mockApiClient.map.get).toHaveBeenCalledTimes(2);
  });
});

describe("applyFilters", () => {
  const graph = buildGraph(payload);

  it("returns full graph when all lanes selected and no host filter", () => {
    const filtered = applyFilters(graph, {
      lanes: [...LANE_ORDER],
      hostId: null,
      orphansOnly: false,
    });
    expect(filtered.nodes).toHaveLength(graph.nodes.length);
    expect(filtered.edges).toHaveLength(graph.edges.length);
  });

  it("removes work-lane nodes when 'work' is unchecked", () => {
    const filtered = applyFilters(graph, {
      lanes: ["life", "learning", "unassigned"],
      hostId: null,
      orphansOnly: false,
    });
    expect(filtered.nodes.find((n) => n.id === "a1")).toBeUndefined();
    expect(filtered.nodes.find((n) => n.id === "ds1")).toBeUndefined();
    expect(filtered.nodes.find((n) => n.id === "a2")).toBeDefined();
  });

  it("host filter narrows nodes to that host's agents/ds", () => {
    const filtered = applyFilters(graph, {
      lanes: [...LANE_ORDER],
      hostId: "h1",
      orphansOnly: false,
    });
    expect(filtered.nodes.find((n) => n.id === "h2")).toBeUndefined();
    expect(filtered.nodes.find((n) => n.id === "a2")).toBeUndefined();
    expect(filtered.nodes.find((n) => n.id === "a1")).toBeDefined();
  });

  it("orphansOnly keeps only orphan-flagged nodes", () => {
    const filtered = applyFilters(graph, {
      lanes: [...LANE_ORDER],
      hostId: null,
      orphansOnly: true,
    });
    expect(filtered.nodes.find((n) => n.id === "a2")).toBeDefined();
    expect(filtered.nodes.find((n) => n.id === "a1")).toBeUndefined();
    expect(filtered.nodes.find((n) => n.id === "ds1")).toBeUndefined();
  });
});
