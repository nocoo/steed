import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { useAgentDetailViewModel } from "../use-agent-detail-viewmodel";
import type { Agent } from "@steed/shared";

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
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve(baseAgent),
      })
    ) as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("fetches agent on mount", async () => {
    const { result } = renderHook(() => useAgentDetailViewModel("agent_1"));
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.agent).toEqual(baseAgent);
    expect(result.current.error).toBeNull();
    expect(fetch).toHaveBeenCalledWith("/api/agents/agent_1");
  });

  it("surfaces error from non-ok response", async () => {
    globalThis.fetch = vi.fn(() =>
      Promise.resolve({
        ok: false,
        status: 404,
        json: () => Promise.resolve({ error: "Agent not found" }),
      })
    ) as unknown as typeof fetch;
    const { result } = renderHook(() => useAgentDetailViewModel("agent_1"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("Agent not found");
  });

  it("falls back to status code when error body missing", async () => {
    globalThis.fetch = vi.fn(() =>
      Promise.resolve({
        ok: false,
        status: 500,
        json: () => Promise.reject(new Error("not json")),
      })
    ) as unknown as typeof fetch;
    const { result } = renderHook(() => useAgentDetailViewModel("agent_1"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("Failed to fetch agent (500)");
  });

  it("handles non-Error thrown during fetch", async () => {
    globalThis.fetch = vi.fn(() => Promise.reject("boom")) as unknown as typeof fetch;
    const { result } = renderHook(() => useAgentDetailViewModel("agent_1"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("Unknown error");
  });

  it("save updates state on success", async () => {
    const updated: Agent = { ...baseAgent, nickname: "Beta" };
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(baseAgent),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(updated),
      });
    globalThis.fetch = mockFetch as typeof fetch;

    const { result } = renderHook(() => useAgentDetailViewModel("agent_1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    let saveResult: { ok: boolean; error?: string } = { ok: false };
    await act(async () => {
      saveResult = await result.current.save({ nickname: "Beta" });
    });

    expect(saveResult.ok).toBe(true);
    expect(result.current.agent).toEqual(updated);
    expect(mockFetch).toHaveBeenLastCalledWith(
      "/api/agents/agent_1",
      expect.objectContaining({ method: "PATCH" })
    );
  });

  it("save returns error from BFF response", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(baseAgent),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: () => Promise.resolve({ error: "Invalid request body" }),
      });
    globalThis.fetch = mockFetch as typeof fetch;

    const { result } = renderHook(() => useAgentDetailViewModel("agent_1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    let saveResult: { ok: boolean; error?: string } = { ok: true };
    await act(async () => {
      saveResult = await result.current.save({ nickname: "Beta" });
    });

    expect(saveResult.ok).toBe(false);
    expect(saveResult.error).toBe("Invalid request body");
  });

  it("save falls back to status when no error body", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(baseAgent),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: () => Promise.reject(new Error("not json")),
      });
    globalThis.fetch = mockFetch as typeof fetch;

    const { result } = renderHook(() => useAgentDetailViewModel("agent_1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    let saveResult: { ok: boolean; error?: string } = { ok: true };
    await act(async () => {
      saveResult = await result.current.save({ nickname: "Beta" });
    });

    expect(saveResult.ok).toBe(false);
    expect(saveResult.error).toBe("Save failed (500)");
  });

  it("save returns error on network failure", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(baseAgent),
      })
      .mockRejectedValueOnce(new Error("network down"));
    globalThis.fetch = mockFetch as typeof fetch;

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
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(baseAgent),
      })
      .mockRejectedValueOnce("kaboom");
    globalThis.fetch = mockFetch as typeof fetch;

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
    const { result } = renderHook(() => useAgentDetailViewModel("agent_1"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => {
      await result.current.refetch();
    });
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
