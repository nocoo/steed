import { describe, it, expect, vi } from "vitest";
import { Hono } from "hono";
import { lanes } from "./lanes";
import type { Env } from "../env";
import type { Lane } from "@steed/shared";

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

// Create mock D1 database
function createMockDb(lanes: Array<{ id: string; name: string }> = []) {
  return {
    prepare: vi.fn(() => ({
      bind: vi.fn(() => ({
        all: vi.fn(async () => ({ results: lanes })),
      })),
      all: vi.fn(async () => ({ results: lanes })),
    })),
    batch: vi.fn(async () => []),
  } as unknown as D1Database;
}

describe("Lanes Routes", () => {
  describe("Auth", () => {
    it("GET /lanes should reject unauthenticated", async () => {
      const mockDb = createMockDb();
      const app = new Hono<{ Bindings: Env }>();
      app.use("*", mockPublicAuth);
      app.route("/", lanes);

      const res = await app.request(
        "/",
        {},
        { DB: mockDb, DASHBOARD_SERVICE_TOKEN: "token" }
      );

      expect(res.status).toBe(401);
    });

    it("GET /lanes should reject host role", async () => {
      const mockDb = createMockDb();
      const app = new Hono<{ Bindings: Env }>();
      app.use("*", mockHostAuth("host_123"));
      app.route("/", lanes);

      const res = await app.request(
        "/",
        {},
        { DB: mockDb, DASHBOARD_SERVICE_TOKEN: "token" }
      );

      expect(res.status).toBe(403);
    });
  });

  describe("GET /lanes", () => {
    it("should return preset lanes", async () => {
      const mockDb = createMockDb([
        { id: "lane_learning", name: "learning" },
        { id: "lane_life", name: "life" },
        { id: "lane_work", name: "work" },
      ]);
      const app = new Hono<{ Bindings: Env }>();
      app.use("*", mockDashboardAuth);
      app.route("/", lanes);

      const res = await app.request(
        "/",
        {},
        { DB: mockDb, DASHBOARD_SERVICE_TOKEN: "token" }
      );

      expect(res.status).toBe(200);
      const body = await res.json() as { data: Lane[] };
      expect(body.data).toHaveLength(3);

      const laneNames = body.data.map(l => l.name);
      expect(laneNames).toContain("work");
      expect(laneNames).toContain("life");
      expect(laneNames).toContain("learning");
    });

    it("should return empty list when no lanes", async () => {
      const mockDb = createMockDb([]);
      const app = new Hono<{ Bindings: Env }>();
      app.use("*", mockDashboardAuth);
      app.route("/", lanes);

      const res = await app.request(
        "/",
        {},
        { DB: mockDb, DASHBOARD_SERVICE_TOKEN: "token" }
      );

      expect(res.status).toBe(200);
      const body = await res.json() as { data: Lane[] };
      expect(body.data).toEqual([]);
    });
  });
});
