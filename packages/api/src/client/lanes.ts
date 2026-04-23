import type { Lane } from "@steed/shared";
import type { HttpClient } from "./http";

export interface LanesEndpoint {
  list(): Promise<Lane[]>;
}

export function createLanesEndpoint(http: HttpClient): LanesEndpoint {
  return {
    list: async () => {
      const res = await http.get<{ data: Lane[] }>("/api/lanes");
      return res.data;
    },
  };
}
