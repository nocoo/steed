"use client";

import { useState, useEffect, useCallback } from "react";
import type { Agent, UpdateAgentRequest } from "@steed/shared";

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
  const [state, setState] = useState<AgentDetailState>({
    agent: null,
    loading: true,
    error: null,
  });

  const fetchAgent = useCallback(async () => {
    setState((prev) => ({ ...prev, loading: true, error: null }));
    try {
      const res = await fetch(`/api/agents/${id}`);
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(body.error ?? `Failed to fetch agent (${res.status})`);
      }
      const agent = (await res.json()) as Agent;
      setState({ agent, loading: false, error: null });
    } catch (err) {
      setState((prev) => ({
        ...prev,
        loading: false,
        error: err instanceof Error ? err.message : "Unknown error",
      }));
    }
  }, [id]);

  const save = useCallback(
    async (patch: UpdateAgentRequest): Promise<SaveResult> => {
      try {
        const res = await fetch(`/api/agents/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as {
            error?: string;
          };
          return {
            ok: false,
            error: body.error ?? `Save failed (${res.status})`,
          };
        }
        const updated = (await res.json()) as Agent;
        setState({ agent: updated, loading: false, error: null });
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
    void fetchAgent();
  }, [fetchAgent]);

  return {
    ...state,
    refetch: fetchAgent,
    save,
  };
}
