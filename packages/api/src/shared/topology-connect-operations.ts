import { TOPOLOGY_COLLECTIONS, type TopologyCollection } from "./topology-operations";

export interface TopologyConnectOperation {
  id: string;
  method: "GET" | "PUT" | "POST" | "DELETE";
  path: string;
  summary: string;
  write: boolean;
  mutates: boolean;
  dangerous?: boolean;
  collection?: TopologyCollection;
}

export const TOPOLOGY_CONNECT_OPERATIONS: TopologyConnectOperation[] = [
  { id: "capabilities", method: "GET", path: "/capabilities", summary: "Discover the current token and available operations", write: false, mutates: false },
  { id: "openapi", method: "GET", path: "/openapi.json", summary: "Read the OpenAPI contract", write: false, mutates: false },
  { id: "requests.get", method: "GET", path: "/requests/{key}", summary: "Inspect this token's retry outcome", write: false, mutates: false },
  { id: "topology.get", method: "GET", path: "/topology", summary: "Read the topology snapshot or delta", write: false, mutates: false },
  { id: "topology.put", method: "PUT", path: "/topology", summary: "Replace the topology", write: true, mutates: true },
  { id: "topology.validate", method: "POST", path: "/topology/validate", summary: "Validate a topology or operation batch without writing", write: true, mutates: false },
  { id: "topology.operations", method: "POST", path: "/topology/operations", summary: "Apply a batch of topology operations", write: true, mutates: true },
  { id: "changes.list", method: "GET", path: "/topology/changes", summary: "List topology changes", write: false, mutates: false },
  { id: "changes.get", method: "GET", path: "/topology/changes/{changeId}", summary: "Read a topology change and its images", write: false, mutates: false },
];

for (const collection of TOPOLOGY_COLLECTIONS) {
  TOPOLOGY_CONNECT_OPERATIONS.push(
    { id: `${collection}.list`, method: "GET", path: `/topology/${collection}`, summary: `List ${collection} in ID order`, write: false, mutates: false, collection },
    { id: `${collection}.get`, method: "GET", path: `/topology/${collection}/{entityId}`, summary: `Read one of the topology's ${collection}`, write: false, mutates: false, collection },
    { id: `${collection}.put`, method: "PUT", path: `/topology/${collection}/{entityId}`, summary: `Add or replace one of the topology's ${collection}`, write: true, mutates: true, collection },
    { id: `${collection}.delete`, method: "DELETE", path: `/topology/${collection}/{entityId}`, summary: `Remove one of the topology's ${collection}`, write: true, mutates: true, dangerous: true, collection },
  );
}

export function matchTopologyConnectOperation(path: string, method: string) {
  for (const operation of TOPOLOGY_CONNECT_OPERATIONS) {
    if (operation.method !== (method === "HEAD" ? "GET" : method)) continue;
    const names = [...operation.path.matchAll(/\{(\w+)\}/g)].map((match) => match[1] ?? "");
    const pattern = operation.path.replaceAll(".", "\\.").replace(/\{\w+\}/g, "([^/]+)");
    const match = new RegExp(`^/api/v1${pattern}$`).exec(path);
    if (match) return { operation, params: Object.fromEntries(names.map((name, index) => [name, match[index + 1] ?? ""])) };
  }
  return null;
}
