import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRouter, jsonOk, jsonError } from "./router";
import { WorkerApiError } from "./errors";

describe("createRouter", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("routes GET requests correctly", async () => {
    const router = createRouter();
    const handler = vi.fn().mockResolvedValue(jsonOk({ test: true }));
    router.get("/api/test", handler);

    const req = new Request("https://example.com/api/test");
    const res = await router.fetch(
      req,
      { WORKER_API_URL: "", DASHBOARD_SERVICE_TOKEN: "" },
      null
    );

    expect(handler).toHaveBeenCalled();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toEqual({ test: true });
  });

  it("extracts path params", async () => {
    const router = createRouter();
    const handler = vi.fn().mockImplementation((_req, ctx) => {
      return jsonOk({ id: ctx.params.id });
    });
    router.get("/api/items/:id", handler);

    const req = new Request("https://example.com/api/items/123");
    const res = await router.fetch(
      req,
      { WORKER_API_URL: "", DASHBOARD_SERVICE_TOKEN: "" },
      null
    );

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toEqual({ id: "123" });
  });

  it("returns 404 for unmatched routes", async () => {
    const router = createRouter();
    const req = new Request("https://example.com/api/unknown");
    const res = await router.fetch(
      req,
      { WORKER_API_URL: "", DASHBOARD_SERVICE_TOKEN: "" },
      null
    );

    expect(res.status).toBe(404);
  });

  it("handles WorkerApiError", async () => {
    const router = createRouter();
    const handler = vi.fn().mockRejectedValue(
      new WorkerApiError(502, {}, "Bad Gateway")
    );
    router.get("/api/fail", handler);

    const req = new Request("https://example.com/api/fail");
    const res = await router.fetch(
      req,
      { WORKER_API_URL: "", DASHBOARD_SERVICE_TOKEN: "" },
      null
    );

    expect(res.status).toBe(502);
  });

  it("supports POST method", async () => {
    const router = createRouter();
    const handler = vi.fn().mockResolvedValue(jsonOk({ created: true }, 201));
    router.post("/api/create", handler);

    const req = new Request("https://example.com/api/create", {
      method: "POST",
    });
    const res = await router.fetch(
      req,
      { WORKER_API_URL: "", DASHBOARD_SERVICE_TOKEN: "" },
      null
    );

    expect(handler).toHaveBeenCalled();
    expect(res.status).toBe(201);
  });

  it("supports PATCH method", async () => {
    const router = createRouter();
    const handler = vi.fn().mockResolvedValue(jsonOk({ updated: true }));
    router.patch("/api/update/:id", handler);

    const req = new Request("https://example.com/api/update/456", {
      method: "PATCH",
    });
    const res = await router.fetch(
      req,
      { WORKER_API_URL: "", DASHBOARD_SERVICE_TOKEN: "" },
      null
    );

    expect(handler).toHaveBeenCalled();
    expect(res.status).toBe(200);
  });

  it("supports PUT method", async () => {
    const router = createRouter();
    const handler = vi.fn().mockResolvedValue(jsonOk({ replaced: true }));
    router.put("/api/replace/:id", handler);

    const req = new Request("https://example.com/api/replace/789", {
      method: "PUT",
    });
    const res = await router.fetch(
      req,
      { WORKER_API_URL: "", DASHBOARD_SERVICE_TOKEN: "" },
      null
    );

    expect(handler).toHaveBeenCalled();
    expect(res.status).toBe(200);
  });

  it("supports DELETE method", async () => {
    const router = createRouter();
    const handler = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    router.delete("/api/items/:id", handler);

    const req = new Request("https://example.com/api/items/abc", {
      method: "DELETE",
    });
    const res = await router.fetch(
      req,
      { WORKER_API_URL: "", DASHBOARD_SERVICE_TOKEN: "" },
      null
    );

    expect(handler).toHaveBeenCalled();
    expect(res.status).toBe(204);
  });
});

describe("jsonOk", () => {
  it("returns JSON response with default 200 status", async () => {
    const res = jsonOk({ foo: "bar" });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/json");
    const data = await res.json();
    expect(data).toEqual({ foo: "bar" });
  });

  it("accepts custom status code", async () => {
    const res = jsonOk({ created: true }, 201);
    expect(res.status).toBe(201);
  });
});

describe("jsonError", () => {
  it("returns error JSON response", async () => {
    const res = jsonError("bad_request", "Invalid input", 400);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data).toEqual({
      error: { code: "bad_request", message: "Invalid input" },
    });
  });
});
