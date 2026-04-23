"use client";

import { useState, useEffect, useCallback } from "react";
import type { HostWithStatus } from "@steed/shared";

interface HostsViewModelState {
  hosts: HostWithStatus[];
  loading: boolean;
  error: string | null;
}

export function useHostsViewModel() {
  const [state, setState] = useState<HostsViewModelState>({
    hosts: [],
    loading: true,
    error: null,
  });

  const fetchHosts = useCallback(async () => {
    setState((prev) => ({ ...prev, loading: true, error: null }));
    try {
      const res = await fetch("/api/hosts");
      if (!res.ok) {
        throw new Error("Failed to fetch hosts");
      }
      // BFF returns HostWithStatus[] directly
      const hosts = (await res.json()) as HostWithStatus[];
      setState({ hosts, loading: false, error: null });
    } catch (err) {
      setState({
        hosts: [],
        loading: false,
        error: err instanceof Error ? err.message : "Unknown error",
      });
    }
  }, []);

  useEffect(() => {
    void fetchHosts();
  }, [fetchHosts]);

  return {
    ...state,
    refetch: fetchHosts,
  };
}
