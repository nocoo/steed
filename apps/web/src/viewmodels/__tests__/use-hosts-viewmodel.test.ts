import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import type { HostWithStatus } from "@steed/shared";
import { createMockApiClient } from "./test-utils";

const mockApiClient = createMockApiClient();

vi.mock("@/contexts/api-client", () => ({
  useApiClient: () => mockApiClient,
}));

import { useHostsViewModel } from "../use-hosts-viewmodel";

const mockHosts: HostWithStatus[] = [
  {
    id: "host_1",
    name: "workstation-a",
    api_key_hash: "hash1",
    created_at: "2024-01-01T00:00:00Z",
    last_seen_at: "2024-01-02T12:00:00Z",
    status: "online",
  },
  {
    id: "host_2",
    name: "server-b",
    api_key_hash: "hash2",
    created_at: "2024-01-01T00:00:00Z",
    last_seen_at: null,
    status: "offline",
  },
];

describe("useHostsViewModel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should fetch hosts data on mount", async () => {
    vi.mocked(mockApiClient.hosts.list).mockResolvedValueOnce(mockHosts);

    const { result } = renderHook(() => useHostsViewModel());

    expect(result.current.loading).toBe(true);
    expect(result.current.hosts).toEqual([]);

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.hosts).toEqual(mockHosts);
    expect(result.current.error).toBeNull();
    expect(mockApiClient.hosts.list).toHaveBeenCalledTimes(1);
  });

  it("should handle fetch error", async () => {
    vi.mocked(mockApiClient.hosts.list).mockRejectedValueOnce(
      new Error("Network error")
    );

    const { result } = renderHook(() => useHostsViewModel());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.hosts).toEqual([]);
    expect(result.current.error).toBe("Network error");
  });

  it("should handle non-Error thrown", async () => {
    vi.mocked(mockApiClient.hosts.list).mockRejectedValueOnce("string error");

    const { result } = renderHook(() => useHostsViewModel());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.hosts).toEqual([]);
    expect(result.current.error).toBe("Unknown error");
  });

  it("should refetch data when refetch is called", async () => {
    vi.mocked(mockApiClient.hosts.list).mockResolvedValue(mockHosts);

    const { result } = renderHook(() => useHostsViewModel());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    await result.current.refetch();

    expect(mockApiClient.hosts.list).toHaveBeenCalledTimes(2);
  });
});
