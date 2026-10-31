import { z } from "zod";
import {
  CONNECT_LIMITS, TOPOLOGY_CONNECT_OPERATIONS, TOPOLOGY_LIMITS, idempotencyKeySchema,
  topologyBoundarySchema, topologyEdgeSchema, topologyIdSchema, topologyLayerSchema,
  topologyNodeSchema, topologyOperationBatchSchema, topologySchema, topologyTypeDefSchema, topologyViewSchema,
} from "@steed/api/shared";

const entitySchemas = {
  layers: topologyLayerSchema, types: topologyTypeDefSchema, boundaries: topologyBoundarySchema,
  nodes: topologyNodeSchema, edges: topologyEdgeSchema, views: topologyViewSchema,
};
const schema = (value: z.ZodType) => z.toJSONSchema(value, { target: "draft-2020-12", io: "input" });
const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const name = (collection: string) => collection[0]?.toUpperCase() + collection.slice(1);
const content = (value: unknown) => ({ "application/json": { schema: value } });
const envelope = (data: unknown, paging = false) => ({
  type: "object", required: ["data", "requestId", ...(paging ? ["nextCursor"] : [])],
  properties: { data, requestId: { type: "string" }, ...(paging ? { nextCursor: { type: ["string", "integer", "null"] } } : {}) },
});
const header = (name: string, required: boolean, value: unknown, description: string) => ({ name, in: "header", required, schema: value, description });
const query = (name: string, value: unknown) => ({ name, in: "query", schema: value });

export function topologyConnectOpenApi(origin: string) {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const operation of TOPOLOGY_CONNECT_OPERATIONS) {
    const parameters: unknown[] = [...operation.path.matchAll(/\{(\w+)\}/g)].map((match) => ({
      name: match[1], in: "path", required: true,
      schema: match[1] === "key" ? schema(idempotencyKeySchema) : match[1] === "changeId" ? { type: "integer", minimum: 1 } : schema(topologyIdSchema),
    }));
    if (operation.id === "topology.get" || operation.id === "changes.list") parameters.push(query("since", { type: "integer", minimum: 0 }));
    if (operation.id === "changes.list" || (operation.collection && operation.id.endsWith(".list"))) {
      parameters.push(query("limit", { type: "integer", minimum: 1, maximum: 500, default: 50 }), query("cursor", { type: operation.id === "changes.list" ? "integer" : "string" }));
    }
    if (operation.collection === "nodes" && operation.id.endsWith(".list")) for (const filter of ["layer", "type", "tag", "boundary", "parent"]) parameters.push(query(filter, { type: "string" }));
    if (operation.collection === "edges" && operation.id.endsWith(".list")) for (const filter of ["node", "kind"]) parameters.push(query(filter, { type: "string" }));
    if (operation.id === "topology.get" || (operation.id.startsWith("changes.") && !operation.mutates) || (operation.collection && !operation.mutates)) {
      parameters.push(header("If-None-Match", false, { type: "string" }, "Return 304 when the current ETag matches."));
    }
    if (operation.mutates) {
      parameters.push(header("If-Match", true, { type: "string" }, 'Current topology ETag, for example "topology:0".'),
        header("Idempotency-Key", true, schema(idempotencyKeySchema), "Use one persisted key per exact intent."),
        header("X-Steed-Confirm", Boolean(operation.dangerous), { const: "topology" }, "Required for removals, reverts and replacements that remove entities."));
    }
    const input = operation.id === "topology.put" ? ref("Topology") : operation.id === "topology.operations" ? ref("OperationBatch")
      : operation.id === "topology.validate" ? { oneOf: [ref("Topology"), ref("OperationBatch")] }
      : operation.method === "PUT" && operation.collection ? ref(name(operation.collection)) : undefined;
    const isPage = operation.id === "changes.list" || Boolean(operation.collection && operation.id.endsWith(".list"));
    let output: unknown = { type: "object" };
    if (operation.mutates) output = envelope(ref("MutationReceipt"));
    else if (operation.collection) output = envelope(isPage ? { type: "array", items: ref(name(operation.collection)) } : ref(name(operation.collection)), isPage);
    else if (operation.id === "topology.get") output = envelope({ oneOf: [ref("Topology"), ref("Delta")] });
    else if (operation.id === "changes.list") output = envelope({ type: "array", items: ref("Change") }, true);
    else if (operation.id === "changes.get") output = envelope(ref("ChangeDetail"));
    else if (operation.id === "topology.validate") output = envelope(ref("Validation"));
    else if (operation.id === "requests.get") output = envelope(ref("RequestOutcome"));
    const headers = { ETag: { schema: { type: "string" } }, "X-Request-Id": { schema: { type: "string" } }, "Cache-Control": { schema: { const: "no-store" } }, "Idempotency-Replayed": { schema: { const: "true" } }, "X-Original-Request-Id": { schema: { type: "string" } } };
    const responses: Record<string, unknown> = { "200": { description: "Successful response", headers, content: content(output) } };
    if (!operation.write && operation.id !== "capabilities" && operation.id !== "openapi" && operation.id !== "requests.get") responses["304"] = { description: "ETag matches", headers };
    for (const code of [400, 401, 403, 404, 408, 409, 410, 412, 413, 415, 422, 428, 429, 503]) responses[String(code)] = { description: code === 410 ? "Resync required; current_revision and oldest_retained_revision are included." : "Structured error", headers, content: content(ref(code === 410 ? "ResyncError" : "Error")) };
    const entry = { operationId: operation.id, summary: operation.summary, security: [{ ConnectBearer: [] }], parameters, responses,
      "x-required-scope": operation.write ? "topology:write" : "topology:read", "x-mutates": operation.mutates,
      ...(input ? { requestBody: { required: true, content: content(input) } } : {}) };
    const path = paths[operation.path] ?? {};
    path[operation.method.toLowerCase()] = entry;
    if (operation.method === "GET") path.head = { ...entry, operationId: `${operation.id}.head`, responses: Object.fromEntries(Object.keys(responses).map((code) => [code, { description: "Headers and status only", headers }])) };
    paths[operation.path] = path;
  }
  const issue = { type: "object", required: ["path", "code", "message"], properties: { path: { type: "array", items: { type: ["string", "integer"] } }, code: { type: "string" }, message: { type: "string" }, rule: { type: "string" } } };
  const error = { type: "object", required: ["error"], properties: { error: { type: "object", required: ["code", "message", "requestId"], properties: { code: { type: "string" }, message: { type: "string" }, requestId: { type: "string" }, issues: { type: "array", items: issue } } } } };
  const collections = Object.keys(entitySchemas);
  const changed = { type: "object", required: collections, properties: Object.fromEntries(collections.map((collection) => [collection, { type: "array", items: ref(name(collection)) }])) };
  const deleted = { type: "object", required: collections, properties: Object.fromEntries(collections.map((collection) => [collection, { type: "array", items: schema(topologyIdSchema) }])) };
  const schemas: Record<string, unknown> = {
    Topology: schema(topologySchema), OperationBatch: schema(topologyOperationBatchSchema),
    ...Object.fromEntries(Object.entries(entitySchemas).map(([collection, value]) => [name(collection), schema(value)])),
    Error: error, ResyncError: { ...error, required: ["error", "current_revision", "oldest_retained_revision"], properties: { ...error.properties, current_revision: { type: "integer", minimum: 0 }, oldest_retained_revision: { type: "integer", minimum: 0 } } },
    MutationReceipt: { type: "object", required: ["revision", "counts", "changed", "warnings"], properties: { revision: { type: "integer", minimum: 0 }, counts: { type: "object" }, changed: { type: "object" }, warnings: { type: "array", items: { type: "object" } } } },
    Validation: { type: "object", description: "Dry-run result with warnings and change counts." },
    Delta: { type: "object", required: ["since", "revision", "changed", "deleted"], properties: {
      since: { type: "integer", minimum: 0 }, revision: { type: "integer", minimum: 0 },
      metadata: { type: "object", required: ["schemaVersion", "title", "description"], properties: { schemaVersion: { const: 2 }, title: { type: "string" }, description: { type: "string" }, provenance: { type: "string" } } },
      changed, deleted,
    } },
    Change: { type: "object", description: "Change summary." }, ChangeDetail: { type: "object", description: "Change summary with before and after images." },
    RequestOutcome: { type: "object", description: "The token's stored idempotency outcome." },
  };
  return { openapi: "3.1.0", info: { title: "Steed Topology Connect", version: "1.0.0", description: "Token-scoped canonical topology API. Validate before writes; use current ETags and persist idempotency keys." },
    servers: [{ url: `${origin}/api/v1` }], paths, components: { securitySchemes: { ConnectBearer: { type: "http", scheme: "bearer", bearerFormat: "steedc_…" } }, schemas },
    "x-limits": { ...CONNECT_LIMITS, ...TOPOLOGY_LIMITS } };
}

export function topologyConnectCapabilities(origin: string, token: { id: string; scope: "topology:read" | "topology:write" }) {
  return { apiVersion: "1", apiBaseUrl: `${origin}/api/v1`, token: { id: token.id, scope: token.scope },
    operations: TOPOLOGY_CONNECT_OPERATIONS.filter((operation) => !operation.write || token.scope === "topology:write"),
    limits: { ...CONNECT_LIMITS, ...TOPOLOGY_LIMITS }, readMethods: ["GET", "HEAD"],
    unsupported: ["Token management through Bearer", "Remote execution"],
    authoring: ["Read the topology and ETag before editing.", "Validate proposed changes and persist one idempotency key per exact intent.", "Confirm removals with X-Steed-Confirm: topology.", "On 412 reread the topology; on 410 resync from a full snapshot."] };
}
