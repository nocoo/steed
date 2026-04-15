import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { useAgentsViewModel } from "../use-agents-viewmodel";
import type { AgentListItem } from "@steed/shared";

const mockAgents: AgentListItem[] = [
  {
    id: "agent_1",
    host_id: "host_1",
    match_key: "agent-a",
    nickname: "Alpha",
    role: "assistant",
    lane_id: "lane_work",
    runtime_app: "node",
    runtime_version: "20.0.0",
    status: "running",
    created_at: "2024-01-01T00:00:00Z",
    last_seen_at: "2024-01-02T12:00:00Z",
  },
  {
    id: "agent_2",
    host_id: "host_1",
    match_key: "agent-b",
    nickname: null,
    role: null,
    lane_id: null,
    runtime_app: null,
    runtime_version: null,
    status: "stopped",
    created_at: "2024-01-01T00:00:00Z",
    last_seen_at: null,
  },
];

describe("useAgentsViewModel", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({ data: mockAgents, next_cursor: null }),
      })
    ) as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("should fetch agents data on mount", async () => {
    const { result } = renderHook(() => useAgentsViewModel());

    // Initially loading
    expect(result.current.loading).toBe(true);
    expect(result.current.agents).toEqual([]);

    // Wait for data
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.agents).toEqual(mockAgents);
    expect(result.current.error).toBeNull();
    expect(result.current.hasMore).toBe(false);
    expect(fetch).toHaveBeenCalledWith("/api/agents?limit=50");
  });

  it("should handle fetch error", async () => {
    globalThis.fetch = vi.fn(() =>
      Promise.resolve({
        ok: false,
        status: 500,
      })
    ) as typeof fetch;

    const { result } = renderHook(() => useAgentsViewModel());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.agents).toEqual([]);
    expect(result.current.error).toBe("Failed to fetch agents");
  });

  it("should handle non-Error thrown", async () => {
    globalThis.fetch = vi.fn(() => Promise.reject("string error")) as typeof fetch;

    const { result } = renderHook(() => useAgentsViewModel());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.agents).toEqual([]);
    expect(result.current.error).toBe("Unknown error");
  });

  it("should load more when next_cursor exists", async () => {
    const moreAgents: AgentListItem[] = [
      {
        id: "agent_3",
        host_id: "host_2",
        match_key: "agent-c",
        nickname: "Gamma",
        role: null,
        lane_id: null,
        runtime_app: "python",
        runtime_version: "3.11",
        status: "running",
        created_at: "2024-01-01T00:00:00Z",
        last_seen_at: "2024-01-02T12:00:00Z",
      },
    ];

    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({ data: mockAgents, next_cursor: "cursor123" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({ data: moreAgents, next_cursor: null }),
      });
    globalThis.fetch = mockFetch as typeof fetch;

    const { result } = renderHook(() => useAgentsViewModel());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.hasMore).toBe(true);

    // Load more
    act(() => {
      result.current.loadMore();
    });

    await waitFor(() => {
      expect(result.current.agents.length).toBe(3);
    });

    expect(result.current.hasMore).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch).toHaveBeenLastCalledWith("/api/agents?cursor=cursor123&limit=50");
  });

  it("should not load more when no cursor", async () => {
    const { result } = renderHook(() => useAgentsViewModel());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    // Call loadMore when hasMore is false
    act(() => {
      result.current.loadMore();
    });

    // Should not trigger additional fetch
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("should call refetch correctly", async () => {
    const { result } = renderHook(() => useAgentsViewModel());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    await act(async () => {
      await result.current.refetch();
    });

    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
