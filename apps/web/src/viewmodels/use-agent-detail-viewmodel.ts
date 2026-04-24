import { useState, useEffect, useCallback } from "react";
import type { Agent, UpdateAgentRequest } from "@steed/shared";
import { useApiClient } from "@/contexts/api-client";
import { ApiHttpError } from "@steed/api/client";

interface AgentDetailState {
  agent: Agent | null;
  loading: boolean;
  error: string | null;
}

export interface SaveResult {
  ok: boolean;
  error?: string;
}

export function useAgentDetailViewModel(id: string) {
  const apiClient = useApiClient();
  const [state, setState] = useState<AgentDetailState>({
    agent: null,
    loading: true,
    error: null,
  });

  const fetchAgent = useCallback(async () => {
    setState((prev) => ({ ...prev, loading: true, error: null }));
    try {
      const agent = await apiClient.agents.get(id);
      setState({ agent, loading: false, error: null });
    } catch (err) {
      const message =
        err instanceof ApiHttpError
          ? (err.body as { error?: string })?.error ?? err.message
          : err instanceof Error
            ? err.message
            : "Unknown error";
      setState((prev) => ({
        ...prev,
        loading: false,
        error: message,
      }));
    }
  }, [id, apiClient]);

  const save = useCallback(
    async (patch: UpdateAgentRequest): Promise<SaveResult> => {
      try {
        const updated = await apiClient.agents.update(id, patch);
        setState({ agent: updated, loading: false, error: null });
        return { ok: true };
      } catch (err) {
        const message =
          err instanceof ApiHttpError
            ? (err.body as { error?: string })?.error ?? err.message
            : err instanceof Error
              ? err.message
              : "Unknown error";
        return { ok: false, error: message };
      }
    },
    [id, apiClient]
  );

  useEffect(() => {
    void fetchAgent();
  }, [fetchAgent]);

  return {
    ...state,
    refetch: fetchAgent,
    save,
  };
}
