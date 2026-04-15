import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { useDataSourcesViewModel } from "../use-data-sources-viewmodel";
import type { DataSourceListItem } from "@steed/shared";

const mockDataSources: DataSourceListItem[] = [
  {
    id: "ds_1",
    host_id: "host_1",
    type: "personal_cli",
    name: "gh",
    version: "2.40.0",
    auth_status: "authenticated",
    status: "active",
    created_at: "2024-01-01T00:00:00Z",
    last_seen_at: "2024-01-02T12:00:00Z",
  },
  {
    id: "ds_2",
    host_id: "host_1",
    type: "mcp",
    name: "linear-mcp",
    version: null,
    auth_status: "unknown",
    status: "missing",
    created_at: "2024-01-01T00:00:00Z",
    last_seen_at: null,
  },
];

describe("useDataSourcesViewModel", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({ data: mockDataSources, next_cursor: null }),
      })
    ) as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("should fetch data sources on mount", async () => {
    const { result } = renderHook(() => useDataSourcesViewModel());

    // Initially loading
    expect(result.current.loading).toBe(true);
    expect(result.current.dataSources).toEqual([]);

    // Wait for data
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.dataSources).toEqual(mockDataSources);
    expect(result.current.error).toBeNull();
    expect(result.current.hasMore).toBe(false);
    expect(fetch).toHaveBeenCalledWith("/api/data-sources?limit=50");
  });

  it("should handle fetch error", async () => {
    globalThis.fetch = vi.fn(() =>
      Promise.resolve({
        ok: false,
        status: 500,
      })
    ) as typeof fetch;

    const { result } = renderHook(() => useDataSourcesViewModel());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.dataSources).toEqual([]);
    expect(result.current.error).toBe("Failed to fetch data sources");
  });

  it("should handle non-Error thrown", async () => {
    globalThis.fetch = vi.fn(() => Promise.reject("string error")) as typeof fetch;

    const { result } = renderHook(() => useDataSourcesViewModel());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.dataSources).toEqual([]);
    expect(result.current.error).toBe("Unknown error");
  });

  it("should load more when next_cursor exists", async () => {
    const moreDataSources: DataSourceListItem[] = [
      {
        id: "ds_3",
        host_id: "host_2",
        type: "third_party_cli",
        name: "aws",
        version: "2.15.0",
        auth_status: "authenticated",
        status: "active",
        created_at: "2024-01-01T00:00:00Z",
        last_seen_at: "2024-01-02T12:00:00Z",
      },
    ];

    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({ data: mockDataSources, next_cursor: "cursor456" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({ data: moreDataSources, next_cursor: null }),
      });
    globalThis.fetch = mockFetch as typeof fetch;

    const { result } = renderHook(() => useDataSourcesViewModel());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.hasMore).toBe(true);

    // Load more
    act(() => {
      result.current.loadMore();
    });

    await waitFor(() => {
      expect(result.current.dataSources.length).toBe(3);
    });

    expect(result.current.hasMore).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch).toHaveBeenLastCalledWith("/api/data-sources?cursor=cursor456&limit=50");
  });

  it("should not load more when no cursor", async () => {
    const { result } = renderHook(() => useDataSourcesViewModel());

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
    const { result } = renderHook(() => useDataSourcesViewModel());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    await act(async () => {
      await result.current.refetch();
    });

    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
