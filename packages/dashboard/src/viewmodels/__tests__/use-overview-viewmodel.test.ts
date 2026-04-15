import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useOverviewViewModel } from "../use-overview-viewmodel";
import type { Overview } from "@steed/shared";

const mockOverview: Overview = {
  hosts: { total: 3, online: 2, offline: 1 },
  agents: {
    total: 10,
    running: 5,
    stopped: 3,
    missing: 2,
    by_lane: { work: 4, life: 2, learning: 1, unassigned: 3 },
  },
  data_sources: { total: 15, active: 12, missing: 3 },
};

describe("useOverviewViewModel", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve(mockOverview),
      })
    ) as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("should fetch overview data on mount", async () => {
    const { result } = renderHook(() => useOverviewViewModel());

    // Initially loading
    expect(result.current.loading).toBe(true);
    expect(result.current.data).toBeNull();

    // Wait for data
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.data).toEqual(mockOverview);
    expect(result.current.error).toBeNull();
    expect(fetch).toHaveBeenCalledWith("/api/overview");
  });

  it("should handle fetch error", async () => {
    globalThis.fetch = vi.fn(() =>
      Promise.resolve({
        ok: false,
        status: 500,
      })
    ) as unknown as typeof fetch;

    const { result } = renderHook(() => useOverviewViewModel());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.data).toBeNull();
    expect(result.current.error).toBe("Failed to fetch overview");
  });

  it("should handle non-Error thrown", async () => {
    globalThis.fetch = vi.fn(() => Promise.reject("string error")) as unknown as typeof fetch;

    const { result } = renderHook(() => useOverviewViewModel());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.data).toBeNull();
    expect(result.current.error).toBe("Unknown error");
  });

  it("should refetch data when refetch is called", async () => {
    const { result } = renderHook(() => useOverviewViewModel());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    // Call refetch
    await result.current.refetch();

    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
