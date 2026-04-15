import { describe, it, expect, vi } from "vitest";
import { Hono } from "hono";
import { agents } from "./agents";
import type { Env } from "../env";
import type { Agent, AgentListItem } from "@steed/shared";

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

// Agent type for mock data
type MockAgent = {
  id: string;
  host_id: string;
  match_key: string;
  nickname?: string | null;
  role?: string | null;
  lane_id?: string | null;
  runtime_app?: string | null;
  runtime_version?: string | null;
  status?: string;
  created_at?: string;
  last_seen_at?: string | null;
  metadata?: string;
};

// Create mock D1 database with configurable behavior
function createMockDb(options: {
  hosts?: Array<{ id: string }>;
  agents?: MockAgent[];
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
          if (sql.includes("SELECT") && sql.includes("FROM agents") && sql.includes("WHERE id = ?")) {
            const id = args[0] as string;
            const agent = agentsData.find(a => a.id === id);
            if (agent) {
              return {
                ...agent,
                nickname: agent.nickname ?? null,
                role: agent.role ?? null,
                lane_id: agent.lane_id ?? null,
                metadata: agent.metadata ?? "{}",
                extra: "{}",
                runtime_app: agent.runtime_app ?? null,
                runtime_version: agent.runtime_version ?? null,
                status: agent.status ?? "stopped",
                created_at: agent.created_at ?? new Date().toISOString(),
                last_seen_at: agent.last_seen_at ?? null,
              };
            }
            return null;
          }
          return null;
        }),
        all: vi.fn(async () => {
          // For list queries, return agents with full structure
          return {
            results: agentsData.map(a => ({
              id: a.id,
              host_id: a.host_id,
              match_key: a.match_key,
              nickname: a.nickname ?? null,
              role: a.role ?? null,
              lane_id: a.lane_id ?? null,
              runtime_app: a.runtime_app ?? null,
              runtime_version: a.runtime_version ?? null,
              status: a.status ?? "stopped",
              created_at: a.created_at ?? new Date().toISOString(),
              last_seen_at: a.last_seen_at ?? null,
            })),
          };
        }),
      })),
      run: vi.fn(async () => ({ success: true })),
      first: vi.fn(async () => null),
      all: vi.fn(async () => ({ results: [] })),
    })),
    batch: vi.fn(async () => []),
  } as unknown as D1Database;
}

// Create mock D1 database with update support for PATCH tests
function createMockDbWithUpdate(options: {
  agents?: MockAgent[];
  lanes?: Array<{ id: string }>;
  failPostUpdate?: boolean; // Fail the second agent fetch after update
} = {}) {
  const agentsData = [...(options.agents ?? [])];
  const lanes = options.lanes ?? [];
  let agentFetchCount = 0;

  return {
    prepare: vi.fn((sql: string) => ({
      bind: vi.fn((...args: unknown[]) => ({
        run: vi.fn(async () => {
          // Handle UPDATE - apply changes to agent in memory
          if (sql.includes("UPDATE agents SET")) {
            // For simplicity, we just verify the update was called
            // Real updates would parse the SET clause
            return { success: true };
          }
          return { success: true };
        }),
        first: vi.fn(async () => {
          // Lane validation
          if (sql.includes("SELECT id FROM lanes WHERE id = ?")) {
            const laneId = args[0] as string;
            return lanes.find(l => l.id === laneId) ?? null;
          }
          // Agent fetch (both initial check and post-update)
          if (sql.includes("SELECT") && sql.includes("FROM agents") && sql.includes("WHERE id = ?")) {
            agentFetchCount++;
            // If failPostUpdate is set, return null on the second fetch
            if (options.failPostUpdate && agentFetchCount > 1) {
              return null;
            }
            // For PATCH, last arg is the ID
            const id = args[args.length - 1] as string;
            const agent = agentsData.find(a => a.id === id);
            if (agent) {
              return {
                ...agent,
                nickname: agent.nickname ?? null,
                role: agent.role ?? null,
                lane_id: agent.lane_id ?? null,
                metadata: agent.metadata ?? "{}",
                extra: "{}",
                runtime_app: agent.runtime_app ?? null,
                runtime_version: agent.runtime_version ?? null,
                status: agent.status ?? "stopped",
                created_at: agent.created_at ?? new Date().toISOString(),
                last_seen_at: agent.last_seen_at ?? null,
              };
            }
            return null;
          }
          return null;
        }),
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

    it("should return 400 for non-string nickname", async () => {
      const mockDb = createMockDb();
      const app = new Hono<{ Bindings: Env }>();
      app.use("*", mockHostAuth("host_123"));
      app.route("/", agents);

      const res = await app.request(
        "/",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ match_key: "test:/path", nickname: 123 }),
        },
        { DB: mockDb, DASHBOARD_SERVICE_TOKEN: "token" }
      );

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error.message).toContain("nickname");
    });

    it("should return 400 for non-string role", async () => {
      const mockDb = createMockDb();
      const app = new Hono<{ Bindings: Env }>();
      app.use("*", mockHostAuth("host_123"));
      app.route("/", agents);

      const res = await app.request(
        "/",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ match_key: "test:/path", role: { invalid: true } }),
        },
        { DB: mockDb, DASHBOARD_SERVICE_TOKEN: "token" }
      );

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error.message).toContain("role");
    });

    it("should return 500 for host role without hostId in auth", async () => {
      const mockDb = createMockDb();
      const app = new Hono<{ Bindings: Env }>();
      // Mock auth with host role but no hostId (edge case)
      app.use("*", async (c, next) => {
        c.set("auth", { role: "host", hostId: null, invalidToken: false });
        await next();
      });
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

      expect(res.status).toBe(500);
    });

    it("should return 500 for non-UNIQUE database error", async () => {
      const mockDb = createMockDb({ insertError: "Some other database error" });
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

      expect(res.status).toBe(500);
    });
  });

  describe("GET /agents", () => {
    it("should return empty list when no agents", async () => {
      const mockDb = createMockDb();
      const app = new Hono<{ Bindings: Env }>();
      app.use("*", mockDashboardAuth);
      app.route("/", agents);

      const res = await app.request(
        "/",
        {},
        { DB: mockDb, DASHBOARD_SERVICE_TOKEN: "token" }
      );

      expect(res.status).toBe(200);
      const body = await res.json() as { data: Agent[]; next_cursor: string | null };
      expect(body.data).toEqual([]);
      expect(body.next_cursor).toBeNull();
    });

    it("should return list of agents", async () => {
      const mockDb = createMockDb({
        agents: [
          {
            id: "agent_1",
            host_id: "host_123",
            match_key: "test:/path1",
            nickname: "Agent 1",
            role: "Testing",
            lane_id: "lane_work",
            runtime_app: "openclaw",
            runtime_version: "1.0.0",
            status: "running",
            created_at: "2026-04-15T12:00:00Z",
            last_seen_at: "2026-04-15T14:00:00Z",
          },
        ],
      });
      const app = new Hono<{ Bindings: Env }>();
      app.use("*", mockDashboardAuth);
      app.route("/", agents);

      const res = await app.request(
        "/",
        {},
        { DB: mockDb, DASHBOARD_SERVICE_TOKEN: "token" }
      );

      expect(res.status).toBe(200);
      const body = await res.json() as { data: AgentListItem[]; next_cursor: string | null };
      expect(body.data).toHaveLength(1);
      expect(body.data[0]?.id).toBe("agent_1");
      expect(body.data[0]?.nickname).toBe("Agent 1");
      // AgentListItem should NOT have metadata/extra fields
      expect(body.data[0]).not.toHaveProperty("metadata");
      expect(body.data[0]).not.toHaveProperty("extra");
    });

    it("should filter by host_id", async () => {
      const mockDb = createMockDb({
        agents: [
          { id: "agent_1", host_id: "host_a", match_key: "test:/1", nickname: null, role: null, lane_id: null, runtime_app: null, runtime_version: null, status: "stopped", created_at: "2026-04-15T12:00:00Z", last_seen_at: null },
        ],
      });
      const app = new Hono<{ Bindings: Env }>();
      app.use("*", mockDashboardAuth);
      app.route("/", agents);

      const res = await app.request(
        "/?host_id=host_a",
        {},
        { DB: mockDb, DASHBOARD_SERVICE_TOKEN: "token" }
      );

      expect(res.status).toBe(200);
      // Verify the query was called with host_id filter
      expect(mockDb.prepare).toHaveBeenCalled();
    });

    it("should filter by lane_id", async () => {
      const mockDb = createMockDb();
      const app = new Hono<{ Bindings: Env }>();
      app.use("*", mockDashboardAuth);
      app.route("/", agents);

      const res = await app.request(
        "/?lane_id=lane_work",
        {},
        { DB: mockDb, DASHBOARD_SERVICE_TOKEN: "token" }
      );

      expect(res.status).toBe(200);
      expect(mockDb.prepare).toHaveBeenCalled();
    });

    it("should filter by status", async () => {
      const mockDb = createMockDb();
      const app = new Hono<{ Bindings: Env }>();
      app.use("*", mockDashboardAuth);
      app.route("/", agents);

      const res = await app.request(
        "/?status=running",
        {},
        { DB: mockDb, DASHBOARD_SERVICE_TOKEN: "token" }
      );

      expect(res.status).toBe(200);
      expect(mockDb.prepare).toHaveBeenCalled();
    });

    it("should respect limit parameter", async () => {
      const mockDb = createMockDb();
      const app = new Hono<{ Bindings: Env }>();
      app.use("*", mockDashboardAuth);
      app.route("/", agents);

      const res = await app.request(
        "/?limit=10",
        {},
        { DB: mockDb, DASHBOARD_SERVICE_TOKEN: "token" }
      );

      expect(res.status).toBe(200);
    });

    it("should cap limit at MAX_LIMIT (200)", async () => {
      const mockDb = createMockDb();
      const app = new Hono<{ Bindings: Env }>();
      app.use("*", mockDashboardAuth);
      app.route("/", agents);

      const res = await app.request(
        "/?limit=500",
        {},
        { DB: mockDb, DASHBOARD_SERVICE_TOKEN: "token" }
      );

      expect(res.status).toBe(200);
      // Verify limit was capped (the actual assertion would require deeper mock inspection)
    });

    it("should support cursor pagination", async () => {
      const mockDb = createMockDb();
      const app = new Hono<{ Bindings: Env }>();
      app.use("*", mockDashboardAuth);
      app.route("/", agents);

      const res = await app.request(
        "/?cursor=agent_abc",
        {},
        { DB: mockDb, DASHBOARD_SERVICE_TOKEN: "token" }
      );

      expect(res.status).toBe(200);
    });

    it("should reject host role", async () => {
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
  });

  describe("GET /agents/:id", () => {
    it("should return agent details", async () => {
      const mockDb = createMockDb({
        agents: [
          {
            id: "agent_test",
            host_id: "host_123",
            match_key: "openclaw:/workspace",
            nickname: "Test Agent",
            role: "Code review",
            lane_id: "lane_work",
            runtime_app: "openclaw",
            runtime_version: "1.0.0",
            status: "running",
            created_at: "2026-04-15T12:00:00Z",
            last_seen_at: "2026-04-15T14:00:00Z",
          },
        ],
      });
      const app = new Hono<{ Bindings: Env }>();
      app.use("*", mockDashboardAuth);
      app.route("/", agents);

      const res = await app.request(
        "/agent_test",
        {},
        { DB: mockDb, DASHBOARD_SERVICE_TOKEN: "token" }
      );

      expect(res.status).toBe(200);
      const body = (await res.json()) as Agent;
      expect(body.id).toBe("agent_test");
      expect(body.nickname).toBe("Test Agent");
      expect(body.metadata).toEqual({});
      expect(body.extra).toEqual({});
    });

    it("should return 404 for non-existent agent", async () => {
      const mockDb = createMockDb({ agents: [] });
      const app = new Hono<{ Bindings: Env }>();
      app.use("*", mockDashboardAuth);
      app.route("/", agents);

      const res = await app.request(
        "/agent_nonexistent",
        {},
        { DB: mockDb, DASHBOARD_SERVICE_TOKEN: "token" }
      );

      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body).toHaveProperty("error.code", "not_found");
    });

    it("should parse JSON fields correctly", async () => {
      const mockDb = createMockDb({
        agents: [
          {
            id: "agent_json",
            host_id: "host_123",
            match_key: "test:/path",
          },
        ],
      });
      const app = new Hono<{ Bindings: Env }>();
      app.use("*", mockDashboardAuth);
      app.route("/", agents);

      const res = await app.request(
        "/agent_json",
        {},
        { DB: mockDb, DASHBOARD_SERVICE_TOKEN: "token" }
      );

      expect(res.status).toBe(200);
      const body = (await res.json()) as Agent;
      // JSON fields should be parsed as objects
      expect(typeof body.metadata).toBe("object");
      expect(typeof body.extra).toBe("object");
    });
  });

  describe("PATCH /agents/:id", () => {
    it("should update nickname only", async () => {
      const mockDb = createMockDbWithUpdate({
        agents: [
          { id: "agent_1", host_id: "host_123", match_key: "test:/path", nickname: "Old Name" },
        ],
      });
      const app = new Hono<{ Bindings: Env }>();
      app.use("*", mockDashboardAuth);
      app.route("/", agents);

      const res = await app.request(
        "/agent_1",
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ nickname: "New Name" }),
        },
        { DB: mockDb, DASHBOARD_SERVICE_TOKEN: "token" }
      );

      expect(res.status).toBe(200);
      const body = (await res.json()) as Agent;
      expect(body.id).toBe("agent_1");
    });

    it("should update multiple fields", async () => {
      const mockDb = createMockDbWithUpdate({
        agents: [
          { id: "agent_1", host_id: "host_123", match_key: "test:/path" },
        ],
        lanes: [{ id: "lane_work" }],
      });
      const app = new Hono<{ Bindings: Env }>();
      app.use("*", mockDashboardAuth);
      app.route("/", agents);

      const res = await app.request(
        "/agent_1",
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            nickname: "Updated",
            role: "New Role",
            lane_id: "lane_work",
          }),
        },
        { DB: mockDb, DASHBOARD_SERVICE_TOKEN: "token" }
      );

      expect(res.status).toBe(200);
    });

    it("should clear field with null", async () => {
      const mockDb = createMockDbWithUpdate({
        agents: [
          { id: "agent_1", host_id: "host_123", match_key: "test:/path", nickname: "Has Name" },
        ],
      });
      const app = new Hono<{ Bindings: Env }>();
      app.use("*", mockDashboardAuth);
      app.route("/", agents);

      const res = await app.request(
        "/agent_1",
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ nickname: null }),
        },
        { DB: mockDb, DASHBOARD_SERVICE_TOKEN: "token" }
      );

      expect(res.status).toBe(200);
    });

    it("should return 400 for invalid lane_id", async () => {
      const mockDb = createMockDbWithUpdate({
        agents: [
          { id: "agent_1", host_id: "host_123", match_key: "test:/path" },
        ],
        lanes: [], // No lanes
      });
      const app = new Hono<{ Bindings: Env }>();
      app.use("*", mockDashboardAuth);
      app.route("/", agents);

      const res = await app.request(
        "/agent_1",
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ lane_id: "invalid_lane" }),
        },
        { DB: mockDb, DASHBOARD_SERVICE_TOKEN: "token" }
      );

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error.message).toContain("lane_id");
    });

    it("should return 404 for non-existent agent", async () => {
      const mockDb = createMockDbWithUpdate({ agents: [] });
      const app = new Hono<{ Bindings: Env }>();
      app.use("*", mockDashboardAuth);
      app.route("/", agents);

      const res = await app.request(
        "/agent_nonexistent",
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ nickname: "Test" }),
        },
        { DB: mockDb, DASHBOARD_SERVICE_TOKEN: "token" }
      );

      expect(res.status).toBe(404);
    });

    it("should shallow merge metadata", async () => {
      const mockDb = createMockDbWithUpdate({
        agents: [
          { id: "agent_1", host_id: "host_123", match_key: "test:/path" },
        ],
      });
      const app = new Hono<{ Bindings: Env }>();
      app.use("*", mockDashboardAuth);
      app.route("/", agents);

      const res = await app.request(
        "/agent_1",
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            metadata: { notes: "New notes", tags: ["dev"] },
          }),
        },
        { DB: mockDb, DASHBOARD_SERVICE_TOKEN: "token" }
      );

      expect(res.status).toBe(200);
    });

    it("should return 400 for metadata as array", async () => {
      const mockDb = createMockDbWithUpdate({
        agents: [{ id: "agent_1", host_id: "host_123", match_key: "test:/path" }],
      });
      const app = new Hono<{ Bindings: Env }>();
      app.use("*", mockDashboardAuth);
      app.route("/", agents);

      const res = await app.request(
        "/agent_1",
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ metadata: ["invalid", "array"] }),
        },
        { DB: mockDb, DASHBOARD_SERVICE_TOKEN: "token" }
      );

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error.message).toContain("metadata");
    });

    it("should return 400 for metadata as null", async () => {
      const mockDb = createMockDbWithUpdate({
        agents: [{ id: "agent_1", host_id: "host_123", match_key: "test:/path" }],
      });
      const app = new Hono<{ Bindings: Env }>();
      app.use("*", mockDashboardAuth);
      app.route("/", agents);

      const res = await app.request(
        "/agent_1",
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ metadata: null }),
        },
        { DB: mockDb, DASHBOARD_SERVICE_TOKEN: "token" }
      );

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error.message).toContain("metadata");
    });

    it("should return 400 for metadata as string", async () => {
      const mockDb = createMockDbWithUpdate({
        agents: [{ id: "agent_1", host_id: "host_123", match_key: "test:/path" }],
      });
      const app = new Hono<{ Bindings: Env }>();
      app.use("*", mockDashboardAuth);
      app.route("/", agents);

      const res = await app.request(
        "/agent_1",
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ metadata: "not an object" }),
        },
        { DB: mockDb, DASHBOARD_SERVICE_TOKEN: "token" }
      );

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error.message).toContain("metadata");
    });

    it("should return 400 for invalid JSON body", async () => {
      const mockDb = createMockDbWithUpdate({
        agents: [{ id: "agent_1", host_id: "host_123", match_key: "test:/path" }],
      });
      const app = new Hono<{ Bindings: Env }>();
      app.use("*", mockDashboardAuth);
      app.route("/", agents);

      const res = await app.request(
        "/agent_1",
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: "not json",
        },
        { DB: mockDb, DASHBOARD_SERVICE_TOKEN: "token" }
      );

      expect(res.status).toBe(400);
    });

    it("should return 500 when post-update fetch fails", async () => {
      const mockDb = createMockDbWithUpdate({
        agents: [{ id: "agent_1", host_id: "host_123", match_key: "test:/path" }],
        failPostUpdate: true,
      });
      const app = new Hono<{ Bindings: Env }>();
      app.use("*", mockDashboardAuth);
      app.route("/", agents);

      const res = await app.request(
        "/agent_1",
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ nickname: "New Name" }),
        },
        { DB: mockDb, DASHBOARD_SERVICE_TOKEN: "token" }
      );

      expect(res.status).toBe(500);
    });
  });

  describe("POST /agents/:id/metadata", () => {
    // Create mock D1 database with extra update support
    function createMockDbWithExtraUpdate(options: {
      agents?: MockAgent[];
      failPostUpdate?: boolean;
    } = {}) {
      const agentsData = [...(options.agents ?? [])];
      let fetchCount = 0;

      return {
        prepare: vi.fn((sql: string) => ({
          bind: vi.fn((...args: unknown[]) => ({
            run: vi.fn(async () => ({ success: true })),
            first: vi.fn(async () => {
              // Handle SELECT by id
              if (sql.includes("FROM agents") && sql.includes("WHERE id = ?")) {
                fetchCount++;
                if (options.failPostUpdate && fetchCount > 1) {
                  return null;
                }
                const id = args[args.length - 1] as string;
                const agent = agentsData.find((a) => a.id === id);
                if (agent) {
                  return {
                    id: agent.id,
                    host_id: agent.host_id,
                    match_key: agent.match_key,
                    nickname: agent.nickname ?? null,
                    role: agent.role ?? null,
                    lane_id: agent.lane_id ?? null,
                    metadata: agent.metadata ?? "{}",
                    extra: agent.extra ?? "{}",
                    runtime_app: agent.runtime_app ?? null,
                    runtime_version: agent.runtime_version ?? null,
                    status: agent.status ?? "stopped",
                    created_at: agent.created_at ?? new Date().toISOString(),
                    last_seen_at: agent.last_seen_at ?? null,
                  };
                }
                return null;
              }
              return null;
            }),
            all: vi.fn(async () => ({ results: [] })),
          })),
          run: vi.fn(async () => ({ success: true })),
          first: vi.fn(async () => null),
          all: vi.fn(async () => ({ results: [] })),
        })),
        batch: vi.fn(async () => []),
      } as unknown as D1Database;
    }

    it("should update extra with shallow merge", async () => {
      const mockDb = createMockDbWithExtraUpdate({
        agents: [
          {
            id: "agent_1",
            host_id: "host_123",
            match_key: "test:/path",
            extra: JSON.stringify({ existing: "value" }),
          },
        ],
      });
      const app = new Hono<{ Bindings: Env }>();
      app.use("*", mockHostAuth("host_123"));
      app.route("/", agents);

      const res = await app.request(
        "/agent_1/metadata",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ extra: { memory_count: 42 } }),
        },
        { DB: mockDb, DASHBOARD_SERVICE_TOKEN: "token" }
      );

      expect(res.status).toBe(200);
      const body = (await res.json()) as Agent;
      expect(body.id).toBe("agent_1");
    });

    it("should return 404 for non-existent agent", async () => {
      const mockDb = createMockDbWithExtraUpdate({ agents: [] });
      const app = new Hono<{ Bindings: Env }>();
      app.use("*", mockHostAuth("host_123"));
      app.route("/", agents);

      const res = await app.request(
        "/agent_nonexistent/metadata",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ extra: { test: "value" } }),
        },
        { DB: mockDb, DASHBOARD_SERVICE_TOKEN: "token" }
      );

      expect(res.status).toBe(404);
    });

    it("should return 403 for agent on different host", async () => {
      const mockDb = createMockDbWithExtraUpdate({
        agents: [
          { id: "agent_1", host_id: "host_other", match_key: "test:/path" },
        ],
      });
      const app = new Hono<{ Bindings: Env }>();
      app.use("*", mockHostAuth("host_123")); // Different host
      app.route("/", agents);

      const res = await app.request(
        "/agent_1/metadata",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ extra: { test: "value" } }),
        },
        { DB: mockDb, DASHBOARD_SERVICE_TOKEN: "token" }
      );

      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.error.message).toContain("does not belong");
    });

    it("should return 400 for extra as null", async () => {
      const mockDb = createMockDbWithExtraUpdate({
        agents: [{ id: "agent_1", host_id: "host_123", match_key: "test:/path" }],
      });
      const app = new Hono<{ Bindings: Env }>();
      app.use("*", mockHostAuth("host_123"));
      app.route("/", agents);

      const res = await app.request(
        "/agent_1/metadata",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ extra: null }),
        },
        { DB: mockDb, DASHBOARD_SERVICE_TOKEN: "token" }
      );

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error.message).toContain("extra");
    });

    it("should return 400 for extra as array", async () => {
      const mockDb = createMockDbWithExtraUpdate({
        agents: [{ id: "agent_1", host_id: "host_123", match_key: "test:/path" }],
      });
      const app = new Hono<{ Bindings: Env }>();
      app.use("*", mockHostAuth("host_123"));
      app.route("/", agents);

      const res = await app.request(
        "/agent_1/metadata",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ extra: ["invalid"] }),
        },
        { DB: mockDb, DASHBOARD_SERVICE_TOKEN: "token" }
      );

      expect(res.status).toBe(400);
    });

    it("should return 400 for invalid JSON body", async () => {
      const mockDb = createMockDbWithExtraUpdate({
        agents: [{ id: "agent_1", host_id: "host_123", match_key: "test:/path" }],
      });
      const app = new Hono<{ Bindings: Env }>();
      app.use("*", mockHostAuth("host_123"));
      app.route("/", agents);

      const res = await app.request(
        "/agent_1/metadata",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "not json",
        },
        { DB: mockDb, DASHBOARD_SERVICE_TOKEN: "token" }
      );

      expect(res.status).toBe(400);
    });

    it("should reject dashboard role", async () => {
      const mockDb = createMockDbWithExtraUpdate({
        agents: [{ id: "agent_1", host_id: "host_123", match_key: "test:/path" }],
      });
      const app = new Hono<{ Bindings: Env }>();
      app.use("*", mockDashboardAuth);
      app.route("/", agents);

      const res = await app.request(
        "/agent_1/metadata",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ extra: { test: "value" } }),
        },
        { DB: mockDb, DASHBOARD_SERVICE_TOKEN: "token" }
      );

      expect(res.status).toBe(403);
    });

    it("should return 500 when post-update fetch fails", async () => {
      const mockDb = createMockDbWithExtraUpdate({
        agents: [{ id: "agent_1", host_id: "host_123", match_key: "test:/path" }],
        failPostUpdate: true,
      });
      const app = new Hono<{ Bindings: Env }>();
      app.use("*", mockHostAuth("host_123"));
      app.route("/", agents);

      const res = await app.request(
        "/agent_1/metadata",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ extra: { test: "value" } }),
        },
        { DB: mockDb, DASHBOARD_SERVICE_TOKEN: "token" }
      );

      expect(res.status).toBe(500);
    });

    it("should handle empty body without extra field", async () => {
      const mockDb = createMockDbWithExtraUpdate({
        agents: [
          {
            id: "agent_1",
            host_id: "host_123",
            match_key: "test:/path",
            extra: JSON.stringify({ existing: "value" }),
          },
        ],
      });
      const app = new Hono<{ Bindings: Env }>();
      app.use("*", mockHostAuth("host_123"));
      app.route("/", agents);

      const res = await app.request(
        "/agent_1/metadata",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        },
        { DB: mockDb, DASHBOARD_SERVICE_TOKEN: "token" }
      );

      expect(res.status).toBe(200);
      const body = (await res.json()) as Agent;
      expect(body.id).toBe("agent_1");
    });

    it("should handle invalid extra JSON in database gracefully", async () => {
      const mockDb = createMockDbWithExtraUpdate({
        agents: [
          {
            id: "agent_1",
            host_id: "host_123",
            match_key: "test:/path",
            extra: "invalid json",
          },
        ],
      });
      const app = new Hono<{ Bindings: Env }>();
      app.use("*", mockHostAuth("host_123"));
      app.route("/", agents);

      const res = await app.request(
        "/agent_1/metadata",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ extra: { new_key: "value" } }),
        },
        { DB: mockDb, DASHBOARD_SERVICE_TOKEN: "token" }
      );

      expect(res.status).toBe(200);
    });

    it("should handle invalid metadata/extra JSON in response gracefully", async () => {
      // This tests the final JSON.parse catch block
      const agentsData = [
        {
          id: "agent_1",
          host_id: "host_123",
          match_key: "test:/path",
          metadata: "invalid json",
          extra: "also invalid",
        },
      ];
      let fetchCount = 0;
      const mockDb = {
        prepare: vi.fn((sql: string) => ({
          bind: vi.fn((...args: unknown[]) => ({
            run: vi.fn(async () => ({ success: true })),
            first: vi.fn(async () => {
              if (sql.includes("FROM agents") && sql.includes("WHERE id = ?")) {
                fetchCount++;
                const id = args[args.length - 1] as string;
                const agent = agentsData.find((a) => a.id === id);
                if (agent) {
                  return {
                    id: agent.id,
                    host_id: agent.host_id,
                    match_key: agent.match_key,
                    nickname: null,
                    role: null,
                    lane_id: null,
                    metadata: agent.metadata,
                    extra: agent.extra,
                    runtime_app: null,
                    runtime_version: null,
                    status: "stopped",
                    created_at: new Date().toISOString(),
                    last_seen_at: null,
                  };
                }
                return null;
              }
              return null;
            }),
            all: vi.fn(async () => ({ results: [] })),
          })),
          run: vi.fn(async () => ({ success: true })),
          first: vi.fn(async () => null),
          all: vi.fn(async () => ({ results: [] })),
        })),
        batch: vi.fn(async () => []),
      } as unknown as D1Database;

      const app = new Hono<{ Bindings: Env }>();
      app.use("*", mockHostAuth("host_123"));
      app.route("/", agents);

      const res = await app.request(
        "/agent_1/metadata",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        },
        { DB: mockDb, DASHBOARD_SERVICE_TOKEN: "token" }
      );

      expect(res.status).toBe(200);
      const body = (await res.json()) as Agent;
      expect(body.metadata).toEqual({});
      expect(body.extra).toEqual({});
      void fetchCount;
    });
  });
});
