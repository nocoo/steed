import { describe, it, expect } from "vitest";
import { errors, jsonResponse, errorResponse } from "./response";
import { Hono } from "hono";

describe("Response Utils", () => {
  const app = new Hono();

  app.get("/json", (c) => jsonResponse(c, { foo: "bar" }));
  app.get("/json-201", (c) => jsonResponse(c, { created: true }, 201));
  app.get("/error", (c) => errorResponse(c, "test_error", "Test message", 400));
  app.get("/invalid-request", (c) => errors.invalidRequest(c));
  app.get("/unauthorized", (c) => errors.unauthorized(c));
  app.get("/forbidden", (c) => errors.forbidden(c));
  app.get("/not-found", (c) => errors.notFound(c, "Host"));
  app.get("/conflict", (c) => errors.conflict(c));
  app.get("/internal-error", (c) => errors.internalError(c));

  describe("jsonResponse", () => {
    it("should return JSON with default 200 status", async () => {
      const res = await app.request("/json");
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ foo: "bar" });
    });

    it("should support custom status code", async () => {
      const res = await app.request("/json-201");
      expect(res.status).toBe(201);
    });
  });

  describe("errorResponse", () => {
    it("should return error format", async () => {
      const res = await app.request("/error");
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({
        error: { code: "test_error", message: "Test message" },
      });
    });
  });

  describe("errors helpers", () => {
    it("invalidRequest returns 400", async () => {
      const res = await app.request("/invalid-request");
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body).toHaveProperty("error.code", "invalid_request");
    });

    it("unauthorized returns 401", async () => {
      const res = await app.request("/unauthorized");
      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body).toHaveProperty("error.code", "unauthorized");
    });

    it("forbidden returns 403", async () => {
      const res = await app.request("/forbidden");
      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body).toHaveProperty("error.code", "forbidden");
    });

    it("notFound returns 404 with resource name", async () => {
      const res = await app.request("/not-found");
      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body).toHaveProperty("error.code", "not_found");
      expect(body).toHaveProperty("error.message", "Host not found");
    });

    it("conflict returns 409", async () => {
      const res = await app.request("/conflict");
      expect(res.status).toBe(409);
      const body = await res.json();
      expect(body).toHaveProperty("error.code", "conflict");
    });

    it("internalError returns 500", async () => {
      const res = await app.request("/internal-error");
      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body).toHaveProperty("error.code", "internal_error");
    });
  });
});
