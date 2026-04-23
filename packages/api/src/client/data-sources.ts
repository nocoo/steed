import type {
  DataSourceListItem,
  DataSourceWithLanes,
  UpdateDataSourceRequest,
  SetLanesRequest,
  SetLanesResponse,
} from "@steed/shared";
import type { HttpClient } from "./http";

export interface DataSourceListQuery {
  host_id?: string;
  lane_id?: string;
  status?: string;
  limit?: number;
  cursor?: string;
}

export interface DataSourceListResponse {
  data: DataSourceListItem[];
  next_cursor: string | null;
}

export interface DataSourcesEndpoint {
  list(query?: DataSourceListQuery): Promise<DataSourceListResponse>;
  get(id: string): Promise<DataSourceWithLanes>;
  update(id: string, body: UpdateDataSourceRequest): Promise<DataSourceWithLanes>;
  setLanes(id: string, body: SetLanesRequest): Promise<SetLanesResponse>;
}

export function createDataSourcesEndpoint(http: HttpClient): DataSourcesEndpoint {
  return {
    list: (query) => {
      const params = new URLSearchParams();
      if (query?.host_id) params.set("host_id", query.host_id);
      if (query?.lane_id) params.set("lane_id", query.lane_id);
      if (query?.status) params.set("status", query.status);
      if (query?.limit) params.set("limit", String(query.limit));
      if (query?.cursor) params.set("cursor", query.cursor);
      const queryStr = params.toString();
      return http.get<DataSourceListResponse>(
        `/api/data-sources${queryStr ? `?${queryStr}` : ""}`
      );
    },
    get: (id) => http.get<DataSourceWithLanes>(`/api/data-sources/${id}`),
    update: (id, body) =>
      http.patch<DataSourceWithLanes>(`/api/data-sources/${id}`, body),
    setLanes: (id, body) =>
      http.put<SetLanesResponse>(`/api/data-sources/${id}/lanes`, body),
  };
}
