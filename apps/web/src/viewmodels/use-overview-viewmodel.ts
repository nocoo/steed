import { useState, useEffect, useCallback } from "react";
import type { Overview } from "@steed/shared";
import { useApiClient } from "@/contexts/api-client";

interface OverviewViewModelState {
  data: Overview | null;
  loading: boolean;
  error: string | null;
}

export function useOverviewViewModel() {
  const apiClient = useApiClient();
  const [state, setState] = useState<OverviewViewModelState>({
    data: null,
    loading: true,
    error: null,
  });

  const fetchOverview = useCallback(async () => {
    setState((prev) => ({ ...prev, loading: true, error: null }));
    try {
      const data = await apiClient.overview.get();
      setState({ data, loading: false, error: null });
    } catch (err) {
      setState({
        data: null,
        loading: false,
        error: err instanceof Error ? err.message : "Unknown error",
      });
    }
  }, [apiClient]);

  useEffect(() => {
    void fetchOverview();
  }, [fetchOverview]);

  return {
    ...state,
    refetch: fetchOverview,
  };
}
