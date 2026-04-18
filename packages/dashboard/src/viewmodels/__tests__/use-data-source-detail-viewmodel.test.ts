import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { useDataSourceDetailViewModel } from "../use-data-source-detail-viewmodel";
import type { DataSourceWithLanes } from "@steed/shared";

const baseDS: DataSourceWithLanes = {
  id: "ds_1",
  host_id: "host_1",
  type: "personal_cli",
  name: "claude",
  version: "1.0.0",
  auth_status: "authenticated",
  status: "active",
  metadata: { notes: "n" },
  created_at: "2024-01-01T00:00:00Z",
  last_seen_at: "2024-01-02T00:00:00Z",
  lane_ids: ["lane_work"],
};

describe("useDataSourceDetailViewModel", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve(baseDS),
      })
    ) as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("fetches on mount", async () => {
    const { result } = renderHook(() => useDataSourceDetailViewModel("ds_1"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.dataSource).toEqual(baseDS);
  });

  it("surfaces server error message", async () => {
    globalThis.fetch = vi.fn(() =>
      Promise.resolve({
        ok: false,
        status: 404,
        json: () => Promise.resolve({ error: "DS not found" }),
      })
    ) as unknown as typeof fetch;
    const { result } = renderHook(() => useDataSourceDetailViewModel("ds_1"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("DS not found");
  });

  it("falls back to status code for fetch error", async () => {
    globalThis.fetch = vi.fn(() =>
      Promise.resolve({
        ok: false,
        status: 500,
        json: () => Promise.reject(new Error("not json")),
      })
    ) as unknown as typeof fetch;
    const { result } = renderHook(() => useDataSourceDetailViewModel("ds_1"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("Failed to fetch data source (500)");
  });

  it("handles non-Error rejection on fetch", async () => {
    globalThis.fetch = vi.fn(() => Promise.reject("oops")) as unknown as typeof fetch;
    const { result } = renderHook(() => useDataSourceDetailViewModel("ds_1"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("Unknown error");
  });

  it("saveMetadata replaces state on success", async () => {
    const updated = { ...baseDS, metadata: { notes: "n2" } };
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(baseDS) })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(updated),
      });
    globalThis.fetch = mockFetch as typeof fetch;

    const { result } = renderHook(() => useDataSourceDetailViewModel("ds_1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    let r: { ok: boolean; error?: string } = { ok: false };
    await act(async () => {
      r = await result.current.saveMetadata({ metadata: { notes: "n2" } });
    });
    expect(r.ok).toBe(true);
    expect(result.current.dataSource).toEqual(updated);
  });

  it("saveMetadata returns BFF error", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(baseDS) })
      .mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: () => Promise.resolve({ error: "bad" }),
      });
    globalThis.fetch = mockFetch as typeof fetch;

    const { result } = renderHook(() => useDataSourceDetailViewModel("ds_1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    let r: { ok: boolean; error?: string } = { ok: true };
    await act(async () => {
      r = await result.current.saveMetadata({ metadata: { notes: "n2" } });
    });
    expect(r).toEqual({ ok: false, error: "bad" });
  });

  it("saveMetadata falls back to status when no error body", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(baseDS) })
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: () => Promise.reject(new Error("nope")),
      });
    globalThis.fetch = mockFetch as typeof fetch;

    const { result } = renderHook(() => useDataSourceDetailViewModel("ds_1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    let r: { ok: boolean; error?: string } = { ok: true };
    await act(async () => {
      r = await result.current.saveMetadata({ metadata: { notes: "n2" } });
    });
    expect(r.ok).toBe(false);
    expect(r.error).toBe("Save failed (500)");
  });

  it("saveMetadata handles thrown Error", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(baseDS) })
      .mockRejectedValueOnce(new Error("net"));
    globalThis.fetch = mockFetch as typeof fetch;
    const { result } = renderHook(() => useDataSourceDetailViewModel("ds_1"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    let r: { ok: boolean; error?: string } = { ok: true };
    await act(async () => {
      r = await result.current.saveMetadata({ metadata: {} });
    });
    expect(r).toEqual({ ok: false, error: "net" });
  });

  it("saveMetadata handles non-Error rejection", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(baseDS) })
      .mockRejectedValueOnce("x");
    globalThis.fetch = mockFetch as typeof fetch;
    const { result } = renderHook(() => useDataSourceDetailViewModel("ds_1"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    let r: { ok: boolean; error?: string } = { ok: true };
    await act(async () => {
      r = await result.current.saveMetadata({ metadata: {} });
    });
    expect(r.error).toBe("Unknown error");
  });

  it("saveLanes merges only lane_ids into state", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(baseDS) })
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            data_source_id: "ds_1",
            lane_ids: ["lane_work", "lane_learning"],
          }),
      });
    globalThis.fetch = mockFetch as typeof fetch;

    const { result } = renderHook(() => useDataSourceDetailViewModel("ds_1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    let r: { ok: boolean; error?: string } = { ok: false };
    await act(async () => {
      r = await result.current.saveLanes(["lane_work", "lane_learning"]);
    });
    expect(r.ok).toBe(true);
    expect(result.current.dataSource?.lane_ids).toEqual([
      "lane_work",
      "lane_learning",
    ]);
    // metadata preserved
    expect(result.current.dataSource?.metadata).toEqual({ notes: "n" });
  });

  it("saveLanes returns error on non-ok", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(baseDS) })
      .mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: () => Promise.resolve({ error: "lane fail" }),
      });
    globalThis.fetch = mockFetch as typeof fetch;
    const { result } = renderHook(() => useDataSourceDetailViewModel("ds_1"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    let r: { ok: boolean; error?: string } = { ok: true };
    await act(async () => {
      r = await result.current.saveLanes(["lane_work"]);
    });
    expect(r).toEqual({ ok: false, error: "lane fail" });
  });

  it("saveLanes falls back to status when no error body", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(baseDS) })
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: () => Promise.reject(new Error("nope")),
      });
    globalThis.fetch = mockFetch as typeof fetch;
    const { result } = renderHook(() => useDataSourceDetailViewModel("ds_1"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    let r: { ok: boolean; error?: string } = { ok: true };
    await act(async () => {
      r = await result.current.saveLanes(["lane_work"]);
    });
    expect(r.ok).toBe(false);
    expect(r.error).toBe("Save failed (500)");
  });

  it("saveLanes handles thrown Error and non-Error", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(baseDS) })
      .mockRejectedValueOnce(new Error("net"))
      .mockRejectedValueOnce("nope");
    globalThis.fetch = mockFetch as typeof fetch;
    const { result } = renderHook(() => useDataSourceDetailViewModel("ds_1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    let r: { ok: boolean; error?: string } = { ok: true };
    await act(async () => {
      r = await result.current.saveLanes(["lane_work"]);
    });
    expect(r).toEqual({ ok: false, error: "net" });
    await act(async () => {
      r = await result.current.saveLanes(["lane_work"]);
    });
    expect(r.error).toBe("Unknown error");
  });

  it("saveLanes is no-op on state when dataSource is null (race)", async () => {
    // First fetch fails so dataSource stays null
    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: () => Promise.resolve({ error: "x" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({ data_source_id: "ds_1", lane_ids: ["lane_work"] }),
      }) as unknown as typeof fetch;
    const { result } = renderHook(() => useDataSourceDetailViewModel("ds_1"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.dataSource).toBeNull();
    let r: { ok: boolean } = { ok: false };
    await act(async () => {
      r = await result.current.saveLanes(["lane_work"]);
    });
    expect(r.ok).toBe(true);
    expect(result.current.dataSource).toBeNull();
  });

  it("refetch re-runs fetch", async () => {
    const { result } = renderHook(() => useDataSourceDetailViewModel("ds_1"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => {
      await result.current.refetch();
    });
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
