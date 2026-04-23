import type {
  AgentListItem,
  Binding,
  DataSourceWithLanes,
  HostWithStatus,
  Lane,
} from "@steed/shared";
import type { MapGraph } from "../shared/lane-map";
import type { HttpClient } from "./http";

export interface MapPayload {
  hosts: HostWithStatus[];
  agents: AgentListItem[];
  data_sources: DataSourceWithLanes[];
  bindings: Binding[];
  lanes: Lane[];
  graph: MapGraph;
}

export interface MapEndpoint {
  get(): Promise<MapPayload>;
}

export function createMapEndpoint(http: HttpClient): MapEndpoint {
  return {
    get: () => http.get<MapPayload>("/api/map"),
  };
}
