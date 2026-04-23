import type { Overview } from "@steed/shared";
import type { HttpClient } from "./http";

export interface OverviewEndpoint {
  get(): Promise<Overview>;
}

export function createOverviewEndpoint(http: HttpClient): OverviewEndpoint {
  return {
    get: () => http.get<Overview>("/api/overview"),
  };
}
