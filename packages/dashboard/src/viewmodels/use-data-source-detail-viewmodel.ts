"use client";

import { useState, useEffect, useCallback } from "react";
import type {
  DataSourceWithLanes,
  LaneId,
  UpdateDataSourceRequest,
} from "@steed/shared";

interface DataSourceDetailState {
  dataSource: DataSourceWithLanes | null;
  loading: boolean;
  error: string | null;
}

export interface SaveResult {
  ok: boolean;
  error?: string;
}

async function readError(res: Response, fallback: string): Promise<string> {
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  return body.error ?? fallback;
}

export function useDataSourceDetailViewModel(id: string) {
  const [state, setState] = useState<DataSourceDetailState>({
    dataSource: null,
    loading: true,
    error: null,
  });

  const fetchDataSource = useCallback(async () => {
    setState((prev) => ({ ...prev, loading: true, error: null }));
    try {
      const res = await fetch(`/api/data-sources/${id}`);
      if (!res.ok) {
        throw new Error(
          await readError(res, `Failed to fetch data source (${res.status})`)
        );
      }
      const dataSource = (await res.json()) as DataSourceWithLanes;
      setState({ dataSource, loading: false, error: null });
    } catch (err) {
      setState((prev) => ({
        ...prev,
        loading: false,
        error: err instanceof Error ? err.message : "Unknown error",
      }));
    }
  }, [id]);

  const saveMetadata = useCallback(
    async (patch: UpdateDataSourceRequest): Promise<SaveResult> => {
      try {
        const res = await fetch(`/api/data-sources/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch),
        });
        if (!res.ok) {
          return {
            ok: false,
            error: await readError(res, `Save failed (${res.status})`),
          };
        }
        const updated = (await res.json()) as DataSourceWithLanes;
        setState({ dataSource: updated, loading: false, error: null });
        return { ok: true };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : "Unknown error",
        };
      }
    },
    [id]
  );

  const saveLanes = useCallback(
    async (lane_ids: LaneId[]): Promise<SaveResult> => {
      try {
        const res = await fetch(`/api/data-sources/${id}/lanes`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ lane_ids }),
        });
        if (!res.ok) {
          return {
            ok: false,
            error: await readError(res, `Save failed (${res.status})`),
          };
        }
        const result = (await res.json()) as {
          data_source_id: string;
          lane_ids: LaneId[];
        };
        setState((prev) =>
          prev.dataSource
            ? {
                ...prev,
                dataSource: {
                  ...prev.dataSource,
                  lane_ids: result.lane_ids,
                },
              }
            : prev
        );
        return { ok: true };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : "Unknown error",
        };
      }
    },
    [id]
  );

  useEffect(() => {
    void fetchDataSource();
  }, [fetchDataSource]);

  return {
    ...state,
    refetch: fetchDataSource,
    saveMetadata,
    saveLanes,
  };
}
