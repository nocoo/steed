import { describe, it, expect, vi } from "vitest";
import { Hono } from "hono";
import { snapshot } from "./snapshot";
import type { Env } from "../env";
import type { SnapshotRequest, SnapshotResponse } from "@steed/shared";

// Mock auth middleware that sets host role
const mockHostAuth = (hostId: string) => async (
  c: { set: (key: string, value: unknown) => void },
  next: () => Promise<void>
) => {
  c.set("auth", { role: "host", hostId, invalidToken: false });
  await next();
};

// Mock auth for dashboard (should be rejected)
const mockDashboardAuth = async (
  c: { set: (key: string, value: unknown) => void },
  next: () => Promise<void>
) => {
  c.set("auth", { role: "dashboard", hostId: null, invalidToken: false });
  await next();
};

// Create mock D1 database for snapshot testing
// Supports both read operations (all) and batched writes (batch)
function createMockDb(options: {
  existingAgents?: Array<{
    id: string;
    host_id: string;
    match_key: string;
    status: string;
  }>;
  existingDataSources?: Array<{
    id: string;
    host_id: string;
    type: string;
    name: string;
    status: string;
  }>;
} = {}) {
  const agents = options.existingAgents ?? [];
  const dataSources = options.existingDataSources ?? [];
  const batchedStatements: Array<{ sql: string; args: unknown[] }> = [];

  // Track what statements were batched
  const createStatement = (sql: string) => ({
    bind: vi.fn((...args: unknown[]) => {
      // Store the statement for batch execution
      const statement = { sql, args, _isBound: true };
      return {
        ...statement,
        run: vi.fn(async () => ({ success: true })),
        all: vi.fn(async () => {
          if (sql.includes("SELECT id, match_key FROM agents WHERE host_id = ?")) {
            const [hostId] = args as [string];
            const hostAgents = agents.filter(a => a.host_id === hostId);
            return { results: hostAgents };
          }
          if (sql.includes("SELECT id, type, name FROM data_sources WHERE host_id = ?")) {
            const [hostId] = args as [string];
            const hostDs = dataSources.filter(d => d.host_id === hostId);
            return { results: hostDs };
          }
          return { results: [] };
        }),
      };
    }),
  });

  return {
    prepare: vi.fn((sql: string) => createStatement(sql)),
    batch: vi.fn(async (statements: Array<{ sql: string; args: unknown[] }>) => {
      // Record all batched statements for verification
      for (const stmt of statements) {
        if ("sql" in stmt || "_isBound" in stmt) {
          batchedStatements.push(stmt as { sql: string; args: unknown[] });
        }
      }
      return statements.map(() => ({ success: true }));
    }),
    _getBatchedStatements: () => batchedStatements,
    _getAgents: () => agents,
    _getDataSources: () => dataSources,
  } as unknown as D1Database & {
    _getBatchedStatements: () => Array<{ sql: string; args: unknown[] }>;
    _getAgents: () => typeof agents;
    _getDataSources: () => typeof dataSources;
  };
}

describe("Snapshot Routes", () => {
  describe("POST /", () => {
    it("should require host role", async () => {
      const mockDb = createMockDb();
      const app = new Hono<{ Bindings: Env }>();
      app.use("*", mockDashboardAuth);
      app.route("/", snapshot);

      const res = await app.request(
        "/",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ agents: [], data_sources: [] }),
        },
        { DB: mockDb, DASHBOARD_SERVICE_TOKEN: "token" }
      );

      expect(res.status).toBe(403);
    });

    it("should return 400 on invalid JSON", async () => {
      const mockDb = createMockDb();
      const app = new Hono<{ Bindings: Env }>();
      app.use("*", mockHostAuth("host_123"));
      app.route("/", snapshot);

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
      const body = await res.json();
      expect(body).toHaveProperty("error.code", "invalid_request");
    });

    it("should update host.last_seen_at via batch", async () => {
      const mockDb = createMockDb();
      const app = new Hono<{ Bindings: Env }>();
      app.use("*", mockHostAuth("host_123"));
      app.route("/", snapshot);

      const request: SnapshotRequest = { agents: [], data_sources: [] };
      const res = await app.request(
        "/",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(request),
        },
        { DB: mockDb, DASHBOARD_SERVICE_TOKEN: "token" }
      );

      expect(res.status).toBe(200);
      // Verify batch was called (host update is always included)
      expect(mockDb.batch).toHaveBeenCalled();
    });

    it("should update existing agent with snapshot data", async () => {
      const mockDb = createMockDb({
        existingAgents: [
          { id: "agent_1", host_id: "host_123", match_key: "openclaw:/workspace", status: "stopped" },
        ],
      });
      const app = new Hono<{ Bindings: Env }>();
      app.use("*", mockHostAuth("host_123"));
      app.route("/", snapshot);

      const request: SnapshotRequest = {
        agents: [
          {
            match_key: "openclaw:/workspace",
            runtime_app: "openclaw",
            runtime_version: "0.3.2",
            status: "running",
          },
        ],
        data_sources: [],
      };

      const res = await app.request(
        "/",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(request),
        },
        { DB: mockDb, DASHBOARD_SERVICE_TOKEN: "token" }
      );

      expect(res.status).toBe(200);
      const body = (await res.json()) as SnapshotResponse;
      expect(body.host_id).toBe("host_123");
      expect(body.agents_updated).toBe(1);
      expect(body.agents_missing).toBe(0);
      // Verify batch was called with statements
      expect(mockDb.batch).toHaveBeenCalled();
    });

    it("should ignore unregistered agents", async () => {
      const mockDb = createMockDb({ existingAgents: [] });
      const app = new Hono<{ Bindings: Env }>();
      app.use("*", mockHostAuth("host_123"));
      app.route("/", snapshot);

      const request: SnapshotRequest = {
        agents: [
          {
            match_key: "new-agent:/path",
            runtime_app: "new-agent",
            runtime_version: "1.0.0",
            status: "running",
          },
        ],
        data_sources: [],
      };

      const res = await app.request(
        "/",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(request),
        },
        { DB: mockDb, DASHBOARD_SERVICE_TOKEN: "token" }
      );

      expect(res.status).toBe(200);
      const body = (await res.json()) as SnapshotResponse;
      expect(body.agents_updated).toBe(0);
    });

    it("should mark missing agents as status=missing", async () => {
      const mockDb = createMockDb({
        existingAgents: [
          { id: "agent_1", host_id: "host_123", match_key: "openclaw:/workspace", status: "running" },
          { id: "agent_2", host_id: "host_123", match_key: "hermes:/other", status: "running" },
        ],
      });
      const app = new Hono<{ Bindings: Env }>();
      app.use("*", mockHostAuth("host_123"));
      app.route("/", snapshot);

      // Only report agent_1, agent_2 should become missing
      const request: SnapshotRequest = {
        agents: [
          {
            match_key: "openclaw:/workspace",
            runtime_app: "openclaw",
            runtime_version: "0.3.2",
            status: "running",
          },
        ],
        data_sources: [],
      };

      const res = await app.request(
        "/",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(request),
        },
        { DB: mockDb, DASHBOARD_SERVICE_TOKEN: "token" }
      );

      expect(res.status).toBe(200);
      const body = (await res.json()) as SnapshotResponse;
      expect(body.agents_updated).toBe(1);
      expect(body.agents_missing).toBe(1);
      // Verify batch was called
      expect(mockDb.batch).toHaveBeenCalled();
    });

    it("should not mark agents from other hosts as missing", async () => {
      const mockDb = createMockDb({
        existingAgents: [
          { id: "agent_1", host_id: "host_123", match_key: "openclaw:/workspace", status: "running" },
          { id: "agent_other", host_id: "host_other", match_key: "hermes:/other", status: "running" },
        ],
      });
      const app = new Hono<{ Bindings: Env }>();
      app.use("*", mockHostAuth("host_123"));
      app.route("/", snapshot);

      // Empty snapshot - only host_123's agents should be marked missing
      const request: SnapshotRequest = { agents: [], data_sources: [] };

      const res = await app.request(
        "/",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(request),
        },
        { DB: mockDb, DASHBOARD_SERVICE_TOKEN: "token" }
      );

      expect(res.status).toBe(200);
      const body = (await res.json()) as SnapshotResponse;
      expect(body.agents_missing).toBe(1); // Only agent_1
    });

    it("should handle empty agents array", async () => {
      const mockDb = createMockDb();
      const app = new Hono<{ Bindings: Env }>();
      app.use("*", mockHostAuth("host_123"));
      app.route("/", snapshot);

      const request: SnapshotRequest = { agents: [], data_sources: [] };

      const res = await app.request(
        "/",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(request),
        },
        { DB: mockDb, DASHBOARD_SERVICE_TOKEN: "token" }
      );

      expect(res.status).toBe(200);
      const body = (await res.json()) as SnapshotResponse;
      expect(body.agents_updated).toBe(0);
      expect(body.agents_missing).toBe(0);
    });

    it("should handle missing agents field gracefully", async () => {
      const mockDb = createMockDb();
      const app = new Hono<{ Bindings: Env }>();
      app.use("*", mockHostAuth("host_123"));
      app.route("/", snapshot);

      const res = await app.request(
        "/",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ data_sources: [] }),
        },
        { DB: mockDb, DASHBOARD_SERVICE_TOKEN: "token" }
      );

      expect(res.status).toBe(200);
      const body = (await res.json()) as SnapshotResponse;
      expect(body.agents_updated).toBe(0);
    });
  });

  describe("Data Source upsert", () => {
    it("should create new data source when not exists", async () => {
      const mockDb = createMockDb({ existingDataSources: [] });
      const app = new Hono<{ Bindings: Env }>();
      app.use("*", mockHostAuth("host_123"));
      app.route("/", snapshot);

      const request: SnapshotRequest = {
        agents: [],
        data_sources: [
          {
            type: "personal_cli",
            name: "nmem",
            version: "1.2.0",
            auth_status: "authenticated",
          },
        ],
      };

      const res = await app.request(
        "/",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(request),
        },
        { DB: mockDb, DASHBOARD_SERVICE_TOKEN: "token" }
      );

      expect(res.status).toBe(200);
      const body = (await res.json()) as SnapshotResponse;
      expect(body.data_sources_created).toBe(1);
      expect(body.data_sources_updated).toBe(0);
      // Verify batch was called
      expect(mockDb.batch).toHaveBeenCalled();
    });

    it("should update existing data source", async () => {
      const mockDb = createMockDb({
        existingDataSources: [
          { id: "ds_1", host_id: "host_123", type: "personal_cli", name: "nmem", status: "active" },
        ],
      });
      const app = new Hono<{ Bindings: Env }>();
      app.use("*", mockHostAuth("host_123"));
      app.route("/", snapshot);

      const request: SnapshotRequest = {
        agents: [],
        data_sources: [
          {
            type: "personal_cli",
            name: "nmem",
            version: "1.3.0",
            auth_status: "authenticated",
          },
        ],
      };

      const res = await app.request(
        "/",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(request),
        },
        { DB: mockDb, DASHBOARD_SERVICE_TOKEN: "token" }
      );

      expect(res.status).toBe(200);
      const body = (await res.json()) as SnapshotResponse;
      expect(body.data_sources_updated).toBe(1);
      expect(body.data_sources_created).toBe(0);
      // Verify batch was called
      expect(mockDb.batch).toHaveBeenCalled();
    });

    it("should mark missing data sources as status=missing", async () => {
      const mockDb = createMockDb({
        existingDataSources: [
          { id: "ds_1", host_id: "host_123", type: "personal_cli", name: "nmem", status: "active" },
          { id: "ds_2", host_id: "host_123", type: "third_party_cli", name: "wrangler", status: "active" },
        ],
      });
      const app = new Hono<{ Bindings: Env }>();
      app.use("*", mockHostAuth("host_123"));
      app.route("/", snapshot);

      // Only report ds_1, ds_2 should become missing
      const request: SnapshotRequest = {
        agents: [],
        data_sources: [
          {
            type: "personal_cli",
            name: "nmem",
            version: "1.2.0",
            auth_status: "authenticated",
          },
        ],
      };

      const res = await app.request(
        "/",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(request),
        },
        { DB: mockDb, DASHBOARD_SERVICE_TOKEN: "token" }
      );

      expect(res.status).toBe(200);
      const body = (await res.json()) as SnapshotResponse;
      expect(body.data_sources_updated).toBe(1);
      expect(body.data_sources_missing).toBe(1);
      // Verify batch was called
      expect(mockDb.batch).toHaveBeenCalled();
    });

    it("should not mark data sources from other hosts as missing", async () => {
      const mockDb = createMockDb({
        existingDataSources: [
          { id: "ds_1", host_id: "host_123", type: "personal_cli", name: "nmem", status: "active" },
          { id: "ds_other", host_id: "host_other", type: "third_party_cli", name: "wrangler", status: "active" },
        ],
      });
      const app = new Hono<{ Bindings: Env }>();
      app.use("*", mockHostAuth("host_123"));
      app.route("/", snapshot);

      // Empty data_sources - only host_123's data sources should be marked missing
      const request: SnapshotRequest = { agents: [], data_sources: [] };

      const res = await app.request(
        "/",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(request),
        },
        { DB: mockDb, DASHBOARD_SERVICE_TOKEN: "token" }
      );

      expect(res.status).toBe(200);
      const body = (await res.json()) as SnapshotResponse;
      expect(body.data_sources_missing).toBe(1); // Only ds_1
    });

    it("should handle empty data_sources array", async () => {
      const mockDb = createMockDb();
      const app = new Hono<{ Bindings: Env }>();
      app.use("*", mockHostAuth("host_123"));
      app.route("/", snapshot);

      const request: SnapshotRequest = { agents: [], data_sources: [] };

      const res = await app.request(
        "/",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(request),
        },
        { DB: mockDb, DASHBOARD_SERVICE_TOKEN: "token" }
      );

      expect(res.status).toBe(200);
      const body = (await res.json()) as SnapshotResponse;
      expect(body.data_sources_created).toBe(0);
      expect(body.data_sources_updated).toBe(0);
      expect(body.data_sources_missing).toBe(0);
    });

    it("should handle missing data_sources field gracefully", async () => {
      const mockDb = createMockDb();
      const app = new Hono<{ Bindings: Env }>();
      app.use("*", mockHostAuth("host_123"));
      app.route("/", snapshot);

      const res = await app.request(
        "/",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ agents: [] }),
        },
        { DB: mockDb, DASHBOARD_SERVICE_TOKEN: "token" }
      );

      expect(res.status).toBe(200);
      const body = (await res.json()) as SnapshotResponse;
      expect(body.data_sources_created).toBe(0);
    });
  });

  describe("Payload validation", () => {
    it("should reject non-object request body", async () => {
      const mockDb = createMockDb();
      const app = new Hono<{ Bindings: Env }>();
      app.use("*", mockHostAuth("host_123"));
      app.route("/", snapshot);

      const res = await app.request(
        "/",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify("not an object"),
        },
        { DB: mockDb, DASHBOARD_SERVICE_TOKEN: "token" }
      );

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body).toHaveProperty("error.code", "invalid_request");
    });

    it("should reject non-array agents field", async () => {
      const mockDb = createMockDb();
      const app = new Hono<{ Bindings: Env }>();
      app.use("*", mockHostAuth("host_123"));
      app.route("/", snapshot);

      const res = await app.request(
        "/",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ agents: "not an array" }),
        },
        { DB: mockDb, DASHBOARD_SERVICE_TOKEN: "token" }
      );

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body).toHaveProperty("error.code", "invalid_request");
      expect(body.error.message).toContain("agents");
    });

    it("should reject agent with invalid status enum", async () => {
      const mockDb = createMockDb();
      const app = new Hono<{ Bindings: Env }>();
      app.use("*", mockHostAuth("host_123"));
      app.route("/", snapshot);

      const res = await app.request(
        "/",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            agents: [{
              match_key: "test:/path",
              runtime_app: "test",
              runtime_version: "1.0",
              status: "invalid_status",
            }],
          }),
        },
        { DB: mockDb, DASHBOARD_SERVICE_TOKEN: "token" }
      );

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body).toHaveProperty("error.code", "invalid_request");
      expect(body.error.message).toContain("status");
    });

    it("should reject agent with missing match_key", async () => {
      const mockDb = createMockDb();
      const app = new Hono<{ Bindings: Env }>();
      app.use("*", mockHostAuth("host_123"));
      app.route("/", snapshot);

      const res = await app.request(
        "/",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            agents: [{
              runtime_app: "test",
              runtime_version: "1.0",
              status: "running",
            }],
          }),
        },
        { DB: mockDb, DASHBOARD_SERVICE_TOKEN: "token" }
      );

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body).toHaveProperty("error.code", "invalid_request");
      expect(body.error.message).toContain("match_key");
    });

    it("should reject agent with empty match_key", async () => {
      const mockDb = createMockDb();
      const app = new Hono<{ Bindings: Env }>();
      app.use("*", mockHostAuth("host_123"));
      app.route("/", snapshot);

      const res = await app.request(
        "/",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            agents: [{
              match_key: "",
              runtime_app: "test",
              runtime_version: "1.0",
              status: "running",
            }],
          }),
        },
        { DB: mockDb, DASHBOARD_SERVICE_TOKEN: "token" }
      );

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error.message).toContain("match_key");
    });

    it("should reject agent with missing runtime_app", async () => {
      const mockDb = createMockDb();
      const app = new Hono<{ Bindings: Env }>();
      app.use("*", mockHostAuth("host_123"));
      app.route("/", snapshot);

      const res = await app.request(
        "/",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            agents: [{
              match_key: "test:/path",
              runtime_version: "1.0",
              status: "running",
            }],
          }),
        },
        { DB: mockDb, DASHBOARD_SERVICE_TOKEN: "token" }
      );

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error.message).toContain("runtime_app");
    });

    it("should reject agent with missing runtime_version", async () => {
      const mockDb = createMockDb();
      const app = new Hono<{ Bindings: Env }>();
      app.use("*", mockHostAuth("host_123"));
      app.route("/", snapshot);

      const res = await app.request(
        "/",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            agents: [{
              match_key: "test:/path",
              runtime_app: "test",
              status: "running",
            }],
          }),
        },
        { DB: mockDb, DASHBOARD_SERVICE_TOKEN: "token" }
      );

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error.message).toContain("runtime_version");
    });

    it("should accept agent with null runtime_version", async () => {
      const mockDb = createMockDb({
        existingAgents: [
          { id: "agent_1", host_id: "host_123", match_key: "hermes:main", status: "stopped" },
        ],
      });
      const app = new Hono<{ Bindings: Env }>();
      app.use("*", mockHostAuth("host_123"));
      app.route("/", snapshot);

      const res = await app.request(
        "/",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            agents: [{
              match_key: "hermes:main",
              runtime_app: "hermes",
              runtime_version: null,
              status: "running",
            }],
            data_sources: [],
          }),
        },
        { DB: mockDb, DASHBOARD_SERVICE_TOKEN: "token" }
      );

      expect(res.status).toBe(200);
      const body = (await res.json()) as SnapshotResponse;
      expect(body.agents_updated).toBe(1);
    });

    it("should reject non-array data_sources field", async () => {
      const mockDb = createMockDb();
      const app = new Hono<{ Bindings: Env }>();
      app.use("*", mockHostAuth("host_123"));
      app.route("/", snapshot);

      const res = await app.request(
        "/",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ data_sources: { not: "array" } }),
        },
        { DB: mockDb, DASHBOARD_SERVICE_TOKEN: "token" }
      );

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error.message).toContain("data_sources");
    });

    it("should reject data source with invalid type enum", async () => {
      const mockDb = createMockDb();
      const app = new Hono<{ Bindings: Env }>();
      app.use("*", mockHostAuth("host_123"));
      app.route("/", snapshot);

      const res = await app.request(
        "/",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            data_sources: [{
              type: "invalid_type",
              name: "test",
              version: "1.0",
              auth_status: "authenticated",
            }],
          }),
        },
        { DB: mockDb, DASHBOARD_SERVICE_TOKEN: "token" }
      );

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error.message).toContain("type");
    });

    it("should reject data source with invalid auth_status enum", async () => {
      const mockDb = createMockDb();
      const app = new Hono<{ Bindings: Env }>();
      app.use("*", mockHostAuth("host_123"));
      app.route("/", snapshot);

      const res = await app.request(
        "/",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            data_sources: [{
              type: "personal_cli",
              name: "test",
              version: "1.0",
              auth_status: "invalid_auth",
            }],
          }),
        },
        { DB: mockDb, DASHBOARD_SERVICE_TOKEN: "token" }
      );

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error.message).toContain("auth_status");
    });

    it("should reject data source with missing name", async () => {
      const mockDb = createMockDb();
      const app = new Hono<{ Bindings: Env }>();
      app.use("*", mockHostAuth("host_123"));
      app.route("/", snapshot);

      const res = await app.request(
        "/",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            data_sources: [{
              type: "personal_cli",
              version: "1.0",
              auth_status: "authenticated",
            }],
          }),
        },
        { DB: mockDb, DASHBOARD_SERVICE_TOKEN: "token" }
      );

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error.message).toContain("name");
    });

    it("should reject data source with empty name", async () => {
      const mockDb = createMockDb();
      const app = new Hono<{ Bindings: Env }>();
      app.use("*", mockHostAuth("host_123"));
      app.route("/", snapshot);

      const res = await app.request(
        "/",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            data_sources: [{
              type: "personal_cli",
              name: "",
              version: "1.0",
              auth_status: "authenticated",
            }],
          }),
        },
        { DB: mockDb, DASHBOARD_SERVICE_TOKEN: "token" }
      );

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error.message).toContain("name");
    });

    it("should reject data source with missing version", async () => {
      const mockDb = createMockDb();
      const app = new Hono<{ Bindings: Env }>();
      app.use("*", mockHostAuth("host_123"));
      app.route("/", snapshot);

      const res = await app.request(
        "/",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            data_sources: [{
              type: "personal_cli",
              name: "test",
              auth_status: "authenticated",
            }],
          }),
        },
        { DB: mockDb, DASHBOARD_SERVICE_TOKEN: "token" }
      );

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error.message).toContain("version");
    });

    it("should reject agent that is not an object", async () => {
      const mockDb = createMockDb();
      const app = new Hono<{ Bindings: Env }>();
      app.use("*", mockHostAuth("host_123"));
      app.route("/", snapshot);

      const res = await app.request(
        "/",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            agents: ["not an object"],
          }),
        },
        { DB: mockDb, DASHBOARD_SERVICE_TOKEN: "token" }
      );

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error.message).toContain("agents[0]");
    });

    it("should reject data source that is not an object", async () => {
      const mockDb = createMockDb();
      const app = new Hono<{ Bindings: Env }>();
      app.use("*", mockHostAuth("host_123"));
      app.route("/", snapshot);

      const res = await app.request(
        "/",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            data_sources: [null],
          }),
        },
        { DB: mockDb, DASHBOARD_SERVICE_TOKEN: "token" }
      );

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error.message).toContain("data_sources[0]");
    });
  });
});
