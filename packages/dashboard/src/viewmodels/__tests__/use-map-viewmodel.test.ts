import { describe, it, expect, vi, afterEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import {
  applyFilters,
  useMapViewModel,
  type MapPayload,
} from "../use-map-viewmodel";
import { buildGraph, LANE_ORDER } from "@/lib/map-data";

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
};

describe("useMapViewModel — fetching", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("loads payload on mount and exposes graphs", async () => {
    globalThis.fetch = vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve(payload),
      })
    ) as unknown as typeof fetch;

    const { result } = renderHook(() => useMapViewModel());
    expect(result.current.loading).toBe(true);

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toEqual(payload);
    expect(result.current.fullGraph.nodes.length).toBeGreaterThan(0);
    expect(fetch).toHaveBeenCalledWith("/api/map");
  });

  it("captures fetch failure as error", async () => {
    globalThis.fetch = vi.fn(() =>
      Promise.resolve({ ok: false, json: () => Promise.resolve({}) })
    ) as unknown as typeof fetch;
    const { result } = renderHook(() => useMapViewModel());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("Failed to fetch map");
  });

  it("refetch triggers another network call", async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve(payload) })
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const { result } = renderHook(() => useMapViewModel());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await act(async () => {
      await result.current.refetch();
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
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
    // a2 is unbound (orphan), h1 has agent (not orphan), ds1 is bound (not orphan)
    expect(filtered.nodes.find((n) => n.id === "a2")).toBeDefined();
    expect(filtered.nodes.find((n) => n.id === "a1")).toBeUndefined();
    expect(filtered.nodes.find((n) => n.id === "ds1")).toBeUndefined();
  });
});
