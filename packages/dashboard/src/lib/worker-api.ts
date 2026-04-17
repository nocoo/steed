import "server-only"; // Next.js will error if imported from client

import type {
  HostWithStatus,
  AgentListItem,
  DataSourceListItem,
  Lane,
  Overview,
  RegisterHostResponse,
} from "@steed/shared";

function getRequiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

// Fail fast: throw immediately if env vars are missing (at module load time)
const WORKER_API_URL = getRequiredEnv("WORKER_API_URL");
const DASHBOARD_SERVICE_TOKEN = getRequiredEnv("DASHBOARD_SERVICE_TOKEN");

/**
 * Get the Worker API URL from environment.
 * Exposed for CLI auth endpoint to pass to CLI.
 */
export function getWorkerApiUrl(): string {
  return WORKER_API_URL;
}

async function workerFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${WORKER_API_URL}${path}`, {
    ...init,
    headers: {
      ...init?.headers,
      Authorization: `Bearer ${DASHBOARD_SERVICE_TOKEN}`,
      "Content-Type": "application/json",
    },
  });

  if (!res.ok) {
    const error = await res
      .json()
      .catch(() => ({ error: { message: res.statusText } }));
    throw new Error(
      (error as { error?: { message?: string } }).error?.message ??
        `Worker API error: ${res.status}`
    );
  }

  return res.json() as Promise<T>;
}

export const workerApi = {
  overview: {
    get: () => workerFetch<Overview>("/api/v1/overview"),
  },
  hosts: {
    // GET /hosts returns HostWithStatus[] directly (no pagination wrapper)
    list: () => workerFetch<HostWithStatus[]>("/api/v1/hosts"),
    get: (id: string) => workerFetch<HostWithStatus>(`/api/v1/hosts/${id}`),
    // POST /hosts/register creates a new host and returns api_key
    register: (name: string) =>
      workerFetch<RegisterHostResponse>("/api/v1/hosts/register", {
        method: "POST",
        body: JSON.stringify({ name }),
      }),
  },
  agents: {
    // GET /agents returns { data, next_cursor } pagination wrapper
    list: (params?: {
      host_id?: string;
      lane_id?: string;
      status?: string;
      limit?: number;
      cursor?: string;
    }) => {
      const searchParams = new URLSearchParams();
      if (params?.host_id) searchParams.set("host_id", params.host_id);
      if (params?.lane_id) searchParams.set("lane_id", params.lane_id);
      if (params?.status) searchParams.set("status", params.status);
      if (params?.limit) searchParams.set("limit", String(params.limit));
      if (params?.cursor) searchParams.set("cursor", params.cursor);
      const query = searchParams.toString();
      return workerFetch<{ data: AgentListItem[]; next_cursor: string | null }>(
        `/api/v1/agents${query ? `?${query}` : ""}`
      );
    },
  },
  dataSources: {
    // GET /data-sources returns { data, next_cursor } pagination wrapper
    list: (params?: {
      host_id?: string;
      lane_id?: string;
      status?: string;
      limit?: number;
      cursor?: string;
    }) => {
      const searchParams = new URLSearchParams();
      if (params?.host_id) searchParams.set("host_id", params.host_id);
      if (params?.lane_id) searchParams.set("lane_id", params.lane_id);
      if (params?.status) searchParams.set("status", params.status);
      if (params?.limit) searchParams.set("limit", String(params.limit));
      if (params?.cursor) searchParams.set("cursor", params.cursor);
      const query = searchParams.toString();
      return workerFetch<{
        data: DataSourceListItem[];
        next_cursor: string | null;
      }>(`/api/v1/data-sources${query ? `?${query}` : ""}`);
    },
  },
  lanes: {
    // GET /lanes returns { data } wrapper (no pagination)
    list: () => workerFetch<{ data: Lane[] }>("/api/v1/lanes"),
  },
};
