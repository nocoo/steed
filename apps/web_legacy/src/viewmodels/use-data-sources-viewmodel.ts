"use client";

import { useState, useEffect, useCallback } from "react";
import type { DataSourceListItem } from "@steed/shared";

interface DataSourcesViewModelState {
  dataSources: DataSourceListItem[];
  loading: boolean;
  error: string | null;
  hasMore: boolean;
  nextCursor: string | null;
}

export function useDataSourcesViewModel() {
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
      const params = new URLSearchParams();
      if (cursor) params.set("cursor", cursor);
      params.set("limit", "50");

      const res = await fetch(`/api/data-sources?${params}`);
      if (!res.ok) {
        throw new Error("Failed to fetch data sources");
      }
      const result = (await res.json()) as {
        data: DataSourceListItem[];
        next_cursor: string | null;
      };
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
  }, []);

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
