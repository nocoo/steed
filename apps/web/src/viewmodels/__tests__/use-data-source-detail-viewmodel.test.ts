import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import type { DataSourceWithLanes, LaneId } from "@steed/shared";
import { ApiHttpError } from "@steed/api/client";
import { createMockApiClient } from "./test-utils";

const mockApiClient = createMockApiClient();

vi.mock("@/contexts/api-client", () => ({
  useApiClient: () => mockApiClient,
}));

import { useDataSourceDetailViewModel } from "../use-data-source-detail-viewmodel";

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
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("fetches on mount", async () => {
    vi.mocked(mockApiClient.dataSources.get).mockResolvedValueOnce(baseDS);

    const { result } = renderHook(() => useDataSourceDetailViewModel("ds_1"));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.dataSource).toEqual(baseDS);
    expect(mockApiClient.dataSources.get).toHaveBeenCalledWith("ds_1");
  });

  it("surfaces ApiHttpError message", async () => {
    vi.mocked(mockApiClient.dataSources.get).mockRejectedValueOnce(
      new ApiHttpError(404, { error: "DS not found" }, "Not Found")
    );

    const { result } = renderHook(() => useDataSourceDetailViewModel("ds_1"));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("DS not found");
  });

  it("handles non-Error rejection on fetch", async () => {
    vi.mocked(mockApiClient.dataSources.get).mockRejectedValueOnce("oops");

    const { result } = renderHook(() => useDataSourceDetailViewModel("ds_1"));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("Unknown error");
  });

  it("saveMetadata replaces state on success", async () => {
    const updated = { ...baseDS, metadata: { notes: "n2" } };
    vi.mocked(mockApiClient.dataSources.get).mockResolvedValueOnce(baseDS);
    vi.mocked(mockApiClient.dataSources.update).mockResolvedValueOnce(updated);

    const { result } = renderHook(() => useDataSourceDetailViewModel("ds_1"));

    await waitFor(() => expect(result.current.loading).toBe(false));

    let r: { ok: boolean; error?: string } = { ok: false };
    await act(async () => {
      r = await result.current.saveMetadata({ metadata: { notes: "n2" } });
    });

    expect(r.ok).toBe(true);
    expect(result.current.dataSource).toEqual(updated);
    expect(mockApiClient.dataSources.update).toHaveBeenCalledWith("ds_1", {
      metadata: { notes: "n2" },
    });
  });

  it("saveMetadata returns ApiHttpError", async () => {
    vi.mocked(mockApiClient.dataSources.get).mockResolvedValueOnce(baseDS);
    vi.mocked(mockApiClient.dataSources.update).mockRejectedValueOnce(
      new ApiHttpError(400, { error: "bad" }, "Bad Request")
    );

    const { result } = renderHook(() => useDataSourceDetailViewModel("ds_1"));

    await waitFor(() => expect(result.current.loading).toBe(false));

    let r: { ok: boolean; error?: string } = { ok: true };
    await act(async () => {
      r = await result.current.saveMetadata({ metadata: { notes: "n2" } });
    });

    expect(r).toEqual({ ok: false, error: "bad" });
  });

  it("saveLanes updates lane_ids on success", async () => {
    const newLanes: LaneId[] = ["lane_work", "lane_life"];
    vi.mocked(mockApiClient.dataSources.get).mockResolvedValueOnce(baseDS);
    vi.mocked(mockApiClient.dataSources.setLanes).mockResolvedValueOnce({
      data_source_id: "ds_1",
      lane_ids: newLanes,
    });

    const { result } = renderHook(() => useDataSourceDetailViewModel("ds_1"));

    await waitFor(() => expect(result.current.loading).toBe(false));

    let r: { ok: boolean; error?: string } = { ok: false };
    await act(async () => {
      r = await result.current.saveLanes(newLanes);
    });

    expect(r.ok).toBe(true);
    expect(result.current.dataSource?.lane_ids).toEqual(newLanes);
    expect(mockApiClient.dataSources.setLanes).toHaveBeenCalledWith("ds_1", {
      lane_ids: newLanes,
    });
  });

  it("saveLanes returns ApiHttpError", async () => {
    vi.mocked(mockApiClient.dataSources.get).mockResolvedValueOnce(baseDS);
    vi.mocked(mockApiClient.dataSources.setLanes).mockRejectedValueOnce(
      new ApiHttpError(400, { error: "invalid lane" }, "Bad Request")
    );

    const { result } = renderHook(() => useDataSourceDetailViewModel("ds_1"));

    await waitFor(() => expect(result.current.loading).toBe(false));

    let r: { ok: boolean; error?: string } = { ok: true };
    await act(async () => {
      r = await result.current.saveLanes(["invalid" as LaneId]);
    });

    expect(r).toEqual({ ok: false, error: "invalid lane" });
  });

  it("refetch re-runs the GET", async () => {
    vi.mocked(mockApiClient.dataSources.get).mockResolvedValue(baseDS);

    const { result } = renderHook(() => useDataSourceDetailViewModel("ds_1"));

    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => {
      await result.current.refetch();
    });

    expect(mockApiClient.dataSources.get).toHaveBeenCalledTimes(2);
  });
});
