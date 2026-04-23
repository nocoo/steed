import type { HostWithStatus } from "@steed/shared";
import type { HttpClient } from "./http";

export interface HostsEndpoint {
  list(): Promise<HostWithStatus[]>;
}

export function createHostsEndpoint(http: HttpClient): HostsEndpoint {
  return {
    list: () => http.get<HostWithStatus[]>("/api/hosts"),
  };
}
