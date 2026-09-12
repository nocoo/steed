import { z } from "zod";
import { diagramIdSchema, nodeSchema, edgeSchema, groupSchema, viewSchema, diagramSchema, removeDiagramNode, removeDiagramEdge, type Diagram } from "./diagram";

export const CONNECT_LIMITS = { operations: 100, tokensPerTarget: 50, readPerMinute: 120, writePerMinute: 30, managerPerMinute: 60, challengeSeconds: 60, revealSeconds: 30, receiptDays: 7, auditDays: 90 } as const;
export const connectScopeSchema = z.enum(["read", "write"]);
export const tokenNameSchema = z.string().trim().min(1).max(64).refine((name) => !/[\x00-\x1f\x7f]/.test(name) && !name.includes("steedc_"), "Use a printable name without credentials.");
export const tokenInputSchema = z.strictObject({
  name: tokenNameSchema,
  scope: connectScopeSchema,
  diagramId: diagramIdSchema.nullable().default(null),
  expiresAt: z.iso.datetime({ offset: true }).nullable().default(null),
});
export const sensitiveActionSchema = z.enum(["reveal", "rotate", "revoke"]);
export const idempotencyKeySchema = z.string().regex(/^[a-zA-Z0-9_-]{8,128}$/);
export type ConnectScope = z.infer<typeof connectScopeSchema>;
export type ConnectSensitiveAction = z.infer<typeof sensitiveActionSchema>;
export type ConnectTokenInput = z.infer<typeof tokenInputSchema>;
export interface ConnectTarget { id: string; title: string; deleted: boolean }
export interface ConnectToken {
  id: string;
  diagramId: string | null;
  name: string;
  scope: ConnectScope;
  prefix: string;
  createdAt: string;
  expiresAt: string | null;
  lastUsedAt: string | null;
  revokedAt: string | null;
  version: number;
}
export interface ConnectAudit {
  id: number;
  requestId: string;
  diagramId: string | null;
  tokenId: string | null;
  actor: string;
  operation: string;
  status: number;
  code: string | null;
  createdAt: string;
}
export interface MutationReceipt { id: string; revision: number; nodeCount: number; edgeCount: number; updatedAt: string }
export const ENTITY_SCHEMAS = { nodes: nodeSchema, edges: edgeSchema, groups: groupSchema, views: viewSchema } as const;
export type DiagramCollection = keyof typeof ENTITY_SCHEMAS;
export const diagramOperationSchema = z.discriminatedUnion("op", [
  z.strictObject({ op: z.literal("set_metadata"), title: diagramSchema.shape.title.optional(), description: diagramSchema.shape.description.unwrap().optional() }),
  z.strictObject({ op: z.literal("put_node"), value: nodeSchema }),
  z.strictObject({ op: z.literal("put_edge"), value: edgeSchema }),
  z.strictObject({ op: z.literal("put_group"), value: groupSchema }),
  z.strictObject({ op: z.literal("put_view"), value: viewSchema }),
  z.strictObject({ op: z.literal("remove_node"), id: diagramIdSchema }),
  z.strictObject({ op: z.literal("remove_edge"), id: diagramIdSchema }),
  z.strictObject({ op: z.literal("remove_group"), id: diagramIdSchema }),
  z.strictObject({ op: z.literal("remove_view"), id: diagramIdSchema }),
]);
export const operationBatchSchema = z.strictObject({ operations: z.array(diagramOperationSchema).min(1).max(CONNECT_LIMITS.operations) });
export type DiagramOperation = z.infer<typeof diagramOperationSchema>;

function replace<T extends { id: string }>(items: T[], value: T): T[] {
  return items.some((item) => item.id === value.id) ? items.map((item) => item.id === value.id ? value : item) : [...items, value];
}

export function applyDiagramOperations(document: Diagram, operations: DiagramOperation[]): Diagram {
  let next = document;
  for (const operation of operations) {
    switch (operation.op) {
      case "set_metadata": next = { ...next, ...(operation.title === undefined ? {} : { title: operation.title }), ...(operation.description === undefined ? {} : { description: operation.description }) }; break;
      case "put_node": next = { ...next, nodes: replace(next.nodes, operation.value) }; break;
      case "put_edge": next = { ...next, edges: replace(next.edges, operation.value) }; break;
      case "put_group": next = { ...next, groups: replace(next.groups, operation.value) }; break;
      case "put_view": next = { ...next, views: replace(next.views, operation.value) }; break;
      case "remove_node": next = removeDiagramNode(next, operation.id); break;
      case "remove_edge": next = removeDiagramEdge(next, operation.id); break;
      case "remove_view": next = { ...next, views: next.views.filter((view) => view.id !== operation.id) }; break;
      case "remove_group": {
        const group = next.groups.find((group) => group.id === operation.id);
        if (group) next = {
          ...next,
          nodes: next.nodes.map((node) => node.groupId === group.id ? { ...node, groupId: group.parentId } : node),
          groups: next.groups.filter((item) => item.id !== group.id).map((item) => item.parentId === group.id ? { ...item, parentId: group.parentId } : item),
        };
        break;
      }
    }
  }
  return diagramSchema.parse(next);
}

export interface ConnectOperation {
  id: string;
  method: "GET" | "PUT" | "POST" | "DELETE";
  path: string;
  summary: string;
  write: boolean;
  mutates: boolean;
  dangerous?: boolean;
  collection?: DiagramCollection;
}
export const CONNECT_OPERATIONS: ConnectOperation[] = [
  { id: "capabilities", method: "GET", path: "/capabilities", summary: "Discover the current token and available operations", write: false, mutates: false },
  { id: "openapi", method: "GET", path: "/openapi.json", summary: "Read the OpenAPI 3.1 contract", write: false, mutates: false },
  { id: "requests.get", method: "GET", path: "/requests/{key}", summary: "Inspect this token's retry outcome", write: false, mutates: false },
  { id: "diagrams.list", method: "GET", path: "/diagrams", summary: "List diagrams allowed by this token", write: false, mutates: false },
  { id: "diagrams.get", method: "GET", path: "/diagrams/{diagramId}", summary: "Read a complete diagram and its ETag", write: false, mutates: false },
  { id: "diagrams.put", method: "PUT", path: "/diagrams/{diagramId}", summary: "Create or replace a complete diagram", write: true, mutates: true },
  { id: "diagrams.delete", method: "DELETE", path: "/diagrams/{diagramId}", summary: "Delete a diagram permanently from the workspace", write: true, mutates: true, dangerous: true },
  { id: "diagrams.export", method: "GET", path: "/diagrams/{diagramId}/export", summary: "Export the complete JSON source", write: false, mutates: false },
  { id: "diagrams.validate", method: "POST", path: "/diagrams/{diagramId}/validate", summary: "Validate source without changing the saved diagram", write: true, mutates: false },
  { id: "diagrams.operations", method: "POST", path: "/diagrams/{diagramId}/operations", summary: "Apply up to 100 graph operations atomically", write: true, mutates: true },
];
for (const collection of Object.keys(ENTITY_SCHEMAS) as DiagramCollection[]) {
  CONNECT_OPERATIONS.push(
    { id: `${collection}.list`, method: "GET", path: `/diagrams/{diagramId}/${collection}`, summary: `List ${collection} in stable ID order`, write: false, mutates: false, collection },
    { id: `${collection}.get`, method: "GET", path: `/diagrams/{diagramId}/${collection}/{entityId}`, summary: `Read one of the diagram's ${collection}`, write: false, mutates: false, collection },
    { id: `${collection}.put`, method: "PUT", path: `/diagrams/{diagramId}/${collection}/{entityId}`, summary: `Add or replace one of the diagram's ${collection}`, write: true, mutates: true, collection },
    { id: `${collection}.delete`, method: "DELETE", path: `/diagrams/{diagramId}/${collection}/{entityId}`, summary: `Remove one of the diagram's ${collection}`, write: true, mutates: true, dangerous: true, collection },
  );
}

export function matchConnectOperation(path: string, method: string) {
  for (const operation of CONNECT_OPERATIONS) {
    if (operation.method !== (method === "HEAD" ? "GET" : method)) continue;
    const names = [...operation.path.matchAll(/\{(\w+)\}/g)].map((match) => match[1] ?? "");
    const pattern = operation.path.replaceAll(".", "\\.").replace(/\{\w+\}/g, "([^/]+)");
    const match = new RegExp(`^/api/v1${pattern}$`).exec(path);
    if (match) return { operation, params: Object.fromEntries(names.map((name, index) => [name, match[index + 1] ?? ""])) };
  }
  return null;
}
