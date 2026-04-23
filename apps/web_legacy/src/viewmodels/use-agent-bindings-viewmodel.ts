"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import type { Binding, DataSourceListItem } from "@steed/shared";

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

async function readError(res: Response, fallback: string): Promise<string> {
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  return body.error ?? fallback;
}

/**
 * Bindings + candidate data sources for a single agent.
 *
 * Two independent fetches:
 *   - GET /api/bindings?agent_id=…  (always)
 *   - GET /api/data-sources?host_id=…  (lazy: call ensureHostDataSources())
 *
 * candidateDataSources = host data sources minus already-bound ids.
 */
export function useAgentBindingsViewModel(agentId: string, hostId?: string) {
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
      const res = await fetch(`/api/bindings?agent_id=${agentId}`);
      if (!res.ok) {
        throw new Error(
          await readError(res, `Failed to fetch bindings (${res.status})`)
        );
      }
      const result = (await res.json()) as {
        data: Binding[];
        next_cursor: string | null;
      };
      setState((prev) => ({
        ...prev,
        bindings: result.data,
        loadingBindings: false,
      }));
    } catch (err) {
      setState((prev) => ({
        ...prev,
        loadingBindings: false,
        error: err instanceof Error ? err.message : "Unknown error",
      }));
    }
  }, [agentId]);

  const ensureHostDataSources = useCallback(async () => {
    if (!hostId) return;
    setState((prev) => ({ ...prev, loadingCandidates: true }));
    try {
      const res = await fetch(`/api/data-sources?host_id=${hostId}&limit=200`);
      if (!res.ok) {
        throw new Error(
          await readError(res, `Failed to fetch data sources (${res.status})`)
        );
      }
      const result = (await res.json()) as {
        data: DataSourceListItem[];
        next_cursor: string | null;
      };
      setState((prev) => ({
        ...prev,
        hostDataSources: result.data,
        loadingCandidates: false,
      }));
    } catch (err) {
      setState((prev) => ({
        ...prev,
        loadingCandidates: false,
        error: err instanceof Error ? err.message : "Unknown error",
      }));
    }
  }, [hostId]);

  const addBinding = useCallback(
    async (dataSourceId: string): Promise<ActionResult> => {
      try {
        const res = await fetch(`/api/bindings`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            agent_id: agentId,
            data_source_id: dataSourceId,
          }),
        });
        if (!res.ok) {
          return {
            ok: false,
            error: await readError(res, `Add failed (${res.status})`),
          };
        }
        await fetchBindings();
        return { ok: true };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : "Unknown error",
        };
      }
    },
    [agentId, fetchBindings]
  );

  const removeBinding = useCallback(
    async (dataSourceId: string): Promise<ActionResult> => {
      try {
        const res = await fetch(
          `/api/bindings/${agentId}/${dataSourceId}`,
          { method: "DELETE" }
        );
        if (!res.ok) {
          return {
            ok: false,
            error: await readError(res, `Remove failed (${res.status})`),
          };
        }
        await fetchBindings();
        return { ok: true };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : "Unknown error",
        };
      }
    },
    [agentId, fetchBindings]
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
