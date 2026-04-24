import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import type { AgentListItem } from "@steed/shared";
import { createMockApiClient } from "./test-utils";

const mockApiClient = createMockApiClient();

vi.mock("@/contexts/api-client", () => ({
  useApiClient: () => mockApiClient,
}));

import { useAgentsViewModel } from "../use-agents-viewmodel";

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
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should fetch agents data on mount", async () => {
    vi.mocked(mockApiClient.agents.list).mockResolvedValueOnce({
      data: mockAgents,
      next_cursor: null,
    });

    const { result } = renderHook(() => useAgentsViewModel());

    expect(result.current.loading).toBe(true);
    expect(result.current.agents).toEqual([]);

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.agents).toEqual(mockAgents);
    expect(result.current.error).toBeNull();
    expect(result.current.hasMore).toBe(false);
    expect(mockApiClient.agents.list).toHaveBeenCalledWith({
      cursor: undefined,
      limit: 50,
    });
  });

  it("should handle fetch error", async () => {
    vi.mocked(mockApiClient.agents.list).mockRejectedValueOnce(
      new Error("Network error")
    );

    const { result } = renderHook(() => useAgentsViewModel());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.agents).toEqual([]);
    expect(result.current.error).toBe("Network error");
  });

  it("should handle non-Error thrown", async () => {
    vi.mocked(mockApiClient.agents.list).mockRejectedValueOnce("string error");

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

    vi.mocked(mockApiClient.agents.list)
      .mockResolvedValueOnce({ data: mockAgents, next_cursor: "cursor123" })
      .mockResolvedValueOnce({ data: moreAgents, next_cursor: null });

    const { result } = renderHook(() => useAgentsViewModel());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.hasMore).toBe(true);

    act(() => {
      result.current.loadMore();
    });

    await waitFor(() => {
      expect(result.current.agents.length).toBe(3);
    });

    expect(result.current.hasMore).toBe(false);
    expect(mockApiClient.agents.list).toHaveBeenCalledTimes(2);
    expect(mockApiClient.agents.list).toHaveBeenLastCalledWith({
      cursor: "cursor123",
      limit: 50,
    });
  });

  it("should not load more when no cursor", async () => {
    vi.mocked(mockApiClient.agents.list).mockResolvedValueOnce({
      data: mockAgents,
      next_cursor: null,
    });

    const { result } = renderHook(() => useAgentsViewModel());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    act(() => {
      result.current.loadMore();
    });

    expect(mockApiClient.agents.list).toHaveBeenCalledTimes(1);
  });

  it("should call refetch correctly", async () => {
    vi.mocked(mockApiClient.agents.list).mockResolvedValue({
      data: mockAgents,
      next_cursor: null,
    });

    const { result } = renderHook(() => useAgentsViewModel());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    await act(async () => {
      await result.current.refetch();
    });

    expect(mockApiClient.agents.list).toHaveBeenCalledTimes(2);
  });
});
