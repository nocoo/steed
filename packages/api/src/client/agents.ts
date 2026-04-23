import type { Agent, AgentListItem, Binding, UpdateAgentRequest } from "@steed/shared";
import type { HttpClient } from "./http";

export interface AgentListQuery {
  host_id?: string;
  lane_id?: string;
  status?: string;
  limit?: number;
  cursor?: string;
}

export interface AgentListResponse {
  data: AgentListItem[];
  next_cursor: string | null;
}

export interface AgentsEndpoint {
  list(query?: AgentListQuery): Promise<AgentListResponse>;
  get(id: string): Promise<Agent>;
  update(id: string, body: UpdateAgentRequest): Promise<Agent>;
  listBindings(id: string): Promise<Binding[]>;
}

export function createAgentsEndpoint(http: HttpClient): AgentsEndpoint {
  return {
    list: (query) => {
      const params = new URLSearchParams();
      if (query?.host_id) params.set("host_id", query.host_id);
      if (query?.lane_id) params.set("lane_id", query.lane_id);
      if (query?.status) params.set("status", query.status);
      if (query?.limit) params.set("limit", String(query.limit));
      if (query?.cursor) params.set("cursor", query.cursor);
      const queryStr = params.toString();
      return http.get<AgentListResponse>(
        `/api/agents${queryStr ? `?${queryStr}` : ""}`
      );
    },
    get: (id) => http.get<Agent>(`/api/agents/${id}`),
    update: (id, body) => http.patch<Agent>(`/api/agents/${id}`, body),
    listBindings: async (id) => {
      const res = await http.get<{ data: Binding[]; next_cursor: string | null }>(
        `/api/bindings?agent_id=${id}`
      );
      return res.data;
    },
  };
}
