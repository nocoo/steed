import { describe, it, expect, vi } from "vitest";
import { Hono } from "hono";
import { overview } from "./overview";
import type { Env } from "../env";
import type { Overview } from "@steed/shared";

// Mock auth middleware that sets dashboard role
const mockDashboardAuth = async (
  c: { set: (key: string, value: unknown) => void },
  next: () => Promise<void>
) => {
  c.set("auth", { role: "dashboard", hostId: null, invalidToken: false });
  await next();
};

// Mock auth for host (should be rejected)
const mockHostAuth = async (
  c: { set: (key: string, value: unknown) => void },
  next: () => Promise<void>
) => {
  c.set("auth", { role: "host", hostId: "host_123", invalidToken: false });
  await next();
};

// Create mock D1 database for overview testing
function createMockDb(options: {
  hosts?: { total: number; online: number } | null;
  agents?: { total: number; running: number; stopped: number; missing: number } | null;
  agentsByLane?: { work: number; life: number; learning: number; unassigned: number } | null;
  dataSources?: { total: number; active: number; missing: number } | null;
} = {}) {
  const hosts = options.hosts === undefined ? { total: 0, online: 0 } : options.hosts;
  const agents = options.agents === undefined ? { total: 0, running: 0, stopped: 0, missing: 0 } : options.agents;
  const agentsByLane = options.agentsByLane === undefined ? { work: 0, life: 0, learning: 0, unassigned: 0 } : options.agentsByLane;
  const dataSources = options.dataSources === undefined ? { total: 0, active: 0, missing: 0 } : options.dataSources;

  return {
    prepare: vi.fn((sql: string) => ({
      bind: vi.fn(() => ({
        first: vi.fn(async () => {
          if (sql.includes("FROM hosts")) {
            return hosts;
          }
          return null;
        }),
      })),
      first: vi.fn(async () => {
        if (sql.includes("FROM agents") && sql.includes("lane_id")) {
          return agentsByLane;
        }
        if (sql.includes("FROM agents")) {
          return agents;
        }
        if (sql.includes("FROM data_sources")) {
          return dataSources;
        }
        return null;
      }),
    })),
  } as unknown as D1Database;
}

describe("Overview Routes", () => {
  describe("GET /", () => {
    it("should require dashboard role", async () => {
      const mockDb = createMockDb();
      const app = new Hono<{ Bindings: Env }>();
      app.use("*", mockHostAuth);
      app.route("/", overview);

      const res = await app.request(
        "/",
        {},
        { DB: mockDb, DASHBOARD_SERVICE_TOKEN: "token" }
      );

      expect(res.status).toBe(403);
    });

    it("should return empty counts for fresh database", async () => {
      const mockDb = createMockDb();
      const app = new Hono<{ Bindings: Env }>();
      app.use("*", mockDashboardAuth);
      app.route("/", overview);

      const res = await app.request(
        "/",
        {},
        { DB: mockDb, DASHBOARD_SERVICE_TOKEN: "token" }
      );

      expect(res.status).toBe(200);
      const body = (await res.json()) as Overview;
      expect(body.hosts.total).toBe(0);
      expect(body.hosts.online).toBe(0);
      expect(body.hosts.offline).toBe(0);
      expect(body.agents.total).toBe(0);
      expect(body.data_sources.total).toBe(0);
    });

    it("should return correct host counts", async () => {
      const mockDb = createMockDb({
        hosts: { total: 5, online: 3 },
      });
      const app = new Hono<{ Bindings: Env }>();
      app.use("*", mockDashboardAuth);
      app.route("/", overview);

      const res = await app.request(
        "/",
        {},
        { DB: mockDb, DASHBOARD_SERVICE_TOKEN: "token" }
      );

      expect(res.status).toBe(200);
      const body = (await res.json()) as Overview;
      expect(body.hosts.total).toBe(5);
      expect(body.hosts.online).toBe(3);
      expect(body.hosts.offline).toBe(2);
    });

    it("should return correct agent counts with status breakdown", async () => {
      const mockDb = createMockDb({
        agents: { total: 10, running: 5, stopped: 3, missing: 2 },
      });
      const app = new Hono<{ Bindings: Env }>();
      app.use("*", mockDashboardAuth);
      app.route("/", overview);

      const res = await app.request(
        "/",
        {},
        { DB: mockDb, DASHBOARD_SERVICE_TOKEN: "token" }
      );

      expect(res.status).toBe(200);
      const body = (await res.json()) as Overview;
      expect(body.agents.total).toBe(10);
      expect(body.agents.running).toBe(5);
      expect(body.agents.stopped).toBe(3);
      expect(body.agents.missing).toBe(2);
    });

    it("should return correct agents by lane breakdown", async () => {
      const mockDb = createMockDb({
        agents: { total: 10, running: 5, stopped: 3, missing: 2 },
        agentsByLane: { work: 4, life: 2, learning: 3, unassigned: 1 },
      });
      const app = new Hono<{ Bindings: Env }>();
      app.use("*", mockDashboardAuth);
      app.route("/", overview);

      const res = await app.request(
        "/",
        {},
        { DB: mockDb, DASHBOARD_SERVICE_TOKEN: "token" }
      );

      expect(res.status).toBe(200);
      const body = (await res.json()) as Overview;
      expect(body.agents.by_lane.work).toBe(4);
      expect(body.agents.by_lane.life).toBe(2);
      expect(body.agents.by_lane.learning).toBe(3);
      expect(body.agents.by_lane.unassigned).toBe(1);
    });

    it("should return correct data source counts", async () => {
      const mockDb = createMockDb({
        dataSources: { total: 15, active: 12, missing: 3 },
      });
      const app = new Hono<{ Bindings: Env }>();
      app.use("*", mockDashboardAuth);
      app.route("/", overview);

      const res = await app.request(
        "/",
        {},
        { DB: mockDb, DASHBOARD_SERVICE_TOKEN: "token" }
      );

      expect(res.status).toBe(200);
      const body = (await res.json()) as Overview;
      expect(body.data_sources.total).toBe(15);
      expect(body.data_sources.active).toBe(12);
      expect(body.data_sources.missing).toBe(3);
    });

    it("should return complete overview with all data", async () => {
      const mockDb = createMockDb({
        hosts: { total: 3, online: 2 },
        agents: { total: 5, running: 3, stopped: 1, missing: 1 },
        agentsByLane: { work: 2, life: 1, learning: 1, unassigned: 1 },
        dataSources: { total: 8, active: 7, missing: 1 },
      });
      const app = new Hono<{ Bindings: Env }>();
      app.use("*", mockDashboardAuth);
      app.route("/", overview);

      const res = await app.request(
        "/",
        {},
        { DB: mockDb, DASHBOARD_SERVICE_TOKEN: "token" }
      );

      expect(res.status).toBe(200);
      const body = (await res.json()) as Overview;

      // Verify full structure
      expect(body).toEqual({
        hosts: {
          total: 3,
          online: 2,
          offline: 1,
        },
        agents: {
          total: 5,
          running: 3,
          stopped: 1,
          missing: 1,
          by_lane: {
            work: 2,
            life: 1,
            learning: 1,
            unassigned: 1,
          },
        },
        data_sources: {
          total: 8,
          active: 7,
          missing: 1,
        },
      });
    });

    it("should handle null results from database queries gracefully", async () => {
      const mockDb = createMockDb({
        hosts: null,
        agents: null,
        agentsByLane: null,
        dataSources: null,
      });
      const app = new Hono<{ Bindings: Env }>();
      app.use("*", mockDashboardAuth);
      app.route("/", overview);

      const res = await app.request(
        "/",
        {},
        { DB: mockDb, DASHBOARD_SERVICE_TOKEN: "token" }
      );

      expect(res.status).toBe(200);
      const body = (await res.json()) as Overview;

      // All counts should default to 0
      expect(body.hosts.total).toBe(0);
      expect(body.hosts.online).toBe(0);
      expect(body.hosts.offline).toBe(0);
      expect(body.agents.total).toBe(0);
      expect(body.agents.running).toBe(0);
      expect(body.agents.stopped).toBe(0);
      expect(body.agents.missing).toBe(0);
      expect(body.agents.by_lane.work).toBe(0);
      expect(body.agents.by_lane.life).toBe(0);
      expect(body.agents.by_lane.learning).toBe(0);
      expect(body.agents.by_lane.unassigned).toBe(0);
      expect(body.data_sources.total).toBe(0);
      expect(body.data_sources.active).toBe(0);
      expect(body.data_sources.missing).toBe(0);
    });
  });
});
