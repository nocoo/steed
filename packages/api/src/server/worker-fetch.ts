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
  SetLanesRequest,
  SetLanesResponse,
  UpdateAgentRequest,
  UpdateDataSourceRequest,
} from "@steed/shared";
import { WorkerApiError } from "./errors";
import type { ApiEnv } from "./context";

async function workerFetch<T>(
  env: ApiEnv,
  path: string,
  init?: RequestInit
): Promise<T> {
  const res = await fetch(`${env.WORKER_API_URL}${path}`, {
    ...init,
    headers: {
      ...init?.headers,
      Authorization: `Bearer ${env.DASHBOARD_SERVICE_TOKEN}`,
      "Content-Type": "application/json",
    },
  });

  if (!res.ok) {
    const error = await res
      .json()
      .catch(() => ({ error: { message: res.statusText } }));
    throw new WorkerApiError(
      res.status,
      error,
      (error as { error?: { message?: string } }).error?.message ??
        `Worker API error: ${res.status}`
    );
  }

  return res.json() as Promise<T>;
}

async function workerFetchVoid(
  env: ApiEnv,
  path: string,
  init?: RequestInit
): Promise<void> {
  const res = await fetch(`${env.WORKER_API_URL}${path}`, {
    ...init,
    headers: {
      ...init?.headers,
      Authorization: `Bearer ${env.DASHBOARD_SERVICE_TOKEN}`,
      "Content-Type": "application/json",
    },
  });

  if (!res.ok) {
    const error = await res
      .json()
      .catch(() => ({ error: { message: res.statusText } }));
    throw new WorkerApiError(
      res.status,
      error,
      (error as { error?: { message?: string } }).error?.message ??
        `Worker API error: ${res.status}`
    );
  }
}

export interface WorkerClient {
  overview: {
    get: () => Promise<Overview>;
  };
  hosts: {
    list: () => Promise<HostWithStatus[]>;
  };
  agents: {
    list: (params?: {
      host_id?: string;
      lane_id?: string;
      status?: string;
      limit?: number;
      cursor?: string;
    }) => Promise<{ data: AgentListItem[]; next_cursor: string | null }>;
    get: (id: string) => Promise<Agent>;
    update: (id: string, body: UpdateAgentRequest) => Promise<Agent>;
  };
  dataSources: {
    list: (params?: {
      host_id?: string;
      lane_id?: string;
      status?: string;
      limit?: number;
      cursor?: string;
    }) => Promise<{ data: DataSourceListItem[]; next_cursor: string | null }>;
    get: (id: string) => Promise<DataSourceWithLanes>;
    update: (
      id: string,
      body: UpdateDataSourceRequest
    ) => Promise<DataSourceWithLanes>;
    setLanes: (id: string, body: SetLanesRequest) => Promise<SetLanesResponse>;
  };
  lanes: {
    list: () => Promise<{ data: Lane[] }>;
  };
  bindings: {
    list: (params?: {
      agent_id?: string;
      data_source_id?: string;
      limit?: number;
      cursor?: string;
    }) => Promise<{ data: Binding[]; next_cursor: string | null }>;
    create: (body: CreateBindingRequest) => Promise<Binding>;
    delete: (agentId: string, dataSourceId: string) => Promise<void>;
  };
}

export function createWorkerClient(env: ApiEnv): WorkerClient {
  return {
    overview: {
      get: () => workerFetch<Overview>(env, "/api/v1/overview"),
    },
    hosts: {
      list: () => workerFetch<HostWithStatus[]>(env, "/api/v1/hosts"),
    },
    agents: {
      list: (params) => {
        const searchParams = new URLSearchParams();
        if (params?.host_id) searchParams.set("host_id", params.host_id);
        if (params?.lane_id) searchParams.set("lane_id", params.lane_id);
        if (params?.status) searchParams.set("status", params.status);
        if (params?.limit) searchParams.set("limit", String(params.limit));
        if (params?.cursor) searchParams.set("cursor", params.cursor);
        const query = searchParams.toString();
        return workerFetch<{ data: AgentListItem[]; next_cursor: string | null }>(
          env,
          `/api/v1/agents${query ? `?${query}` : ""}`
        );
      },
      get: (id) => workerFetch<Agent>(env, `/api/v1/agents/${id}`),
      update: (id, body) =>
        workerFetch<Agent>(env, `/api/v1/agents/${id}`, {
          method: "PATCH",
          body: JSON.stringify(body),
        }),
    },
    dataSources: {
      list: (params) => {
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
        }>(env, `/api/v1/data-sources${query ? `?${query}` : ""}`);
      },
      get: (id) =>
        workerFetch<DataSourceWithLanes>(env, `/api/v1/data-sources/${id}`),
      update: (id, body) =>
        workerFetch<DataSourceWithLanes>(env, `/api/v1/data-sources/${id}`, {
          method: "PATCH",
          body: JSON.stringify(body),
        }),
      setLanes: (id, body) =>
        workerFetch<SetLanesResponse>(env, `/api/v1/data-sources/${id}/lanes`, {
          method: "PUT",
          body: JSON.stringify(body),
        }),
    },
    lanes: {
      list: () => workerFetch<{ data: Lane[] }>(env, "/api/v1/lanes"),
    },
    bindings: {
      list: (params) => {
        const searchParams = new URLSearchParams();
        if (params?.agent_id) searchParams.set("agent_id", params.agent_id);
        if (params?.data_source_id)
          searchParams.set("data_source_id", params.data_source_id);
        if (params?.limit) searchParams.set("limit", String(params.limit));
        if (params?.cursor) searchParams.set("cursor", params.cursor);
        const query = searchParams.toString();
        return workerFetch<{ data: Binding[]; next_cursor: string | null }>(
          env,
          `/api/v1/bindings${query ? `?${query}` : ""}`
        );
      },
      create: (body) =>
        workerFetch<Binding>(env, "/api/v1/bindings", {
          method: "POST",
          body: JSON.stringify(body),
        }),
      delete: (agentId, dataSourceId) =>
        workerFetchVoid(env, `/api/v1/bindings/${agentId}/${dataSourceId}`, {
          method: "DELETE",
        }),
    },
  };
}
