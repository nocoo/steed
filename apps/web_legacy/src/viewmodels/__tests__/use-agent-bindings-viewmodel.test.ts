import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { useAgentBindingsViewModel } from "../use-agent-bindings-viewmodel";
import type { Binding, DataSourceListItem } from "@steed/shared";

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
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  beforeEach(() => {
    globalThis.fetch = vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({ data: [baseBinding], next_cursor: null }),
      })
    ) as unknown as typeof fetch;
  });

  it("fetches bindings on mount", async () => {
    const { result } = renderHook(() =>
      useAgentBindingsViewModel("agent_1", "host_1")
    );
    await waitFor(() => expect(result.current.loadingBindings).toBe(false));
    expect(result.current.bindings).toEqual([baseBinding]);
    expect(fetch).toHaveBeenCalledWith("/api/bindings?agent_id=agent_1");
  });

  it("surfaces fetch error from BFF body", async () => {
    globalThis.fetch = vi.fn(() =>
      Promise.resolve({
        ok: false,
        status: 500,
        json: () => Promise.resolve({ error: "boom" }),
      })
    ) as unknown as typeof fetch;
    const { result } = renderHook(() =>
      useAgentBindingsViewModel("agent_1", "host_1")
    );
    await waitFor(() => expect(result.current.loadingBindings).toBe(false));
    expect(result.current.error).toBe("boom");
  });

  it("falls back to status code when no error body", async () => {
    globalThis.fetch = vi.fn(() =>
      Promise.resolve({
        ok: false,
        status: 503,
        json: () => Promise.reject(new Error("nope")),
      })
    ) as unknown as typeof fetch;
    const { result } = renderHook(() =>
      useAgentBindingsViewModel("agent_1", "host_1")
    );
    await waitFor(() => expect(result.current.loadingBindings).toBe(false));
    expect(result.current.error).toBe("Failed to fetch bindings (503)");
  });

  it("handles non-Error rejection on fetch", async () => {
    globalThis.fetch = vi.fn(() => Promise.reject("x")) as unknown as typeof fetch;
    const { result } = renderHook(() =>
      useAgentBindingsViewModel("agent_1", "host_1")
    );
    await waitFor(() => expect(result.current.loadingBindings).toBe(false));
    expect(result.current.error).toBe("Unknown error");
  });

  it("ensureHostDataSources fetches and computes candidates", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({ data: [baseBinding], next_cursor: null }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({ data: hostDS, next_cursor: null }),
      });
    globalThis.fetch = mockFetch as typeof fetch;
    const { result } = renderHook(() =>
      useAgentBindingsViewModel("agent_1", "host_1")
    );
    await waitFor(() => expect(result.current.loadingBindings).toBe(false));
    await act(async () => {
      await result.current.ensureHostDataSources();
    });
    expect(result.current.hostDataSources).toEqual(hostDS);
    // ds_1 already bound → only ds_2 candidate
    expect(result.current.candidateDataSources.map((d) => d.id)).toEqual([
      "ds_2",
    ]);
  });

  it("ensureHostDataSources is no-op without hostId", async () => {
    const { result } = renderHook(() => useAgentBindingsViewModel("agent_1"));
    await waitFor(() => expect(result.current.loadingBindings).toBe(false));
    await act(async () => {
      await result.current.ensureHostDataSources();
    });
    expect(fetch).toHaveBeenCalledTimes(1); // only bindings fetched
  });

  it("ensureHostDataSources surfaces server error", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ data: [], next_cursor: null }),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: () => Promise.resolve({ error: "ds boom" }),
      });
    globalThis.fetch = mockFetch as typeof fetch;
    const { result } = renderHook(() =>
      useAgentBindingsViewModel("agent_1", "host_1")
    );
    await waitFor(() => expect(result.current.loadingBindings).toBe(false));
    await act(async () => {
      await result.current.ensureHostDataSources();
    });
    expect(result.current.error).toBe("ds boom");
  });

  it("ensureHostDataSources falls back to status when no error body", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ data: [], next_cursor: null }),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 504,
        json: () => Promise.reject(new Error("nope")),
      });
    globalThis.fetch = mockFetch as typeof fetch;
    const { result } = renderHook(() =>
      useAgentBindingsViewModel("agent_1", "host_1")
    );
    await waitFor(() => expect(result.current.loadingBindings).toBe(false));
    await act(async () => {
      await result.current.ensureHostDataSources();
    });
    expect(result.current.error).toBe("Failed to fetch data sources (504)");
  });

  it("ensureHostDataSources handles non-Error reject", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ data: [], next_cursor: null }),
      })
      .mockRejectedValueOnce("blam");
    globalThis.fetch = mockFetch as typeof fetch;
    const { result } = renderHook(() =>
      useAgentBindingsViewModel("agent_1", "host_1")
    );
    await waitFor(() => expect(result.current.loadingBindings).toBe(false));
    await act(async () => {
      await result.current.ensureHostDataSources();
    });
    expect(result.current.error).toBe("Unknown error");
  });

  it("addBinding posts and refetches", async () => {
    const newBinding: Binding = {
      ...baseBinding,
      data_source_id: "ds_2",
    };
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ data: [], next_cursor: null }),
      }) // initial bindings
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(newBinding),
      }) // POST
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({ data: [newBinding], next_cursor: null }),
      }); // refetch
    globalThis.fetch = mockFetch as typeof fetch;
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
  });

  it("addBinding returns BFF error", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ data: [], next_cursor: null }),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 409,
        json: () => Promise.resolve({ error: "exists" }),
      });
    globalThis.fetch = mockFetch as typeof fetch;
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

  it("addBinding falls back to status when no body", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ data: [], next_cursor: null }),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: () => Promise.reject(new Error("x")),
      });
    globalThis.fetch = mockFetch as typeof fetch;
    const { result } = renderHook(() =>
      useAgentBindingsViewModel("agent_1", "host_1")
    );
    await waitFor(() => expect(result.current.loadingBindings).toBe(false));
    let r: { ok: boolean; error?: string } = { ok: true };
    await act(async () => {
      r = await result.current.addBinding("ds_2");
    });
    expect(r.error).toBe("Add failed (500)");
  });

  it("addBinding handles thrown rejection types", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ data: [], next_cursor: null }),
      })
      .mockRejectedValueOnce(new Error("net"))
      .mockRejectedValueOnce("nope");
    globalThis.fetch = mockFetch as typeof fetch;
    const { result } = renderHook(() =>
      useAgentBindingsViewModel("agent_1", "host_1")
    );
    await waitFor(() => expect(result.current.loadingBindings).toBe(false));
    let r: { ok: boolean; error?: string } = { ok: true };
    await act(async () => {
      r = await result.current.addBinding("ds_2");
    });
    expect(r).toEqual({ ok: false, error: "net" });
    await act(async () => {
      r = await result.current.addBinding("ds_2");
    });
    expect(r.error).toBe("Unknown error");
  });

  it("removeBinding deletes and refetches", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({ data: [baseBinding], next_cursor: null }),
      })
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({}) })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ data: [], next_cursor: null }),
      });
    globalThis.fetch = mockFetch as typeof fetch;
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
  });

  it("removeBinding returns BFF error", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({ data: [baseBinding], next_cursor: null }),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 404,
        json: () => Promise.resolve({ error: "not bound" }),
      });
    globalThis.fetch = mockFetch as typeof fetch;
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

  it("removeBinding falls back to status when no body", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({ data: [baseBinding], next_cursor: null }),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: () => Promise.reject(new Error("nope")),
      });
    globalThis.fetch = mockFetch as typeof fetch;
    const { result } = renderHook(() =>
      useAgentBindingsViewModel("agent_1", "host_1")
    );
    await waitFor(() => expect(result.current.loadingBindings).toBe(false));
    let r: { ok: boolean; error?: string } = { ok: true };
    await act(async () => {
      r = await result.current.removeBinding("ds_1");
    });
    expect(r.error).toBe("Remove failed (500)");
  });

  it("removeBinding handles thrown rejection types", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({ data: [baseBinding], next_cursor: null }),
      })
      .mockRejectedValueOnce(new Error("net"))
      .mockRejectedValueOnce("x");
    globalThis.fetch = mockFetch as typeof fetch;
    const { result } = renderHook(() =>
      useAgentBindingsViewModel("agent_1", "host_1")
    );
    await waitFor(() => expect(result.current.loadingBindings).toBe(false));
    let r: { ok: boolean; error?: string } = { ok: true };
    await act(async () => {
      r = await result.current.removeBinding("ds_1");
    });
    expect(r).toEqual({ ok: false, error: "net" });
    await act(async () => {
      r = await result.current.removeBinding("ds_1");
    });
    expect(r.error).toBe("Unknown error");
  });

  it("refetchBindings re-runs the GET", async () => {
    const { result } = renderHook(() =>
      useAgentBindingsViewModel("agent_1", "host_1")
    );
    await waitFor(() => expect(result.current.loadingBindings).toBe(false));
    await act(async () => {
      await result.current.refetchBindings();
    });
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
