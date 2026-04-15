import { describe, it, expect, vi } from "vitest";
import { Hono } from "hono";
import { agents } from "./agents";
import type { Env } from "../env";

// Mock auth middleware for dashboard role
const mockDashboardAuth = async (
  c: { set: (key: string, value: unknown) => void },
  next: () => Promise<void>
) => {
  c.set("auth", { role: "dashboard", hostId: null, invalidToken: false });
  await next();
};

// Mock auth middleware for host role
const mockHostAuth = (hostId: string) => async (
  c: { set: (key: string, value: unknown) => void },
  next: () => Promise<void>
) => {
  c.set("auth", { role: "host", hostId, invalidToken: false });
  await next();
};

// Mock auth middleware for public role (unauthenticated)
const mockPublicAuth = async (
  c: { set: (key: string, value: unknown) => void },
  next: () => Promise<void>
) => {
  c.set("auth", { role: "public", hostId: null, invalidToken: false });
  await next();
};

// Create mock D1 database
function createMockDb() {
  return {
    prepare: vi.fn(() => ({
      bind: vi.fn(() => ({
        run: vi.fn(async () => ({ success: true })),
        first: vi.fn(async () => null),
        all: vi.fn(async () => ({ results: [] })),
      })),
      run: vi.fn(async () => ({ success: true })),
      first: vi.fn(async () => null),
      all: vi.fn(async () => ({ results: [] })),
    })),
    batch: vi.fn(async () => []),
  } as unknown as D1Database;
}

describe("Agents Routes", () => {
  describe("Route scaffold", () => {
    it("POST /agents should return 501 (not implemented)", async () => {
      const mockDb = createMockDb();
      const app = new Hono<{ Bindings: Env }>();
      app.use("*", mockDashboardAuth);
      app.route("/", agents);

      const res = await app.request(
        "/",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ match_key: "test:/path" }),
        },
        { DB: mockDb, DASHBOARD_SERVICE_TOKEN: "token" }
      );

      expect(res.status).toBe(501);
    });

    it("GET /agents should return 501 (not implemented)", async () => {
      const mockDb = createMockDb();
      const app = new Hono<{ Bindings: Env }>();
      app.use("*", mockDashboardAuth);
      app.route("/", agents);

      const res = await app.request(
        "/",
        {},
        { DB: mockDb, DASHBOARD_SERVICE_TOKEN: "token" }
      );

      expect(res.status).toBe(501);
    });

    it("GET /agents/:id should return 501 (not implemented)", async () => {
      const mockDb = createMockDb();
      const app = new Hono<{ Bindings: Env }>();
      app.use("*", mockDashboardAuth);
      app.route("/", agents);

      const res = await app.request(
        "/agent_123",
        {},
        { DB: mockDb, DASHBOARD_SERVICE_TOKEN: "token" }
      );

      expect(res.status).toBe(501);
    });

    it("PATCH /agents/:id should return 501 (not implemented)", async () => {
      const mockDb = createMockDb();
      const app = new Hono<{ Bindings: Env }>();
      app.use("*", mockDashboardAuth);
      app.route("/", agents);

      const res = await app.request(
        "/agent_123",
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ nickname: "test" }),
        },
        { DB: mockDb, DASHBOARD_SERVICE_TOKEN: "token" }
      );

      expect(res.status).toBe(501);
    });

    it("POST /agents should allow host role", async () => {
      const mockDb = createMockDb();
      const app = new Hono<{ Bindings: Env }>();
      app.use("*", mockHostAuth("host_123"));
      app.route("/", agents);

      const res = await app.request(
        "/",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ match_key: "test:/path" }),
        },
        { DB: mockDb, DASHBOARD_SERVICE_TOKEN: "token" }
      );

      // Should not be 401/403, should be 501 (allowed but not implemented)
      expect(res.status).toBe(501);
    });

    it("GET /agents should reject host role", async () => {
      const mockDb = createMockDb();
      const app = new Hono<{ Bindings: Env }>();
      app.use("*", mockHostAuth("host_123"));
      app.route("/", agents);

      const res = await app.request(
        "/",
        {},
        { DB: mockDb, DASHBOARD_SERVICE_TOKEN: "token" }
      );

      expect(res.status).toBe(403);
    });

    it("GET /agents should reject unauthenticated", async () => {
      const mockDb = createMockDb();
      const app = new Hono<{ Bindings: Env }>();
      app.use("*", mockPublicAuth);
      app.route("/", agents);

      const res = await app.request(
        "/",
        {},
        { DB: mockDb, DASHBOARD_SERVICE_TOKEN: "token" }
      );

      expect(res.status).toBe(401);
    });
  });
});
