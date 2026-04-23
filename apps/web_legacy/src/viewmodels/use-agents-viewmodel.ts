"use client";

import { useState, useEffect, useCallback } from "react";
import type { AgentListItem } from "@steed/shared";

interface AgentsViewModelState {
  agents: AgentListItem[];
  loading: boolean;
  error: string | null;
  hasMore: boolean;
  nextCursor: string | null;
}

export function useAgentsViewModel() {
  const [state, setState] = useState<AgentsViewModelState>({
    agents: [],
    loading: true,
    error: null,
    hasMore: false,
    nextCursor: null,
  });

  const fetchAgents = useCallback(async (cursor?: string) => {
    setState((prev) => ({ ...prev, loading: true, error: null }));
    try {
      const params = new URLSearchParams();
      if (cursor) params.set("cursor", cursor);
      params.set("limit", "50");

      const res = await fetch(`/api/agents?${params}`);
      if (!res.ok) {
        throw new Error("Failed to fetch agents");
      }
      const result = (await res.json()) as {
        data: AgentListItem[];
        next_cursor: string | null;
      };
      setState((prev) => ({
        agents: cursor ? [...prev.agents, ...result.data] : result.data,
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
      void fetchAgents(state.nextCursor);
    }
  }, [state.nextCursor, state.loading, fetchAgents]);

  useEffect(() => {
    void fetchAgents();
  }, [fetchAgents]);

  return {
    ...state,
    refetch: () => fetchAgents(),
    loadMore,
  };
}
