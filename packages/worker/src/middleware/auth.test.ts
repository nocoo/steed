import { describe, it, expect, vi } from "vitest";
import { Hono } from "hono";
import { authMiddleware, requireRole, type AuthContext } from "./auth";
import type { Env } from "../env";

// Helper to create SHA-256 hash (same as auth middleware)
async function sha256(text: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(text);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Mock D1 database
function createMockDb(hosts: Array<{ id: string; api_key_hash: string }>) {
  return {
    prepare: vi.fn((sql: string) => ({
      bind: vi.fn((_hash: string) => ({
        first: vi.fn(async () => {
          // For the SELECT query, find matching host
          if (sql.includes("SELECT id FROM hosts")) {
            const hash = _hash;
            const host = hosts.find((h) => h.api_key_hash === hash);
            return host ? { id: host.id } : null;
          }
          return null;
        }),
      })),
    })),
  } as unknown as D1Database;
}

describe("Auth Middleware", () => {
  describe("authMiddleware", () => {
    it("should set public role when no Authorization header", async () => {
      const app = new Hono<{ Bindings: Env }>();
      app.use("*", authMiddleware);
      app.get("/test", (c) => c.json(c.get("auth")));

      const res = await app.request("/test", {}, {
        DB: createMockDb([]),
        DASHBOARD_SERVICE_TOKEN: "dashboard-token",
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as AuthContext;
      expect(body.role).toBe("public");
      expect(body.hostId).toBeNull();
      expect(body.invalidToken).toBe(false);
    });

    it("should set dashboard role when token matches DASHBOARD_SERVICE_TOKEN", async () => {
      const app = new Hono<{ Bindings: Env }>();
      app.use("*", authMiddleware);
      app.get("/test", (c) => c.json(c.get("auth")));

      const res = await app.request(
        "/test",
        { headers: { Authorization: "Bearer dashboard-token" } },
        { DB: createMockDb([]), DASHBOARD_SERVICE_TOKEN: "dashboard-token" }
      );

      expect(res.status).toBe(200);
      const body = (await res.json()) as AuthContext;
      expect(body.role).toBe("dashboard");
      expect(body.hostId).toBeNull();
      expect(body.invalidToken).toBe(false);
    });

    it("should set host role when token hash matches host API key", async () => {
      const hostApiKey = "sk_host_test123";
      const hostApiKeyHash = await sha256(hostApiKey);

      const app = new Hono<{ Bindings: Env }>();
      app.use("*", authMiddleware);
      app.get("/test", (c) => c.json(c.get("auth")));

      const res = await app.request(
        "/test",
        { headers: { Authorization: `Bearer ${hostApiKey}` } },
        {
          DB: createMockDb([{ id: "host_abc123", api_key_hash: hostApiKeyHash }]),
          DASHBOARD_SERVICE_TOKEN: "dashboard-token",
        }
      );

      expect(res.status).toBe(200);
      const body = (await res.json()) as AuthContext;
      expect(body.role).toBe("host");
      expect(body.hostId).toBe("host_abc123");
      expect(body.invalidToken).toBe(false);
    });

    it("should set public role with invalidToken=true when token is invalid", async () => {
      const app = new Hono<{ Bindings: Env }>();
      app.use("*", authMiddleware);
      app.get("/test", (c) => c.json(c.get("auth")));

      const res = await app.request(
        "/test",
        { headers: { Authorization: "Bearer invalid-token" } },
        { DB: createMockDb([]), DASHBOARD_SERVICE_TOKEN: "dashboard-token" }
      );

      expect(res.status).toBe(200);
      const body = (await res.json()) as AuthContext;
      expect(body.role).toBe("public");
      expect(body.invalidToken).toBe(true);
    });

    it("should set invalidToken=true for malformed Authorization header (not Bearer)", async () => {
      const app = new Hono<{ Bindings: Env }>();
      app.use("*", authMiddleware);
      app.get("/test", (c) => c.json(c.get("auth")));

      const res = await app.request(
        "/test",
        { headers: { Authorization: "Basic dXNlcjpwYXNz" } },
        { DB: createMockDb([]), DASHBOARD_SERVICE_TOKEN: "dashboard-token" }
      );

      expect(res.status).toBe(200);
      const body = (await res.json()) as AuthContext;
      expect(body.role).toBe("public");
      expect(body.invalidToken).toBe(true);
    });

    it("should set invalidToken=true for Bearer without token", async () => {
      const app = new Hono<{ Bindings: Env }>();
      app.use("*", authMiddleware);
      app.get("/test", (c) => c.json(c.get("auth")));

      const res = await app.request(
        "/test",
        { headers: { Authorization: "Bearer " } },
        { DB: createMockDb([]), DASHBOARD_SERVICE_TOKEN: "dashboard-token" }
      );

      expect(res.status).toBe(200);
      const body = (await res.json()) as AuthContext;
      expect(body.role).toBe("public");
      expect(body.invalidToken).toBe(true);
    });

    it("should set invalidToken=true for just 'Bearer' without space", async () => {
      const app = new Hono<{ Bindings: Env }>();
      app.use("*", authMiddleware);
      app.get("/test", (c) => c.json(c.get("auth")));

      const res = await app.request(
        "/test",
        { headers: { Authorization: "Bearer" } },
        { DB: createMockDb([]), DASHBOARD_SERVICE_TOKEN: "dashboard-token" }
      );

      expect(res.status).toBe(200);
      const body = (await res.json()) as AuthContext;
      expect(body.role).toBe("public");
      expect(body.invalidToken).toBe(true);
    });

    it("should set invalidToken=true for random garbage in Authorization header", async () => {
      const app = new Hono<{ Bindings: Env }>();
      app.use("*", authMiddleware);
      app.get("/test", (c) => c.json(c.get("auth")));

      const res = await app.request(
        "/test",
        { headers: { Authorization: "garbage" } },
        { DB: createMockDb([]), DASHBOARD_SERVICE_TOKEN: "dashboard-token" }
      );

      expect(res.status).toBe(200);
      const body = (await res.json()) as AuthContext;
      expect(body.role).toBe("public");
      expect(body.invalidToken).toBe(true);
    });
  });

  describe("requireRole", () => {
    it("should allow matching role", async () => {
      const app = new Hono<{ Bindings: Env }>();
      app.use("*", async (c, next) => {
        c.set("auth", { role: "dashboard", hostId: null, invalidToken: false });
        await next();
      });
      app.get("/test", requireRole("dashboard"), (c) => c.json({ ok: true }));

      const res = await app.request("/test");
      expect(res.status).toBe(200);
    });

    it("should allow any of multiple roles", async () => {
      const app = new Hono<{ Bindings: Env }>();
      app.use("*", async (c, next) => {
        c.set("auth", { role: "host", hostId: "host_123", invalidToken: false });
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

    it("should return 401 when token was provided but invalid", async () => {
      const app = new Hono<{ Bindings: Env }>();
      app.use("*", async (c, next) => {
        c.set("auth", { role: "public", hostId: null, invalidToken: true });
        await next();
      });
      app.get("/test", requireRole("dashboard"), (c) => c.json({ ok: true }));

      const res = await app.request("/test");
      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body).toHaveProperty("error.code", "unauthorized");
    });

    it("should return 403 when authenticated but wrong role", async () => {
      const app = new Hono<{ Bindings: Env }>();
      app.use("*", async (c, next) => {
        c.set("auth", { role: "host", hostId: "host_123", invalidToken: false });
        await next();
      });
      app.get("/test", requireRole("dashboard"), (c) => c.json({ ok: true }));

      const res = await app.request("/test");
      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body).toHaveProperty("error.code", "forbidden");
    });

    it("should return 401 when no token provided (public) for protected route", async () => {
      const app = new Hono<{ Bindings: Env }>();
      app.use("*", async (c, next) => {
        c.set("auth", { role: "public", hostId: null, invalidToken: false });
        await next();
      });
      app.get("/test", requireRole("dashboard"), (c) => c.json({ ok: true }));

      const res = await app.request("/test");
      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body).toHaveProperty("error.code", "unauthorized");
      expect(body.error.message).toBe("Authentication required");
    });
  });
});
