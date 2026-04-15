import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useHostsViewModel } from "../use-hosts-viewmodel";
import type { HostWithStatus } from "@steed/shared";

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
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockHosts),
        })
      )
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("should fetch hosts data on mount", async () => {
    const { result } = renderHook(() => useHostsViewModel());

    // Initially loading
    expect(result.current.loading).toBe(true);
    expect(result.current.hosts).toEqual([]);

    // Wait for data
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.hosts).toEqual(mockHosts);
    expect(result.current.error).toBeNull();
    expect(fetch).toHaveBeenCalledWith("/api/hosts");
  });

  it("should handle fetch error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve({
          ok: false,
          status: 500,
        })
      )
    );

    const { result } = renderHook(() => useHostsViewModel());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.hosts).toEqual([]);
    expect(result.current.error).toBe("Failed to fetch hosts");
  });

  it("should handle non-Error thrown", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject("string error"))
    );

    const { result } = renderHook(() => useHostsViewModel());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.hosts).toEqual([]);
    expect(result.current.error).toBe("Unknown error");
  });

  it("should refetch data when refetch is called", async () => {
    const { result } = renderHook(() => useHostsViewModel());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    // Call refetch
    await result.current.refetch();

    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
