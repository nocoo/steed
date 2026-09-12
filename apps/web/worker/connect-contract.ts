import { z } from "zod";
import { CONNECT_LIMITS, CONNECT_OPERATIONS, DIAGRAM_LIMITS, ENTITY_SCHEMAS, diagramIdSchema, diagramSchema, idempotencyKeySchema, operationBatchSchema } from "@steed/api/shared";
import type { TokenRow } from "./connect";

const summary = z.strictObject({ id: diagramIdSchema, title: z.string(), description: z.string(), revision: z.number().int().positive(), nodeCount: z.number().int(), edgeCount: z.number().int(), createdAt: z.iso.datetime(), updatedAt: z.iso.datetime() });
const receipt = summary.pick({ id: true, revision: true, nodeCount: true, edgeCount: true, updatedAt: true });
const error = z.strictObject({ error: z.object({ code: z.string(), message: z.string(), requestId: z.string(), issues: z.array(z.object({ path: z.array(z.union([z.string(), z.number()])), message: z.string() })).optional() }) });
const envelope = (data: z.ZodType) => z.strictObject({ data, requestId: z.string() });
const page = (data: z.ZodType) => z.strictObject({ data: z.array(data), nextCursor: z.string().nullable(), requestId: z.string() });
const schemas = {
  Diagram: diagramSchema, DiagramSummary: summary, DiagramRecord: summary.extend({ document: diagramSchema }), MutationReceipt: receipt,
  MutationResponse: envelope(receipt), Error: error, OperationBatch: operationBatchSchema,
  DiagramResponse: envelope(summary.extend({ document: diagramSchema })), DiagramPage: page(summary),
  Nodes: ENTITY_SCHEMAS.nodes, Edges: ENTITY_SCHEMAS.edges, Groups: ENTITY_SCHEMAS.groups, Views: ENTITY_SCHEMAS.views,
  NodesResponse: envelope(ENTITY_SCHEMAS.nodes), EdgesResponse: envelope(ENTITY_SCHEMAS.edges), GroupsResponse: envelope(ENTITY_SCHEMAS.groups), ViewsResponse: envelope(ENTITY_SCHEMAS.views),
  NodesPage: page(ENTITY_SCHEMAS.nodes), EdgesPage: page(ENTITY_SCHEMAS.edges), GroupsPage: page(ENTITY_SCHEMAS.groups), ViewsPage: page(ENTITY_SCHEMAS.views),
  ValidationResponse: envelope(z.strictObject({ valid: z.literal(true), nodeCount: z.number().int(), edgeCount: z.number().int() })),
  RequestOutcome: envelope(z.strictObject({ state: z.enum(["completed", "expired", "unknown"]), originalRequestId: z.string(), httpStatus: z.number().int(), diagramId: diagramIdSchema, etag: z.string().nullable(), result: z.union([envelope(receipt), error, z.null()]) })),
};
const jsonSchema = (schema: z.ZodType) => z.toJSONSchema(schema, { target: "draft-2020-12", io: "input" });
const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const content = (name: string) => ({ "application/json": { schema: ref(name) } });
const entityName = (name: string) => name[0]?.toUpperCase() + name.slice(1);

export function connectOpenApi(origin: string) {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const operation of CONNECT_OPERATIONS) {
    const parameters: unknown[] = [...operation.path.matchAll(/\{(\w+)\}/g)].map((match) => ({ name: match[1], in: "path", required: true, schema: jsonSchema(match[1] === "key" ? idempotencyKeySchema : diagramIdSchema) }));
    if (operation.id.endsWith(".list")) parameters.push(
      { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 100, default: 50 } },
      { name: "cursor", in: "query", description: "Pass nextCursor unchanged. Stable ID ordering; concurrent changes are not a frozen snapshot.", schema: { type: "string" } },
    );
    if (operation.mutates) {
      parameters.push(
        { name: "Idempotency-Key", in: "header", required: true, schema: jsonSchema(idempotencyKeySchema), description: "Persist one key per exact intent. Retries must keep method, path, preconditions, confirmation and JSON member ordering." },
        { name: "If-Match", in: "header", required: operation.id !== "diagrams.put", schema: { type: "string" }, description: 'The current diagram ETag, for example "diagram-id:3". Create uses If-None-Match instead.' },
      );
      if (operation.id === "diagrams.put") parameters.push({ name: "If-None-Match", in: "header", schema: { const: "*" }, description: "Required to create an unused canonical ID. Omit If-Match. Deleted IDs cannot be reused." });
      if (operation.dangerous || operation.id === "diagrams.operations") parameters.push({ name: "X-Steed-Confirm", in: "header", required: Boolean(operation.dangerous), schema: { type: "string" }, description: "Canonical diagram ID. Also required when an operation batch contains removals." });
    }
    const input = operation.id === "diagrams.operations" ? "OperationBatch" : ["diagrams.put", "diagrams.validate"].includes(operation.id) ? "Diagram"
      : operation.method === "PUT" && operation.collection ? entityName(operation.collection) : null;
    const output = operation.mutates ? "MutationResponse" : operation.collection ? entityName(operation.collection) + (operation.id.endsWith(".list") ? "Page" : "Response")
      : ({ "diagrams.list": "DiagramPage", "diagrams.get": "DiagramResponse", "diagrams.export": "Diagram", "diagrams.validate": "ValidationResponse", "requests.get": "RequestOutcome", capabilities: "Capabilities", openapi: "OpenApi" } as Record<string, string>)[operation.id] ?? "DiagramResponse";
    const headers = { "X-Request-Id": { schema: { type: "string" } }, "Cache-Control": { schema: { const: "no-store" } }, ETag: { schema: { type: "string" }, description: "Present on graph reads and successful mutations." },
      "Idempotency-Replayed": { schema: { const: "true" } }, "X-Original-Request-Id": { schema: { type: "string" } } };
    const responses: Record<string, unknown> = {};
    const status = operation.id === "diagrams.delete" ? "204" : "200";
    responses[status] = { description: operation.mutates ? "Committed mutation receipt; use GET for the complete source." : "Successful response", headers, ...(status === "204" ? {} : { content: content(output) }) };
    if (operation.id === "diagrams.put") responses["201"] = { description: "Created a new diagram", headers, content: content("MutationResponse") };
    for (const code of [400, 401, 403, 404, 408, 409, 412, 413, 415, 422, 428, 429, 503]) responses[String(code)] = { description: "Structured error. A 412 requires rereading state; a 409 requires checking the original intent. Honor Retry-After on 429.", content: content("Error"), headers: { ...headers, "Retry-After": { schema: { type: "string" } } } };
    const entry = { operationId: operation.id, summary: operation.summary, security: [{ ConnectBearer: [] }], parameters, responses,
      "x-required-scope": operation.write ? "write" : "read", "x-mutates": operation.mutates,
      ...(input ? { requestBody: { required: true, content: content(input) } } : {}) };
    const path = paths[operation.path] ?? {};
    path[operation.method.toLowerCase()] = entry;
    if (operation.method === "GET") path.head = { ...entry, operationId: `${operation.id}.head`, responses: Object.fromEntries(Object.keys(responses).map((code) => [code, { description: "Headers and status only", headers }])) };
    paths[operation.path] = path;
  }
  return { openapi: "3.1.0", info: { title: "Steed Connect", version: "1.0.0", description: "Agent API for structured architecture diagrams. Coordinates are absolute; edges contain explicit documented/inferred evidence. Views may supply positions, routes and boundary visibility. Graph references, group cycles and normalized JSON size are validated at every write. No CORS or legacy asset authentication. Mutation receipts are retained for seven days; expired keys never execute again." },
    servers: [{ url: `${origin}/api/v1` }], paths,
    components: { securitySchemes: { ConnectBearer: { type: "http", scheme: "bearer", bearerFormat: "steedc_…" } },
      schemas: { ...Object.fromEntries(Object.entries(schemas).map(([name, schema]) => [name, jsonSchema(schema)])),
        Capabilities: { type: "object", required: ["apiVersion", "apiBaseUrl", "token", "operations", "limits"], properties: { apiVersion: { const: "1" }, apiBaseUrl: { type: "string" }, token: { type: "object", properties: { id: { type: "string" }, diagramId: { type: ["string", "null"] }, scope: { enum: ["read", "write"] } } }, operations: { type: "array", items: { type: "object" } }, limits: { type: "object" } } },
        OpenApi: { type: "object", required: ["openapi", "info", "paths", "components"], properties: { openapi: { const: "3.1.0" }, info: { type: "object" }, paths: { type: "object" }, components: { type: "object" } } },
      } },
    "x-limits": { ...DIAGRAM_LIMITS, ...CONNECT_LIMITS },
  };
}

export function connectCapabilities(origin: string, token: Pick<TokenRow, "id" | "diagram_id" | "scope">) {
  return { apiVersion: "1", apiBaseUrl: `${origin}/api/v1`, token: { id: token.id, diagramId: token.diagram_id, scope: token.scope },
    operations: CONNECT_OPERATIONS.filter((operation) => !operation.write || token.scope === "write"),
    limits: { ...DIAGRAM_LIMITS, ...CONNECT_LIMITS },
    readMethods: ["GET", "HEAD"],
    unsupported: ["Host and inventory administration", "Token management through Bearer", "Remote execution"],
    authoring: ["Use stable IDs and absolute node coordinates.", "Separate large diagrams into named views with positions and routes.", "Mark uncertain relationships as inferred; do not invent resource ownership.", "Read the complete source and current ETag before editing. Validate proposed source before replacement.", "Store one idempotency key per exact intent. For removals, send X-Steed-Confirm. Inspect /requests/{key} after a lost response."] };
}
