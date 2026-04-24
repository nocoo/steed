import { useState, useEffect, useCallback } from "react";
import type { HostWithStatus } from "@steed/shared";
import { useApiClient } from "@/contexts/api-client";

interface HostsViewModelState {
  hosts: HostWithStatus[];
  loading: boolean;
  error: string | null;
}

export function useHostsViewModel() {
  const apiClient = useApiClient();
  const [state, setState] = useState<HostsViewModelState>({
    hosts: [],
    loading: true,
    error: null,
  });

  const fetchHosts = useCallback(async () => {
    setState((prev) => ({ ...prev, loading: true, error: null }));
    try {
      const hosts = await apiClient.hosts.list();
      setState({ hosts, loading: false, error: null });
    } catch (err) {
      setState({
        hosts: [],
        loading: false,
        error: err instanceof Error ? err.message : "Unknown error",
      });
    }
  }, [apiClient]);

  useEffect(() => {
    void fetchHosts();
  }, [fetchHosts]);

  return {
    ...state,
    refetch: fetchHosts,
  };
}
