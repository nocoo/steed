import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import type { Overview } from "@steed/shared";
import { createMockApiClient } from "./test-utils";

const mockApiClient = createMockApiClient();

vi.mock("@/contexts/api-client", () => ({
  useApiClient: () => mockApiClient,
}));

import { useOverviewViewModel } from "../use-overview-viewmodel";

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
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should fetch overview data on mount", async () => {
    vi.mocked(mockApiClient.overview.get).mockResolvedValueOnce(mockOverview);

    const { result } = renderHook(() => useOverviewViewModel());

    expect(result.current.loading).toBe(true);
    expect(result.current.data).toBeNull();

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.data).toEqual(mockOverview);
    expect(result.current.error).toBeNull();
    expect(mockApiClient.overview.get).toHaveBeenCalledTimes(1);
  });

  it("should handle fetch error", async () => {
    vi.mocked(mockApiClient.overview.get).mockRejectedValueOnce(
      new Error("Network error")
    );

    const { result } = renderHook(() => useOverviewViewModel());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.data).toBeNull();
    expect(result.current.error).toBe("Network error");
  });

  it("should handle non-Error thrown", async () => {
    vi.mocked(mockApiClient.overview.get).mockRejectedValueOnce("string error");

    const { result } = renderHook(() => useOverviewViewModel());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.data).toBeNull();
    expect(result.current.error).toBe("Unknown error");
  });

  it("should refetch data when refetch is called", async () => {
    vi.mocked(mockApiClient.overview.get).mockResolvedValue(mockOverview);

    const { result } = renderHook(() => useOverviewViewModel());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    await result.current.refetch();

    expect(mockApiClient.overview.get).toHaveBeenCalledTimes(2);
  });
});
