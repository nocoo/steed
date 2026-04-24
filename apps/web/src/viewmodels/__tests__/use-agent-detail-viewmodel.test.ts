import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import type { Agent } from "@steed/shared";
import { ApiHttpError } from "@steed/api/client";
import { createMockApiClient } from "./test-utils";

const mockApiClient = createMockApiClient();

vi.mock("@/contexts/api-client", () => ({
  useApiClient: () => mockApiClient,
}));

import { useAgentDetailViewModel } from "../use-agent-detail-viewmodel";

const baseAgent: Agent = {
  id: "agent_1",
  host_id: "host_1",
  match_key: "agent-a",
  nickname: "Alpha",
  role: "assistant",
  lane_id: "lane_work",
  metadata: {},
  extra: {},
  runtime_app: "node",
  runtime_version: "20.0.0",
  status: "running",
  created_at: "2024-01-01T00:00:00Z",
  last_seen_at: "2024-01-02T12:00:00Z",
};

describe("useAgentDetailViewModel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("fetches agent on mount", async () => {
    vi.mocked(mockApiClient.agents.get).mockResolvedValueOnce(baseAgent);

    const { result } = renderHook(() => useAgentDetailViewModel("agent_1"));

    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.agent).toEqual(baseAgent);
    expect(result.current.error).toBeNull();
    expect(mockApiClient.agents.get).toHaveBeenCalledWith("agent_1");
  });

  it("surfaces error from ApiHttpError", async () => {
    vi.mocked(mockApiClient.agents.get).mockRejectedValueOnce(
      new ApiHttpError(404, { error: "Agent not found" }, "Not Found")
    );

    const { result } = renderHook(() => useAgentDetailViewModel("agent_1"));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("Agent not found");
  });

  it("surfaces message from ApiHttpError when no body error", async () => {
    vi.mocked(mockApiClient.agents.get).mockRejectedValueOnce(
      new ApiHttpError(500, {}, "Internal Server Error")
    );

    const { result } = renderHook(() => useAgentDetailViewModel("agent_1"));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("Internal Server Error");
  });

  it("handles non-Error thrown during fetch", async () => {
    vi.mocked(mockApiClient.agents.get).mockRejectedValueOnce("boom");

    const { result } = renderHook(() => useAgentDetailViewModel("agent_1"));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("Unknown error");
  });

  it("save updates state on success", async () => {
    const updated: Agent = { ...baseAgent, nickname: "Beta" };
    vi.mocked(mockApiClient.agents.get).mockResolvedValueOnce(baseAgent);
    vi.mocked(mockApiClient.agents.update).mockResolvedValueOnce(updated);

    const { result } = renderHook(() => useAgentDetailViewModel("agent_1"));

    await waitFor(() => expect(result.current.loading).toBe(false));

    let saveResult: { ok: boolean; error?: string } = { ok: false };
    await act(async () => {
      saveResult = await result.current.save({ nickname: "Beta" });
    });

    expect(saveResult.ok).toBe(true);
    expect(result.current.agent).toEqual(updated);
    expect(mockApiClient.agents.update).toHaveBeenCalledWith("agent_1", {
      nickname: "Beta",
    });
  });

  it("save returns error from ApiHttpError", async () => {
    vi.mocked(mockApiClient.agents.get).mockResolvedValueOnce(baseAgent);
    vi.mocked(mockApiClient.agents.update).mockRejectedValueOnce(
      new ApiHttpError(400, { error: "Invalid request body" }, "Bad Request")
    );

    const { result } = renderHook(() => useAgentDetailViewModel("agent_1"));

    await waitFor(() => expect(result.current.loading).toBe(false));

    let saveResult: { ok: boolean; error?: string } = { ok: true };
    await act(async () => {
      saveResult = await result.current.save({ nickname: "Beta" });
    });

    expect(saveResult.ok).toBe(false);
    expect(saveResult.error).toBe("Invalid request body");
  });

  it("save returns error on network failure", async () => {
    vi.mocked(mockApiClient.agents.get).mockResolvedValueOnce(baseAgent);
    vi.mocked(mockApiClient.agents.update).mockRejectedValueOnce(
      new Error("network down")
    );

    const { result } = renderHook(() => useAgentDetailViewModel("agent_1"));

    await waitFor(() => expect(result.current.loading).toBe(false));

    let saveResult: { ok: boolean; error?: string } = { ok: true };
    await act(async () => {
      saveResult = await result.current.save({ nickname: "Beta" });
    });
    expect(saveResult.ok).toBe(false);
    expect(saveResult.error).toBe("network down");
  });

  it("save handles non-Error rejection", async () => {
    vi.mocked(mockApiClient.agents.get).mockResolvedValueOnce(baseAgent);
    vi.mocked(mockApiClient.agents.update).mockRejectedValueOnce("kaboom");

    const { result } = renderHook(() => useAgentDetailViewModel("agent_1"));

    await waitFor(() => expect(result.current.loading).toBe(false));

    let saveResult: { ok: boolean; error?: string } = { ok: true };
    await act(async () => {
      saveResult = await result.current.save({ nickname: "Beta" });
    });
    expect(saveResult.ok).toBe(false);
    expect(saveResult.error).toBe("Unknown error");
  });

  it("refetch re-runs the GET", async () => {
    vi.mocked(mockApiClient.agents.get).mockResolvedValue(baseAgent);

    const { result } = renderHook(() => useAgentDetailViewModel("agent_1"));

    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => {
      await result.current.refetch();
    });
    expect(mockApiClient.agents.get).toHaveBeenCalledTimes(2);
  });
});
