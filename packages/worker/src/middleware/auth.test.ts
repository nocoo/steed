import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { authMiddleware, requireRole, type AuthContext } from "./auth";
import type { Env } from "../env";

describe("Auth Middleware", () => {
  describe("authMiddleware (skeleton)", () => {
    it("should set public role by default", async () => {
      const app = new Hono<{ Bindings: Env }>();
      app.use("*", authMiddleware);
      app.get("/test", (c) => {
        const auth = c.get("auth");
        return c.json(auth);
      });

      const res = await app.request("/test");
      expect(res.status).toBe(200);
      const body = (await res.json()) as AuthContext;
      expect(body.role).toBe("public");
      expect(body.hostId).toBeNull();
    });
  });

  describe("requireRole", () => {
    it("should allow matching role", async () => {
      const app = new Hono<{ Bindings: Env }>();
      app.use("*", async (c, next) => {
        c.set("auth", { role: "dashboard", hostId: null });
        await next();
      });
      app.get("/test", requireRole("dashboard"), (c) => c.json({ ok: true }));

      const res = await app.request("/test");
      expect(res.status).toBe(200);
    });

    it("should allow any of multiple roles", async () => {
      const app = new Hono<{ Bindings: Env }>();
      app.use("*", async (c, next) => {
        c.set("auth", { role: "host", hostId: "host_123" });
        await next();
      });
      app.get(
        "/test",
        requireRole("dashboard", "host"),
        (c) => c.json({ ok: true })
      );

      const res = await app.request("/test");
      expect(res.status).toBe(200);
    });

    it("should reject non-matching role with 403", async () => {
      const app = new Hono<{ Bindings: Env }>();
      app.use("*", async (c, next) => {
        c.set("auth", { role: "public", hostId: null });
        await next();
      });
      app.get("/test", requireRole("dashboard"), (c) => c.json({ ok: true }));

      const res = await app.request("/test");
      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body).toHaveProperty("error.code", "forbidden");
    });
  });
});
