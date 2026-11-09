import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { emptyTopology, TOPOLOGY_CONNECT_OPERATIONS } from "@steed/api/shared";
import { topologyConnectCapabilities, topologyConnectOpenApi } from "./topology-connect-contract";

describe("topology Connect discovery preparation", () => {
  it("documents all registered operations and their scopes, methods, headers and request bodies", () => {
    const spec = topologyConnectOpenApi("https://fixture.example");
    expect(spec.servers).toEqual([{ url: "https://fixture.example/api/v1" }]);
    for (const operation of TOPOLOGY_CONNECT_OPERATIONS) {
      const entry = spec.paths[operation.path]?.[operation.method.toLowerCase()] as Record<string, unknown>;
      expect(entry).toMatchObject({ operationId: operation.id, "x-required-scope": operation.write ? "topology:write" : "topology:read", "x-mutates": operation.mutates });
      if (operation.method === "GET") expect(spec.paths[operation.path]?.head).toMatchObject({ operationId: `${operation.id}.head` });
      const parameters = entry.parameters as { name: string; required?: boolean }[];
      if (operation.mutates) {
        expect(parameters).toEqual(expect.arrayContaining([expect.objectContaining({ name: "If-Match", required: true }), expect.objectContaining({ name: "Idempotency-Key", required: true }), expect.objectContaining({ name: "X-Steed-Confirm" })]));
      }
      if (["topology.put", "topology.operations", "topology.validate"].includes(operation.id) || operation.collection && operation.method === "PUT") expect(entry.requestBody).toBeDefined();
    }
    expect(spec.components.schemas.Topology).toMatchObject({ type: "object", properties: { schemaVersion: { const: 2 } } });
    expect(spec.components.schemas.ResyncError).toMatchObject({ required: expect.arrayContaining(["current_revision", "oldest_retained_revision"]) });
    const validate = spec.paths["/topology/validate"]?.post as { responses: Record<string, { description: string; headers: Record<string, unknown> }> };
    expect(validate.responses["422"]?.description).toContain("secret_like_value");
    expect(Object.keys(validate.responses["200"]?.headers ?? {})).toEqual(expect.arrayContaining(["X-Steed-Colo", "X-Steed-Ingress-Colo", "X-Steed-Placement", "Server-Timing"]));
  });

  it("advertises only permitted operations and the topology operation limit", () => {
    const read = topologyConnectCapabilities("https://fixture.example", { id: "reader", scope: "topology:read" });
    const write = topologyConnectCapabilities("https://fixture.example", { id: "writer", scope: "topology:write" });
    expect(read.operations.every((item) => !item.write)).toBe(true);
    expect(write.operations).toEqual(TOPOLOGY_CONNECT_OPERATIONS);
    expect(read.token).toEqual({ id: "reader", scope: "topology:read" });
    expect(write.limits.operations).toBe(1000);
  });

  it("validates full snapshot and delta responses as distinct schema alternatives", () => {
    const rootRequire = createRequire(import.meta.url);
    const eslintRequire = createRequire(rootRequire.resolve("eslint"));
    const Ajv = eslintRequire("ajv") as new (options: object) => { compile: (schema: object) => (value: unknown) => boolean };
    const spec = topologyConnectOpenApi("https://fixture.example");
    const entry = spec.paths["/topology"]?.get as { responses: { "200": { content: { "application/json": { schema: object } } } } };
    const validate = new Ajv({ validateSchema: false }).compile({ ...entry.responses["200"].content["application/json"].schema, components: spec.components });
    const collections = ["layers", "types", "boundaries", "nodes", "edges", "views"];
    const empty = Object.fromEntries(collections.map((collection) => [collection, []]));
    expect(validate({ data: emptyTopology("Fixture"), requestId: "request" })).toBe(true);
    expect(validate({ data: { since: 0, revision: 1, metadata: { schemaVersion: 2, title: "Fixture", description: "" }, changed: empty, deleted: empty }, requestId: "request" })).toBe(true);
    expect(validate({ data: { since: 0, revision: 1 }, requestId: "request" })).toBe(false);
  });
});
