import { useState, useEffect, useCallback } from "react";
import type {
  DataSourceWithLanes,
  LaneId,
  UpdateDataSourceRequest,
} from "@steed/shared";
import { useApiClient } from "@/contexts/api-client";
import { ApiHttpError } from "@steed/api/client";

interface DataSourceDetailState {
  dataSource: DataSourceWithLanes | null;
  loading: boolean;
  error: string | null;
}

export interface SaveResult {
  ok: boolean;
  error?: string;
}

function extractError(err: unknown): string {
  if (err instanceof ApiHttpError) {
    const body = err.body as { error?: string } | undefined;
    return body?.error ?? err.message;
  }
  return err instanceof Error ? err.message : "Unknown error";
}

export function useDataSourceDetailViewModel(id: string) {
  const apiClient = useApiClient();
  const [state, setState] = useState<DataSourceDetailState>({
    dataSource: null,
    loading: true,
    error: null,
  });

  const fetchDataSource = useCallback(async () => {
    setState((prev) => ({ ...prev, loading: true, error: null }));
    try {
      const dataSource = await apiClient.dataSources.get(id);
      setState({ dataSource, loading: false, error: null });
    } catch (err) {
      setState((prev) => ({
        ...prev,
        loading: false,
        error: extractError(err),
      }));
    }
  }, [id, apiClient]);

  const saveMetadata = useCallback(
    async (patch: UpdateDataSourceRequest): Promise<SaveResult> => {
      try {
        const updated = await apiClient.dataSources.update(id, patch);
        setState({ dataSource: updated, loading: false, error: null });
        return { ok: true };
      } catch (err) {
        return { ok: false, error: extractError(err) };
      }
    },
    [id, apiClient]
  );

  const saveLanes = useCallback(
    async (lane_ids: LaneId[]): Promise<SaveResult> => {
      try {
        const result = await apiClient.dataSources.setLanes(id, { lane_ids });
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
        return { ok: false, error: extractError(err) };
      }
    },
    [id, apiClient]
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
