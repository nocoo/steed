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
  c.set("auth", { role: "host", hostId });
  await next();
};

// Mock auth for dashboard (should be rejected)
const mockDashboardAuth = async (
  c: { set: (key: string, value: unknown) => void },
  next: () => Promise<void>
) => {
  c.set("auth", { role: "dashboard", hostId: null });
  await next();
};

// Create mock D1 database for Agent upsert testing
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
  const updates: Array<{ table: string; id: string; values: Record<string, unknown> }> = [];
  const inserts: Array<{ table: string; id: string; values: Record<string, unknown> }> = [];
  let hostUpdated = false;

  return {
    prepare: vi.fn((sql: string) => ({
      bind: vi.fn((...args: unknown[]) => ({
        run: vi.fn(async () => {
          if (sql.includes("UPDATE hosts SET last_seen_at")) {
            hostUpdated = true;
            return { success: true };
          }
          if (sql.includes("UPDATE agents SET runtime_app")) {
            const [runtimeApp, runtimeVersion, status, lastSeenAt, id] = args;
            updates.push({
              table: "agents",
              id: id as string,
              values: { runtime_app: runtimeApp, runtime_version: runtimeVersion, status, last_seen_at: lastSeenAt },
            });
            return { success: true };
          }
          if (sql.includes("UPDATE agents SET status = 'missing'")) {
            const [id] = args;
            updates.push({
              table: "agents",
              id: id as string,
              values: { status: "missing" },
            });
            return { success: true };
          }
          if (sql.includes("UPDATE data_sources SET version")) {
            const [version, authStatus, lastSeenAt, id] = args;
            updates.push({
              table: "data_sources",
              id: id as string,
              values: { version, auth_status: authStatus, status: "active", last_seen_at: lastSeenAt },
            });
            return { success: true };
          }
          if (sql.includes("INSERT INTO data_sources")) {
            const [id, hostId, type, name, version, authStatus, createdAt, lastSeenAt] = args;
            inserts.push({
              table: "data_sources",
              id: id as string,
              values: { host_id: hostId, type, name, version, auth_status: authStatus, created_at: createdAt, last_seen_at: lastSeenAt },
            });
            return { success: true };
          }
          if (sql.includes("UPDATE data_sources SET status = 'missing'")) {
            const [id] = args;
            updates.push({
              table: "data_sources",
              id: id as string,
              values: { status: "missing" },
            });
            return { success: true };
          }
          return { success: true };
        }),
        first: vi.fn(async () => {
          if (sql.includes("SELECT id FROM agents WHERE host_id = ? AND match_key = ?")) {
            const [hostId, matchKey] = args as [string, string];
            const found = agents.find(a => a.host_id === hostId && a.match_key === matchKey);
            return found ? { id: found.id } : null;
          }
          if (sql.includes("SELECT id FROM data_sources WHERE host_id = ? AND type = ? AND name = ?")) {
            const [hostId, type, name] = args as [string, string, string];
            const found = dataSources.find(d => d.host_id === hostId && d.type === type && d.name === name);
            return found ? { id: found.id } : null;
          }
          return null;
        }),
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
      })),
    })),
    _getUpdates: () => updates,
    _getInserts: () => inserts,
    _isHostUpdated: () => hostUpdated,
  } as unknown as D1Database & {
    _getUpdates: () => Array<{ table: string; id: string; values: Record<string, unknown> }>;
    _getInserts: () => Array<{ table: string; id: string; values: Record<string, unknown> }>;
    _isHostUpdated: () => boolean;
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

    it("should update host.last_seen_at", async () => {
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
      expect(mockDb._isHostUpdated()).toBe(true);
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

      const updates = mockDb._getUpdates();
      const agentUpdate = updates.find(u => u.id === "agent_1" && u.values.runtime_app);
      expect(agentUpdate).toBeDefined();
      expect(agentUpdate?.values.runtime_app).toBe("openclaw");
      expect(agentUpdate?.values.runtime_version).toBe("0.3.2");
      expect(agentUpdate?.values.status).toBe("running");
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

      const updates = mockDb._getUpdates();
      const missingUpdate = updates.find(u => u.id === "agent_2" && u.values.status === "missing");
      expect(missingUpdate).toBeDefined();
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

      const inserts = mockDb._getInserts();
      expect(inserts).toHaveLength(1);
      expect(inserts[0]?.values.type).toBe("personal_cli");
      expect(inserts[0]?.values.name).toBe("nmem");
      expect(inserts[0]?.values.version).toBe("1.2.0");
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

      const updates = mockDb._getUpdates();
      const dsUpdate = updates.find(u => u.table === "data_sources" && u.id === "ds_1");
      expect(dsUpdate).toBeDefined();
      expect(dsUpdate?.values.version).toBe("1.3.0");
      expect(dsUpdate?.values.status).toBe("active");
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

      const updates = mockDb._getUpdates();
      const missingUpdate = updates.find(u => u.table === "data_sources" && u.id === "ds_2" && u.values.status === "missing");
      expect(missingUpdate).toBeDefined();
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
});
