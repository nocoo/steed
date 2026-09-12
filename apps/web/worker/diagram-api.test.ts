import { afterEach, beforeEach, describe, expect, it } from "vitest";
import example from "../../../examples/service-platform.json";
import { diagramSchema, type DiagramRecord } from "@steed/api/shared";
import { diagramBrowserApi } from "./diagram-api";
import { getDiagram, listDiagrams } from "./diagram-store";
import { testDatabase } from "./__tests__/db";

let database: ReturnType<typeof testDatabase>;
beforeEach(() => { database = testDatabase(); });
afterEach(() => database?.close());
const origin = "https://steed.example.com";
const request = (path = "example", method = "GET", body?: unknown, headers: Record<string, string> = {}) => diagramBrowserApi(new Request(
  `${origin}/api/diagrams${path ? `/${path}` : ""}`, {
    method, headers: { Origin: origin, "X-Steed-Request": "1", "Content-Type": "application/json", ...headers },
    ...(body === undefined ? {} : { body: typeof body === "string" ? body : JSON.stringify(body) }),
  }), database.db);
const create = () => request("example", "PUT", example, { "If-None-Match": "*" });

describe("diagram browser API with SQLite persistence", () => {
  it("creates, reads, paginates, changes, and deletes a complete diagram", async () => {
    const created = await create();
    expect(created.status).toBe(201);
    expect(created.headers.get("ETag")).toBe('"example:1"');
    expect(created.headers.get("Cache-Control")).toBe("no-store");
    expect(created.headers.get("X-Request-Id")).toBeTruthy();
    const record = await created.json() as DiagramRecord;
    expect(record.document).toEqual(diagramSchema.parse(example));
    expect(await (await request()).json()).toEqual(record);
    const head = await request("example", "HEAD");
    expect(head.headers.get("ETag")).toBe('"example:1"');
    expect(await head.text()).toBe("");
    await request("second", "PUT", example, { "If-None-Match": "*" });
    expect(await listDiagrams(database.db, "", 1)).toMatchObject({ data: [{ id: "example", nodeCount: 6 }], nextCursor: "example" });
    expect(await listDiagrams(database.db, "example", 1)).toMatchObject({ data: [{ id: "second" }], nextCursor: null });
    expect(await listDiagrams(database.db, "", 50, "example")).toMatchObject({ data: [{ id: "example" }] });
    expect((await request("", "GET")).status).toBe(200);
    expect(await (await request("", "HEAD")).text()).toBe("");

    const updated = await request("example", "PUT", { ...example, title: "Updated" }, { "If-Match": '"example:1"' });
    expect(updated.status).toBe(200);
    expect(updated.headers.get("ETag")).toBe('"example:2"');
    const saved = await updated.json() as DiagramRecord;
    expect(saved.createdAt).toBe(record.createdAt);
    expect(saved.document.title).toBe("Updated");
    expect((await request("example", "DELETE", undefined, { "If-Match": '"example:2"' })).status).toBe(204);
    expect((await request()).status).toBe(404);
    expect(await listDiagrams(database.db, "", 50)).toMatchObject({ data: [{ id: "second" }] });
    expect((await create()).status).toBe(412);
  });

  it("rejects two writes using the same revision without losing the first change", async () => {
    await create();
    const responses = await Promise.all([
      request("example", "PUT", { ...example, title: "First" }, { "If-Match": '"example:1"' }),
      request("example", "PUT", { ...example, title: "Second" }, { "If-Match": '"example:1"' }),
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([200, 412]);
    expect((await getDiagram(database.db, "example")).revision).toBe(2);
    expect((await request("example", "DELETE", undefined, { "If-Match": '"example:1"' })).status).toBe(412);
  });

  it.each([
    [{}, 428],
    [{ "If-Match": '"other:1"' }, 412],
    [{ "If-Match": '"example:0"' }, 412],
    [{ "If-Match": '"example:01"' }, 412],
    [{ "If-Match": '"example:1"', "If-None-Match": "*" }, 412],
    [{ "If-Match": 'W/"example:1"' }, 412],
  ])("rejects missing or invalid preconditions", async (headers, status) => {
    expect((await request("example", "PUT", example, headers as Record<string,string>)).status).toBe(status);
  });

  it("rejects invalid input and preserves the last valid diagram", async () => {
    await create();
    expect((await request("example", "PUT", { ...example, nodes: [] }, { "If-Match": '"example:1"' })).status).toBe(422);
    expect((await getDiagram(database.db, "example")).revision).toBe(1);
    expect((await request("example", "PUT", "{invalid", { "If-Match": '"example:1"' })).status).toBe(400);
    expect((await request("example", "PUT", example, { "If-Match": '"example:1"', "Content-Type": "text/plain" })).status).toBe(415);
    expect((await request("example", "PUT", "x".repeat(1_048_577), { "If-Match": '"example:1"' })).status).toBe(413);
    expect((await request("example", "PUT", undefined, { "If-Match": '"example:1"' })).status).toBe(400);
  });

  it("denies cross-origin management and unsupported paths or methods", async () => {
    expect((await request("example", "PUT", example, { Origin: "https://attacker.example", "If-None-Match": "*" })).status).toBe(403);
    expect((await request("example", "PUT", example, { Origin: "", "If-None-Match": "*" })).status).toBe(403);
    expect((await request("example", "PUT", example, { "X-Steed-Request": "", "If-None-Match": "*" })).status).toBe(403);
    expect((await request("example", "POST", example)).status).toBe(405);
    expect((await request("example/unknown")).status).toBe(404);
    expect((await request("", "POST", example)).status).toBe(404);
    expect((await request("example", "DELETE", undefined, { "If-None-Match": "*" })).status).toBe(428);
    expect((await request("example!", "GET")).status).toBe(422);
    expect((await request("?limit=0")).status).toBe(422);
    expect((await request("?surprise=yes")).status).toBe(422);
  });

  it("does not expose database errors in responses", async () => {
    database.sqlite.exec("DROP TABLE diagrams");
    const response = await request();
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("no such table");
  });
});
