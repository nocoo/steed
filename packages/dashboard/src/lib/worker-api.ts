import "server-only"; // Next.js will error if imported from client

import type {
  Agent,
  AgentListItem,
  Binding,
  CreateBindingRequest,
  DataSourceListItem,
  DataSourceWithLanes,
  HostWithStatus,
  Lane,
  Overview,
  RegisterHostResponse,
  SetLanesRequest,
  SetLanesResponse,
  UpdateAgentRequest,
  UpdateDataSourceRequest,
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

/**
 * Error thrown by workerFetch helpers when the Worker returns a
 * non-2xx response. Carries the original status so BFF route
 * handlers can pass meaningful codes (404, 409, ...) back to the
 * browser instead of collapsing everything to 500.
 */
export class WorkerApiError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "WorkerApiError";
    this.status = status;
  }
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
    throw new WorkerApiError(
      (error as { error?: { message?: string } }).error?.message ??
        `Worker API error: ${res.status}`,
      res.status
    );
  }

  return res.json() as Promise<T>;
}

async function workerFetchVoid(
  path: string,
  init?: RequestInit
): Promise<void> {
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
    throw new WorkerApiError(
      (error as { error?: { message?: string } }).error?.message ??
        `Worker API error: ${res.status}`,
      res.status
    );
  }
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
    get: (id: string) => workerFetch<Agent>(`/api/v1/agents/${id}`),
    update: (id: string, body: UpdateAgentRequest) =>
      workerFetch<Agent>(`/api/v1/agents/${id}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      }),
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
    get: (id: string) =>
      workerFetch<DataSourceWithLanes>(`/api/v1/data-sources/${id}`),
    update: (id: string, body: UpdateDataSourceRequest) =>
      workerFetch<DataSourceWithLanes>(`/api/v1/data-sources/${id}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      }),
    setLanes: (id: string, body: SetLanesRequest) =>
      workerFetch<SetLanesResponse>(`/api/v1/data-sources/${id}/lanes`, {
        method: "PUT",
        body: JSON.stringify(body),
      }),
  },
  lanes: {
    // GET /lanes returns { data } wrapper (no pagination)
    list: () => workerFetch<{ data: Lane[] }>("/api/v1/lanes"),
  },
  bindings: {
    list: (params?: {
      agent_id?: string;
      data_source_id?: string;
      limit?: number;
      cursor?: string;
    }) => {
      const searchParams = new URLSearchParams();
      if (params?.agent_id) searchParams.set("agent_id", params.agent_id);
      if (params?.data_source_id)
        searchParams.set("data_source_id", params.data_source_id);
      if (params?.limit) searchParams.set("limit", String(params.limit));
      if (params?.cursor) searchParams.set("cursor", params.cursor);
      const query = searchParams.toString();
      return workerFetch<{ data: Binding[]; next_cursor: string | null }>(
        `/api/v1/bindings${query ? `?${query}` : ""}`
      );
    },
    create: (body: CreateBindingRequest) =>
      workerFetch<Binding>("/api/v1/bindings", {
        method: "POST",
        body: JSON.stringify(body),
      }),
    delete: (agentId: string, dataSourceId: string) =>
      workerFetchVoid(
        `/api/v1/bindings/${agentId}/${dataSourceId}`,
        { method: "DELETE" }
      ),
  },
};
