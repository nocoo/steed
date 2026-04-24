import { useState, useEffect, useCallback } from "react";
import type { DataSourceListItem } from "@steed/shared";
import { useApiClient } from "@/contexts/api-client";

interface DataSourcesViewModelState {
  dataSources: DataSourceListItem[];
  loading: boolean;
  error: string | null;
  hasMore: boolean;
  nextCursor: string | null;
}

export function useDataSourcesViewModel() {
  const apiClient = useApiClient();
  const [state, setState] = useState<DataSourcesViewModelState>({
    dataSources: [],
    loading: true,
    error: null,
    hasMore: false,
    nextCursor: null,
  });

  const fetchDataSources = useCallback(async (cursor?: string) => {
    setState((prev) => ({ ...prev, loading: true, error: null }));
    try {
      const result = await apiClient.dataSources.list({
        cursor,
        limit: 50,
      });
      setState((prev) => ({
        dataSources: cursor
          ? [...prev.dataSources, ...result.data]
          : result.data,
        loading: false,
        error: null,
        hasMore: result.next_cursor !== null,
        nextCursor: result.next_cursor,
      }));
    } catch (err) {
      setState((prev) => ({
        ...prev,
        loading: false,
        error: err instanceof Error ? err.message : "Unknown error",
      }));
    }
  }, [apiClient]);

  const loadMore = useCallback(() => {
    if (state.nextCursor && !state.loading) {
      void fetchDataSources(state.nextCursor);
    }
  }, [state.nextCursor, state.loading, fetchDataSources]);

  useEffect(() => {
    void fetchDataSources();
  }, [fetchDataSources]);

  return {
    ...state,
    refetch: () => fetchDataSources(),
    loadMore,
  };
}
