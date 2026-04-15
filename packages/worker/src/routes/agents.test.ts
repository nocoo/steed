import { describe, it, expect, vi } from "vitest";
import { Hono } from "hono";
import { agents } from "./agents";
import type { Env } from "../env";
import type { Agent } from "@steed/shared";

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

// Create mock D1 database with configurable behavior
function createMockDb(options: {
  hosts?: Array<{ id: string }>;
  agents?: Array<{ id: string; host_id: string; match_key: string }>;
  insertError?: string;
} = {}) {
  const hosts = options.hosts ?? [];
  const agentsData = options.agents ?? [];

  return {
    prepare: vi.fn((sql: string) => ({
      bind: vi.fn((...args: unknown[]) => ({
        run: vi.fn(async () => {
          if (options.insertError && sql.includes("INSERT INTO agents")) {
            throw new Error(options.insertError);
          }
          return { success: true };
        }),
        first: vi.fn(async () => {
          if (sql.includes("SELECT id FROM hosts WHERE id = ?")) {
            const hostId = args[0] as string;
            return hosts.find(h => h.id === hostId) ?? null;
          }
          if (sql.includes("SELECT") && sql.includes("agents")) {
            const id = args[0] as string;
            return agentsData.find(a => a.id === id) ?? null;
          }
          return null;
        }),
        all: vi.fn(async () => ({ results: agentsData })),
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

  describe("POST /agents", () => {
    it("should create agent with host role using auth hostId", async () => {
      const mockDb = createMockDb();
      const app = new Hono<{ Bindings: Env }>();
      app.use("*", mockHostAuth("host_123"));
      app.route("/", agents);

      const res = await app.request(
        "/",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            match_key: "openclaw:/workspace",
            nickname: "Test Agent",
            role: "Code review",
          }),
        },
        { DB: mockDb, DASHBOARD_SERVICE_TOKEN: "token" }
      );

      expect(res.status).toBe(201);
      const body = (await res.json()) as Agent;
      expect(body.id).toMatch(/^agent_/);
      expect(body.host_id).toBe("host_123");
      expect(body.match_key).toBe("openclaw:/workspace");
      expect(body.nickname).toBe("Test Agent");
      expect(body.role).toBe("Code review");
      expect(body.status).toBe("stopped");
      expect(body.lane_id).toBeNull();
      expect(body.metadata).toEqual({});
      expect(body.extra).toEqual({});
    });

    it("should create agent with dashboard role using body host_id", async () => {
      const mockDb = createMockDb({ hosts: [{ id: "host_abc" }] });
      const app = new Hono<{ Bindings: Env }>();
      app.use("*", mockDashboardAuth);
      app.route("/", agents);

      const res = await app.request(
        "/",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            host_id: "host_abc",
            match_key: "hermes:/home/agent",
          }),
        },
        { DB: mockDb, DASHBOARD_SERVICE_TOKEN: "token" }
      );

      expect(res.status).toBe(201);
      const body = (await res.json()) as Agent;
      expect(body.host_id).toBe("host_abc");
      expect(body.match_key).toBe("hermes:/home/agent");
      expect(body.nickname).toBeNull();
      expect(body.role).toBeNull();
    });

    it("should ignore body host_id for host role", async () => {
      const mockDb = createMockDb();
      const app = new Hono<{ Bindings: Env }>();
      app.use("*", mockHostAuth("host_real"));
      app.route("/", agents);

      const res = await app.request(
        "/",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            host_id: "host_fake", // Should be ignored
            match_key: "test:/path",
          }),
        },
        { DB: mockDb, DASHBOARD_SERVICE_TOKEN: "token" }
      );

      expect(res.status).toBe(201);
      const body = (await res.json()) as Agent;
      expect(body.host_id).toBe("host_real"); // Uses auth hostId, not body
    });

    it("should return 400 for missing match_key", async () => {
      const mockDb = createMockDb();
      const app = new Hono<{ Bindings: Env }>();
      app.use("*", mockHostAuth("host_123"));
      app.route("/", agents);

      const res = await app.request(
        "/",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ nickname: "Test" }),
        },
        { DB: mockDb, DASHBOARD_SERVICE_TOKEN: "token" }
      );

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body).toHaveProperty("error.code", "invalid_request");
      expect(body.error.message).toContain("match_key");
    });

    it("should return 400 for empty match_key", async () => {
      const mockDb = createMockDb();
      const app = new Hono<{ Bindings: Env }>();
      app.use("*", mockHostAuth("host_123"));
      app.route("/", agents);

      const res = await app.request(
        "/",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ match_key: "" }),
        },
        { DB: mockDb, DASHBOARD_SERVICE_TOKEN: "token" }
      );

      expect(res.status).toBe(400);
    });

    it("should return 400 for missing host_id with dashboard role", async () => {
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

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error.message).toContain("host_id");
    });

    it("should return 404 for non-existent host_id with dashboard role", async () => {
      const mockDb = createMockDb({ hosts: [] }); // No hosts
      const app = new Hono<{ Bindings: Env }>();
      app.use("*", mockDashboardAuth);
      app.route("/", agents);

      const res = await app.request(
        "/",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            host_id: "host_nonexistent",
            match_key: "test:/path",
          }),
        },
        { DB: mockDb, DASHBOARD_SERVICE_TOKEN: "token" }
      );

      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body).toHaveProperty("error.code", "not_found");
    });

    it("should return 409 for duplicate match_key on same host", async () => {
      const mockDb = createMockDb({ insertError: "UNIQUE constraint failed" });
      const app = new Hono<{ Bindings: Env }>();
      app.use("*", mockHostAuth("host_123"));
      app.route("/", agents);

      const res = await app.request(
        "/",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ match_key: "duplicate:/path" }),
        },
        { DB: mockDb, DASHBOARD_SERVICE_TOKEN: "token" }
      );

      expect(res.status).toBe(409);
      const body = await res.json();
      expect(body).toHaveProperty("error.code", "conflict");
    });

    it("should return 400 for invalid JSON body", async () => {
      const mockDb = createMockDb();
      const app = new Hono<{ Bindings: Env }>();
      app.use("*", mockHostAuth("host_123"));
      app.route("/", agents);

      const res = await app.request(
        "/",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "not json",
        },
        { DB: mockDb, DASHBOARD_SERVICE_TOKEN: "token" }
      );

      expect(res.status).toBe(400);
    });
  });
});
