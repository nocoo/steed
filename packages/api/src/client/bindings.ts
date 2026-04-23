import type { Binding, CreateBindingRequest } from "@steed/shared";
import type { HttpClient } from "./http";

export interface BindingListQuery {
  agent_id?: string;
  data_source_id?: string;
  limit?: number;
  cursor?: string;
}

export interface BindingListResponse {
  data: Binding[];
  next_cursor: string | null;
}

export interface BindingsEndpoint {
  list(query?: BindingListQuery): Promise<BindingListResponse>;
  create(body: CreateBindingRequest): Promise<Binding>;
  delete(agentId: string, dataSourceId: string): Promise<void>;
}

export function createBindingsEndpoint(http: HttpClient): BindingsEndpoint {
  return {
    list: (query) => {
      const params = new URLSearchParams();
      if (query?.agent_id) params.set("agent_id", query.agent_id);
      if (query?.data_source_id) params.set("data_source_id", query.data_source_id);
      if (query?.limit) params.set("limit", String(query.limit));
      if (query?.cursor) params.set("cursor", query.cursor);
      const queryStr = params.toString();
      return http.get<BindingListResponse>(
        `/api/bindings${queryStr ? `?${queryStr}` : ""}`
      );
    },
    create: (body) => http.post<Binding>("/api/bindings", body),
    delete: (agentId, dataSourceId) =>
      http.delete(`/api/bindings/${agentId}/${dataSourceId}`),
  };
}
