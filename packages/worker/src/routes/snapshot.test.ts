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
} = {}) {
  const agents = options.existingAgents ?? [];
  const updates: Array<{ table: string; id: string; values: Record<string, unknown> }> = [];
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
          return { success: true };
        }),
        first: vi.fn(async () => {
          if (sql.includes("SELECT id FROM agents WHERE host_id = ? AND match_key = ?")) {
            const [hostId, matchKey] = args as [string, string];
            const found = agents.find(a => a.host_id === hostId && a.match_key === matchKey);
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
          return { results: [] };
        }),
      })),
    })),
    _getUpdates: () => updates,
    _isHostUpdated: () => hostUpdated,
  } as unknown as D1Database & {
    _getUpdates: () => Array<{ table: string; id: string; values: Record<string, unknown> }>;
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
});
