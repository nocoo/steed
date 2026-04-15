import { describe, it, expect, vi } from "vitest";
import { Hono } from "hono";
import { bindings } from "./bindings";
import type { Env } from "../env";
import type { Binding } from "@steed/shared";

// Mock auth middleware for dashboard role
const mockDashboardAuth = async (
  c: { set: (key: string, value: unknown) => void },
  next: () => Promise<void>
) => {
  c.set("auth", { role: "dashboard", hostId: null, invalidToken: false });
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

// Mock auth middleware for host role
const mockHostAuth = (hostId: string) => async (
  c: { set: (key: string, value: unknown) => void },
  next: () => Promise<void>
) => {
  c.set("auth", { role: "host", hostId, invalidToken: false });
  await next();
};

// Binding type for mock data
type MockBinding = {
  agent_id: string;
  data_source_id: string;
  created_at?: string;
};

// Agent type for mock data
type MockAgent = {
  id: string;
  host_id: string;
};

// Data source type for mock data
type MockDataSource = {
  id: string;
  host_id: string;
};

// Create mock D1 database with configurable behavior
function createMockDb(options: {
  bindings?: MockBinding[];
  agents?: MockAgent[];
  dataSources?: MockDataSource[];
} = {}) {
  const bindingsData = [...(options.bindings ?? [])];
  const agentsData = options.agents ?? [];
  const dataSourcesData = options.dataSources ?? [];

  return {
    prepare: vi.fn((sql: string) => ({
      bind: vi.fn((...args: unknown[]) => ({
        run: vi.fn(async () => {
          // Handle INSERT
          if (sql.includes("INSERT INTO agent_data_source_bindings")) {
            const [agentId, dataSourceId] = args as [string, string];
            bindingsData.push({
              agent_id: agentId,
              data_source_id: dataSourceId,
              created_at: new Date().toISOString(),
            });
            return { success: true };
          }
          // Handle DELETE
          if (sql.includes("DELETE FROM agent_data_source_bindings")) {
            const [agentId, dataSourceId] = args as [string, string];
            const index = bindingsData.findIndex(
              b => b.agent_id === agentId && b.data_source_id === dataSourceId
            );
            if (index >= 0) {
              bindingsData.splice(index, 1);
            }
            return { success: true };
          }
          return { success: true };
        }),
        first: vi.fn(async () => {
          // Handle agent lookup
          if (sql.includes("FROM agents") && sql.includes("WHERE id = ?")) {
            const id = args[0] as string;
            return agentsData.find(a => a.id === id) ?? null;
          }
          // Handle data source lookup
          if (sql.includes("FROM data_sources") && sql.includes("WHERE id = ?")) {
            const id = args[0] as string;
            return dataSourcesData.find(ds => ds.id === id) ?? null;
          }
          // Handle binding existence check
          if (sql.includes("FROM agent_data_source_bindings") && sql.includes("WHERE agent_id = ?")) {
            const [agentId, dataSourceId] = args as [string, string];
            const binding = bindingsData.find(
              b => b.agent_id === agentId && b.data_source_id === dataSourceId
            );
            if (binding) {
              return {
                agent_id: binding.agent_id,
                data_source_id: binding.data_source_id,
                created_at: binding.created_at ?? new Date().toISOString(),
              };
            }
            return null;
          }
          return null;
        }),
        all: vi.fn(async () => {
          // Handle list query
          if (sql.includes("FROM agent_data_source_bindings")) {
            let filtered = [...bindingsData];

            // Filter by agent_id if present
            if (sql.includes("agent_id = ?") && !sql.includes("data_source_id = ?")) {
              const agentId = args[0] as string;
              filtered = filtered.filter(b => b.agent_id === agentId);
            }
            // Filter by data_source_id if present (but not agent_id)
            if (sql.includes("data_source_id = ?") && !sql.includes("agent_id = ?")) {
              const dsId = args[0] as string;
              filtered = filtered.filter(b => b.data_source_id === dsId);
            }
            // Filter by both
            if (sql.includes("agent_id = ?") && sql.includes("data_source_id = ?")) {
              const agentId = args[0] as string;
              const dsId = args[1] as string;
              filtered = filtered.filter(b => b.agent_id === agentId && b.data_source_id === dsId);
            }

            return {
              results: filtered.map(b => ({
                agent_id: b.agent_id,
                data_source_id: b.data_source_id,
                created_at: b.created_at ?? new Date().toISOString(),
              })),
            };
          }
          return { results: [] };
        }),
      })),
      run: vi.fn(async () => ({ success: true })),
      first: vi.fn(async () => null),
      all: vi.fn(async () => ({ results: [] })),
    })),
    batch: vi.fn(async () => []),
  } as unknown as D1Database;
}

describe("Bindings Routes", () => {
  describe("Auth", () => {
    it("GET /bindings should reject unauthenticated", async () => {
      const mockDb = createMockDb();
      const app = new Hono<{ Bindings: Env }>();
      app.use("*", mockPublicAuth);
      app.route("/", bindings);

      const res = await app.request(
        "/",
        {},
        { DB: mockDb, DASHBOARD_SERVICE_TOKEN: "token" }
      );

      expect(res.status).toBe(401);
    });

    it("GET /bindings should reject host role", async () => {
      const mockDb = createMockDb();
      const app = new Hono<{ Bindings: Env }>();
      app.use("*", mockHostAuth("host_123"));
      app.route("/", bindings);

      const res = await app.request(
        "/",
        {},
        { DB: mockDb, DASHBOARD_SERVICE_TOKEN: "token" }
      );

      expect(res.status).toBe(403);
    });
  });

  describe("GET /bindings", () => {
    it("should return empty list when no bindings", async () => {
      const mockDb = createMockDb();
      const app = new Hono<{ Bindings: Env }>();
      app.use("*", mockDashboardAuth);
      app.route("/", bindings);

      const res = await app.request(
        "/",
        {},
        { DB: mockDb, DASHBOARD_SERVICE_TOKEN: "token" }
      );

      expect(res.status).toBe(200);
      const body = await res.json() as { data: Binding[]; next_cursor: string | null };
      expect(body.data).toEqual([]);
      expect(body.next_cursor).toBeNull();
    });

    it("should return list of bindings", async () => {
      const mockDb = createMockDb({
        bindings: [
          { agent_id: "agent_1", data_source_id: "ds_1", created_at: "2026-04-15T12:00:00Z" },
          { agent_id: "agent_1", data_source_id: "ds_2", created_at: "2026-04-15T12:01:00Z" },
        ],
      });
      const app = new Hono<{ Bindings: Env }>();
      app.use("*", mockDashboardAuth);
      app.route("/", bindings);

      const res = await app.request(
        "/",
        {},
        { DB: mockDb, DASHBOARD_SERVICE_TOKEN: "token" }
      );

      expect(res.status).toBe(200);
      const body = await res.json() as { data: Binding[] };
      expect(body.data).toHaveLength(2);
      expect(body.data[0]?.agent_id).toBe("agent_1");
    });

    it("should filter by agent_id", async () => {
      const mockDb = createMockDb({
        bindings: [
          { agent_id: "agent_1", data_source_id: "ds_1" },
          { agent_id: "agent_2", data_source_id: "ds_2" },
        ],
      });
      const app = new Hono<{ Bindings: Env }>();
      app.use("*", mockDashboardAuth);
      app.route("/", bindings);

      const res = await app.request(
        "/?agent_id=agent_1",
        {},
        { DB: mockDb, DASHBOARD_SERVICE_TOKEN: "token" }
      );

      expect(res.status).toBe(200);
      const body = await res.json() as { data: Binding[] };
      expect(body.data).toHaveLength(1);
      expect(body.data[0]?.agent_id).toBe("agent_1");
    });

    it("should filter by data_source_id", async () => {
      const mockDb = createMockDb({
        bindings: [
          { agent_id: "agent_1", data_source_id: "ds_1" },
          { agent_id: "agent_2", data_source_id: "ds_2" },
        ],
      });
      const app = new Hono<{ Bindings: Env }>();
      app.use("*", mockDashboardAuth);
      app.route("/", bindings);

      const res = await app.request(
        "/?data_source_id=ds_2",
        {},
        { DB: mockDb, DASHBOARD_SERVICE_TOKEN: "token" }
      );

      expect(res.status).toBe(200);
      const body = await res.json() as { data: Binding[] };
      expect(body.data).toHaveLength(1);
      expect(body.data[0]?.data_source_id).toBe("ds_2");
    });

    it("should respect limit parameter", async () => {
      const mockDb = createMockDb();
      const app = new Hono<{ Bindings: Env }>();
      app.use("*", mockDashboardAuth);
      app.route("/", bindings);

      const res = await app.request(
        "/?limit=10",
        {},
        { DB: mockDb, DASHBOARD_SERVICE_TOKEN: "token" }
      );

      expect(res.status).toBe(200);
    });

    it("should support cursor pagination", async () => {
      const mockDb = createMockDb();
      const app = new Hono<{ Bindings: Env }>();
      app.use("*", mockDashboardAuth);
      app.route("/", bindings);

      const res = await app.request(
        "/?cursor=agent_1:ds_1",
        {},
        { DB: mockDb, DASHBOARD_SERVICE_TOKEN: "token" }
      );

      expect(res.status).toBe(200);
    });

    it("should ignore invalid limit parameter", async () => {
      const mockDb = createMockDb();
      const app = new Hono<{ Bindings: Env }>();
      app.use("*", mockDashboardAuth);
      app.route("/", bindings);

      const res = await app.request(
        "/?limit=invalid",
        {},
        { DB: mockDb, DASHBOARD_SERVICE_TOKEN: "token" }
      );

      expect(res.status).toBe(200);
    });

    it("should cap limit at MAX_LIMIT (200)", async () => {
      const mockDb = createMockDb();
      const app = new Hono<{ Bindings: Env }>();
      app.use("*", mockDashboardAuth);
      app.route("/", bindings);

      const res = await app.request(
        "/?limit=500",
        {},
        { DB: mockDb, DASHBOARD_SERVICE_TOKEN: "token" }
      );

      expect(res.status).toBe(200);
    });
  });

  describe("POST /bindings", () => {
    it("should create a binding", async () => {
      const mockDb = createMockDb({
        agents: [{ id: "agent_1", host_id: "host_123" }],
        dataSources: [{ id: "ds_1", host_id: "host_123" }],
      });
      const app = new Hono<{ Bindings: Env }>();
      app.use("*", mockDashboardAuth);
      app.route("/", bindings);

      const res = await app.request(
        "/",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ agent_id: "agent_1", data_source_id: "ds_1" }),
        },
        { DB: mockDb, DASHBOARD_SERVICE_TOKEN: "token" }
      );

      expect(res.status).toBe(201);
      const body = await res.json() as Binding;
      expect(body.agent_id).toBe("agent_1");
      expect(body.data_source_id).toBe("ds_1");
      expect(body.created_at).toBeDefined();
    });

    it("should return 404 for non-existent agent", async () => {
      const mockDb = createMockDb({
        dataSources: [{ id: "ds_1", host_id: "host_123" }],
      });
      const app = new Hono<{ Bindings: Env }>();
      app.use("*", mockDashboardAuth);
      app.route("/", bindings);

      const res = await app.request(
        "/",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ agent_id: "agent_nonexistent", data_source_id: "ds_1" }),
        },
        { DB: mockDb, DASHBOARD_SERVICE_TOKEN: "token" }
      );

      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error.message).toContain("Agent");
    });

    it("should return 404 for non-existent data source", async () => {
      const mockDb = createMockDb({
        agents: [{ id: "agent_1", host_id: "host_123" }],
      });
      const app = new Hono<{ Bindings: Env }>();
      app.use("*", mockDashboardAuth);
      app.route("/", bindings);

      const res = await app.request(
        "/",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ agent_id: "agent_1", data_source_id: "ds_nonexistent" }),
        },
        { DB: mockDb, DASHBOARD_SERVICE_TOKEN: "token" }
      );

      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error.message).toContain("Data Source");
    });

    it("should return 403 for cross-host binding", async () => {
      const mockDb = createMockDb({
        agents: [{ id: "agent_1", host_id: "host_a" }],
        dataSources: [{ id: "ds_1", host_id: "host_b" }],
      });
      const app = new Hono<{ Bindings: Env }>();
      app.use("*", mockDashboardAuth);
      app.route("/", bindings);

      const res = await app.request(
        "/",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ agent_id: "agent_1", data_source_id: "ds_1" }),
        },
        { DB: mockDb, DASHBOARD_SERVICE_TOKEN: "token" }
      );

      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.error.message).toContain("Cross-host");
    });

    it("should return 409 for duplicate binding", async () => {
      const mockDb = createMockDb({
        agents: [{ id: "agent_1", host_id: "host_123" }],
        dataSources: [{ id: "ds_1", host_id: "host_123" }],
        bindings: [{ agent_id: "agent_1", data_source_id: "ds_1" }],
      });
      const app = new Hono<{ Bindings: Env }>();
      app.use("*", mockDashboardAuth);
      app.route("/", bindings);

      const res = await app.request(
        "/",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ agent_id: "agent_1", data_source_id: "ds_1" }),
        },
        { DB: mockDb, DASHBOARD_SERVICE_TOKEN: "token" }
      );

      expect(res.status).toBe(409);
    });

    it("should return 400 for missing agent_id", async () => {
      const mockDb = createMockDb();
      const app = new Hono<{ Bindings: Env }>();
      app.use("*", mockDashboardAuth);
      app.route("/", bindings);

      const res = await app.request(
        "/",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ data_source_id: "ds_1" }),
        },
        { DB: mockDb, DASHBOARD_SERVICE_TOKEN: "token" }
      );

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error.message).toContain("agent_id");
    });

    it("should return 400 for missing data_source_id", async () => {
      const mockDb = createMockDb();
      const app = new Hono<{ Bindings: Env }>();
      app.use("*", mockDashboardAuth);
      app.route("/", bindings);

      const res = await app.request(
        "/",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ agent_id: "agent_1" }),
        },
        { DB: mockDb, DASHBOARD_SERVICE_TOKEN: "token" }
      );

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error.message).toContain("data_source_id");
    });

    it("should return 400 for invalid JSON body", async () => {
      const mockDb = createMockDb();
      const app = new Hono<{ Bindings: Env }>();
      app.use("*", mockDashboardAuth);
      app.route("/", bindings);

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

  describe("DELETE /bindings", () => {
    it("should delete a binding", async () => {
      const mockDb = createMockDb({
        bindings: [{ agent_id: "agent_1", data_source_id: "ds_1" }],
      });
      const app = new Hono<{ Bindings: Env }>();
      app.use("*", mockDashboardAuth);
      app.route("/", bindings);

      const res = await app.request(
        "/?agent_id=agent_1&data_source_id=ds_1",
        { method: "DELETE" },
        { DB: mockDb, DASHBOARD_SERVICE_TOKEN: "token" }
      );

      expect(res.status).toBe(204);
    });

    it("should return 404 for non-existent binding", async () => {
      const mockDb = createMockDb({ bindings: [] });
      const app = new Hono<{ Bindings: Env }>();
      app.use("*", mockDashboardAuth);
      app.route("/", bindings);

      const res = await app.request(
        "/?agent_id=agent_1&data_source_id=ds_1",
        { method: "DELETE" },
        { DB: mockDb, DASHBOARD_SERVICE_TOKEN: "token" }
      );

      expect(res.status).toBe(404);
    });

    it("should return 400 for missing agent_id", async () => {
      const mockDb = createMockDb();
      const app = new Hono<{ Bindings: Env }>();
      app.use("*", mockDashboardAuth);
      app.route("/", bindings);

      const res = await app.request(
        "/?data_source_id=ds_1",
        { method: "DELETE" },
        { DB: mockDb, DASHBOARD_SERVICE_TOKEN: "token" }
      );

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error.message).toContain("agent_id");
    });

    it("should return 400 for missing data_source_id", async () => {
      const mockDb = createMockDb();
      const app = new Hono<{ Bindings: Env }>();
      app.use("*", mockDashboardAuth);
      app.route("/", bindings);

      const res = await app.request(
        "/?agent_id=agent_1",
        { method: "DELETE" },
        { DB: mockDb, DASHBOARD_SERVICE_TOKEN: "token" }
      );

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error.message).toContain("data_source_id");
    });
  });
});
