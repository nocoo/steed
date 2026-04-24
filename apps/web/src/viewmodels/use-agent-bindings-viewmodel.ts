import { useState, useEffect, useCallback, useMemo } from "react";
import type { Binding, DataSourceListItem } from "@steed/shared";
import { useApiClient } from "@/contexts/api-client";
import { ApiHttpError } from "@steed/api/client";

interface AgentBindingsState {
  bindings: Binding[];
  hostDataSources: DataSourceListItem[];
  loadingBindings: boolean;
  loadingCandidates: boolean;
  error: string | null;
}

export interface ActionResult {
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

export function useAgentBindingsViewModel(agentId: string, hostId?: string) {
  const apiClient = useApiClient();
  const [state, setState] = useState<AgentBindingsState>({
    bindings: [],
    hostDataSources: [],
    loadingBindings: true,
    loadingCandidates: false,
    error: null,
  });

  const fetchBindings = useCallback(async () => {
    setState((prev) => ({ ...prev, loadingBindings: true, error: null }));
    try {
      const result = await apiClient.bindings.list({ agent_id: agentId });
      setState((prev) => ({
        ...prev,
        bindings: result.data,
        loadingBindings: false,
      }));
    } catch (err) {
      setState((prev) => ({
        ...prev,
        loadingBindings: false,
        error: extractError(err),
      }));
    }
  }, [agentId, apiClient]);

  const ensureHostDataSources = useCallback(async () => {
    if (!hostId) return;
    setState((prev) => ({ ...prev, loadingCandidates: true }));
    try {
      const result = await apiClient.dataSources.list({
        host_id: hostId,
        limit: 200,
      });
      setState((prev) => ({
        ...prev,
        hostDataSources: result.data,
        loadingCandidates: false,
      }));
    } catch (err) {
      setState((prev) => ({
        ...prev,
        loadingCandidates: false,
        error: extractError(err),
      }));
    }
  }, [hostId, apiClient]);

  const addBinding = useCallback(
    async (dataSourceId: string): Promise<ActionResult> => {
      try {
        await apiClient.bindings.create({
          agent_id: agentId,
          data_source_id: dataSourceId,
        });
        await fetchBindings();
        return { ok: true };
      } catch (err) {
        return { ok: false, error: extractError(err) };
      }
    },
    [agentId, apiClient, fetchBindings]
  );

  const removeBinding = useCallback(
    async (dataSourceId: string): Promise<ActionResult> => {
      try {
        await apiClient.bindings.delete(agentId, dataSourceId);
        await fetchBindings();
        return { ok: true };
      } catch (err) {
        return { ok: false, error: extractError(err) };
      }
    },
    [agentId, apiClient, fetchBindings]
  );

  useEffect(() => {
    void fetchBindings();
  }, [fetchBindings]);

  const candidateDataSources = useMemo(() => {
    const bound = new Set(state.bindings.map((b) => b.data_source_id));
    return state.hostDataSources.filter((ds) => !bound.has(ds.id));
  }, [state.bindings, state.hostDataSources]);

  return {
    ...state,
    candidateDataSources,
    refetchBindings: fetchBindings,
    ensureHostDataSources,
    addBinding,
    removeBinding,
  };
}
