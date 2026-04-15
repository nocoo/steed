"use client";

import { useState, useEffect, useCallback } from "react";
import type { Overview } from "@steed/shared";

interface OverviewViewModelState {
  data: Overview | null;
  loading: boolean;
  error: string | null;
}

export function useOverviewViewModel() {
  const [state, setState] = useState<OverviewViewModelState>({
    data: null,
    loading: true,
    error: null,
  });

  const fetchOverview = useCallback(async () => {
    setState((prev) => ({ ...prev, loading: true, error: null }));
    try {
      const res = await fetch("/api/overview");
      if (!res.ok) {
        throw new Error("Failed to fetch overview");
      }
      const data = (await res.json()) as Overview;
      setState({ data, loading: false, error: null });
    } catch (err) {
      setState({
        data: null,
        loading: false,
        error: err instanceof Error ? err.message : "Unknown error",
      });
    }
  }, []);

  useEffect(() => {
    void fetchOverview();
  }, [fetchOverview]);

  return {
    ...state,
    refetch: fetchOverview,
  };
}
