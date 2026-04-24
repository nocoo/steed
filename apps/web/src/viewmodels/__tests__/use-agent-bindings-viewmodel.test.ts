import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import type { Binding, DataSourceListItem } from "@steed/shared";
import { ApiHttpError } from "@steed/api/client";
import { createMockApiClient } from "./test-utils";

const mockApiClient = createMockApiClient();

vi.mock("@/contexts/api-client", () => ({
  useApiClient: () => mockApiClient,
}));

import { useAgentBindingsViewModel } from "../use-agent-bindings-viewmodel";

const baseBinding: Binding = {
  agent_id: "agent_1",
  data_source_id: "ds_1",
  created_at: "2024-01-01T00:00:00Z",
};

const hostDS: DataSourceListItem[] = [
  {
    id: "ds_1",
    host_id: "host_1",
    type: "personal_cli",
    name: "claude",
    version: "1.0.0",
    auth_status: "authenticated",
    status: "active",
    created_at: "2024-01-01T00:00:00Z",
    last_seen_at: null,
  },
  {
    id: "ds_2",
    host_id: "host_1",
    type: "third_party_cli",
    name: "codex",
    version: "0.1.0",
    auth_status: "unknown",
    status: "active",
    created_at: "2024-01-01T00:00:00Z",
    last_seen_at: null,
  },
];

describe("useAgentBindingsViewModel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("fetches bindings on mount", async () => {
    vi.mocked(mockApiClient.bindings.list).mockResolvedValueOnce({
      data: [baseBinding],
      next_cursor: null,
    });

    const { result } = renderHook(() =>
      useAgentBindingsViewModel("agent_1", "host_1")
    );

    await waitFor(() => expect(result.current.loadingBindings).toBe(false));
    expect(result.current.bindings).toEqual([baseBinding]);
    expect(mockApiClient.bindings.list).toHaveBeenCalledWith({
      agent_id: "agent_1",
    });
  });

  it("surfaces fetch error from ApiHttpError", async () => {
    vi.mocked(mockApiClient.bindings.list).mockRejectedValueOnce(
      new ApiHttpError(500, { error: "boom" }, "Server Error")
    );

    const { result } = renderHook(() =>
      useAgentBindingsViewModel("agent_1", "host_1")
    );

    await waitFor(() => expect(result.current.loadingBindings).toBe(false));
    expect(result.current.error).toBe("boom");
  });

  it("handles non-Error rejection on fetch", async () => {
    vi.mocked(mockApiClient.bindings.list).mockRejectedValueOnce("x");

    const { result } = renderHook(() =>
      useAgentBindingsViewModel("agent_1", "host_1")
    );

    await waitFor(() => expect(result.current.loadingBindings).toBe(false));
    expect(result.current.error).toBe("Unknown error");
  });

  it("ensureHostDataSources fetches and computes candidates", async () => {
    vi.mocked(mockApiClient.bindings.list).mockResolvedValueOnce({
      data: [baseBinding],
      next_cursor: null,
    });
    vi.mocked(mockApiClient.dataSources.list).mockResolvedValueOnce({
      data: hostDS,
      next_cursor: null,
    });

    const { result } = renderHook(() =>
      useAgentBindingsViewModel("agent_1", "host_1")
    );

    await waitFor(() => expect(result.current.loadingBindings).toBe(false));
    await act(async () => {
      await result.current.ensureHostDataSources();
    });

    expect(result.current.hostDataSources).toEqual(hostDS);
    expect(result.current.candidateDataSources.map((d) => d.id)).toEqual([
      "ds_2",
    ]);
  });

  it("ensureHostDataSources is no-op without hostId", async () => {
    vi.mocked(mockApiClient.bindings.list).mockResolvedValueOnce({
      data: [],
      next_cursor: null,
    });

    const { result } = renderHook(() => useAgentBindingsViewModel("agent_1"));

    await waitFor(() => expect(result.current.loadingBindings).toBe(false));
    await act(async () => {
      await result.current.ensureHostDataSources();
    });

    expect(mockApiClient.dataSources.list).not.toHaveBeenCalled();
  });

  it("addBinding creates and refetches", async () => {
    const newBinding: Binding = { ...baseBinding, data_source_id: "ds_2" };
    vi.mocked(mockApiClient.bindings.list)
      .mockResolvedValueOnce({ data: [], next_cursor: null })
      .mockResolvedValueOnce({ data: [newBinding], next_cursor: null });
    vi.mocked(mockApiClient.bindings.create).mockResolvedValueOnce(newBinding);

    const { result } = renderHook(() =>
      useAgentBindingsViewModel("agent_1", "host_1")
    );

    await waitFor(() => expect(result.current.loadingBindings).toBe(false));

    let r: { ok: boolean; error?: string } = { ok: false };
    await act(async () => {
      r = await result.current.addBinding("ds_2");
    });

    expect(r.ok).toBe(true);
    expect(result.current.bindings).toEqual([newBinding]);
    expect(mockApiClient.bindings.create).toHaveBeenCalledWith({
      agent_id: "agent_1",
      data_source_id: "ds_2",
    });
  });

  it("addBinding returns ApiHttpError", async () => {
    vi.mocked(mockApiClient.bindings.list).mockResolvedValueOnce({
      data: [],
      next_cursor: null,
    });
    vi.mocked(mockApiClient.bindings.create).mockRejectedValueOnce(
      new ApiHttpError(409, { error: "exists" }, "Conflict")
    );

    const { result } = renderHook(() =>
      useAgentBindingsViewModel("agent_1", "host_1")
    );

    await waitFor(() => expect(result.current.loadingBindings).toBe(false));

    let r: { ok: boolean; error?: string } = { ok: true };
    await act(async () => {
      r = await result.current.addBinding("ds_2");
    });

    expect(r).toEqual({ ok: false, error: "exists" });
  });

  it("removeBinding deletes and refetches", async () => {
    vi.mocked(mockApiClient.bindings.list)
      .mockResolvedValueOnce({ data: [baseBinding], next_cursor: null })
      .mockResolvedValueOnce({ data: [], next_cursor: null });
    vi.mocked(mockApiClient.bindings.delete).mockResolvedValueOnce(undefined);

    const { result } = renderHook(() =>
      useAgentBindingsViewModel("agent_1", "host_1")
    );

    await waitFor(() => expect(result.current.loadingBindings).toBe(false));

    let r: { ok: boolean; error?: string } = { ok: false };
    await act(async () => {
      r = await result.current.removeBinding("ds_1");
    });

    expect(r.ok).toBe(true);
    expect(result.current.bindings).toEqual([]);
    expect(mockApiClient.bindings.delete).toHaveBeenCalledWith(
      "agent_1",
      "ds_1"
    );
  });

  it("removeBinding returns ApiHttpError", async () => {
    vi.mocked(mockApiClient.bindings.list).mockResolvedValueOnce({
      data: [baseBinding],
      next_cursor: null,
    });
    vi.mocked(mockApiClient.bindings.delete).mockRejectedValueOnce(
      new ApiHttpError(404, { error: "not bound" }, "Not Found")
    );

    const { result } = renderHook(() =>
      useAgentBindingsViewModel("agent_1", "host_1")
    );

    await waitFor(() => expect(result.current.loadingBindings).toBe(false));

    let r: { ok: boolean; error?: string } = { ok: true };
    await act(async () => {
      r = await result.current.removeBinding("ds_1");
    });

    expect(r).toEqual({ ok: false, error: "not bound" });
  });
});
