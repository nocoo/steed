import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import type { DataSourceListItem } from "@steed/shared";
import { createMockApiClient } from "./test-utils";

const mockApiClient = createMockApiClient();

vi.mock("@/contexts/api-client", () => ({
  useApiClient: () => mockApiClient,
}));

import { useDataSourcesViewModel } from "../use-data-sources-viewmodel";

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
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should fetch data sources on mount", async () => {
    vi.mocked(mockApiClient.dataSources.list).mockResolvedValueOnce({
      data: mockDataSources,
      next_cursor: null,
    });

    const { result } = renderHook(() => useDataSourcesViewModel());

    expect(result.current.loading).toBe(true);
    expect(result.current.dataSources).toEqual([]);

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.dataSources).toEqual(mockDataSources);
    expect(result.current.error).toBeNull();
    expect(result.current.hasMore).toBe(false);
    expect(mockApiClient.dataSources.list).toHaveBeenCalledWith({
      cursor: undefined,
      limit: 50,
    });
  });

  it("should handle fetch error", async () => {
    vi.mocked(mockApiClient.dataSources.list).mockRejectedValueOnce(
      new Error("Network error")
    );

    const { result } = renderHook(() => useDataSourcesViewModel());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.dataSources).toEqual([]);
    expect(result.current.error).toBe("Network error");
  });

  it("should handle non-Error thrown", async () => {
    vi.mocked(mockApiClient.dataSources.list).mockRejectedValueOnce(
      "string error"
    );

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

    vi.mocked(mockApiClient.dataSources.list)
      .mockResolvedValueOnce({ data: mockDataSources, next_cursor: "cursor456" })
      .mockResolvedValueOnce({ data: moreDataSources, next_cursor: null });

    const { result } = renderHook(() => useDataSourcesViewModel());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.hasMore).toBe(true);

    act(() => {
      result.current.loadMore();
    });

    await waitFor(() => {
      expect(result.current.dataSources.length).toBe(3);
    });

    expect(result.current.hasMore).toBe(false);
    expect(mockApiClient.dataSources.list).toHaveBeenCalledTimes(2);
    expect(mockApiClient.dataSources.list).toHaveBeenLastCalledWith({
      cursor: "cursor456",
      limit: 50,
    });
  });

  it("should not load more when no cursor", async () => {
    vi.mocked(mockApiClient.dataSources.list).mockResolvedValueOnce({
      data: mockDataSources,
      next_cursor: null,
    });

    const { result } = renderHook(() => useDataSourcesViewModel());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    act(() => {
      result.current.loadMore();
    });

    expect(mockApiClient.dataSources.list).toHaveBeenCalledTimes(1);
  });

  it("should call refetch correctly", async () => {
    vi.mocked(mockApiClient.dataSources.list).mockResolvedValue({
      data: mockDataSources,
      next_cursor: null,
    });

    const { result } = renderHook(() => useDataSourcesViewModel());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    await act(async () => {
      await result.current.refetch();
    });

    expect(mockApiClient.dataSources.list).toHaveBeenCalledTimes(2);
  });
});
