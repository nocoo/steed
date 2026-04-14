import { describe, it, expect, vi } from "vitest";
import { Hono } from "hono";
import { hosts, calculateStatus, hashApiKey } from "./hosts";
import type { Env } from "../env";
import type { RegisterHostResponse, HostWithStatus } from "@steed/shared";

// Mock auth middleware that sets dashboard role
const mockDashboardAuth = async (
  c: { set: (key: string, value: unknown) => void },
  next: () => Promise<void>
) => {
  c.set("auth", { role: "dashboard", hostId: null });
  await next();
};

// Create mock D1 database
function createMockDb() {
  const data: Map<string, unknown[]> = new Map();
  data.set("hosts", []);

  return {
    prepare: vi.fn((sql: string) => ({
      bind: vi.fn((...args: unknown[]) => ({
        run: vi.fn(async () => {
          if (sql.includes("INSERT INTO hosts")) {
            const [id, name, apiKeyHash, createdAt] = args as string[];
            const hostsData = data.get("hosts") as Array<{
              id: string;
              name: string;
              api_key_hash: string;
              created_at: string;
              last_seen_at: string | null;
            }>;

            // Check for unique constraint
            if (hostsData.some((h) => h.api_key_hash === apiKeyHash)) {
              throw new Error("UNIQUE constraint failed");
            }

            hostsData.push({
              id,
              name,
              api_key_hash: apiKeyHash,
              created_at: createdAt,
              last_seen_at: null,
            });
            return { success: true };
          }
          return { success: true };
        }),
        first: vi.fn(async () => null),
      })),
      all: vi.fn(async () => {
        if (sql.includes("SELECT") && sql.includes("hosts")) {
          return { results: data.get("hosts") ?? [] };
        }
        return { results: [] };
      }),
    })),
    _data: data,
  } as unknown as D1Database & { _data: Map<string, unknown[]> };
}

describe("Hosts Routes", () => {
  describe("calculateStatus", () => {
    it("should return offline when last_seen_at is null", () => {
      expect(calculateStatus(null)).toBe("offline");
    });

    it("should return online when last_seen_at is within 15 minutes", () => {
      const recentTime = new Date(Date.now() - 5 * 60 * 1000).toISOString();
      expect(calculateStatus(recentTime)).toBe("online");
    });

    it("should return offline when last_seen_at is over 15 minutes ago", () => {
      const oldTime = new Date(Date.now() - 20 * 60 * 1000).toISOString();
      expect(calculateStatus(oldTime)).toBe("offline");
    });
  });

  describe("hashApiKey", () => {
    it("should produce consistent SHA-256 hash", async () => {
      const key = "sk_host_test123";
      const hash1 = await hashApiKey(key);
      const hash2 = await hashApiKey(key);
      expect(hash1).toBe(hash2);
      expect(hash1).toHaveLength(64); // SHA-256 produces 64 hex chars
    });

    it("should produce different hashes for different keys", async () => {
      const hash1 = await hashApiKey("key1");
      const hash2 = await hashApiKey("key2");
      expect(hash1).not.toBe(hash2);
    });
  });

  describe("POST /register", () => {
    it("should create a new host and return API key", async () => {
      const mockDb = createMockDb();
      const app = new Hono<{ Bindings: Env }>();
      app.use("*", mockDashboardAuth);
      app.route("/", hosts);

      const res = await app.request(
        "/register",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: "test-host" }),
        },
        { DB: mockDb, DASHBOARD_SERVICE_TOKEN: "token" }
      );

      expect(res.status).toBe(201);
      const body = (await res.json()) as RegisterHostResponse;
      expect(body.id).toMatch(/^host_/);
      expect(body.name).toBe("test-host");
      expect(body.api_key).toMatch(/^sk_host_/);
    });

    it("should return 400 when name is missing", async () => {
      const mockDb = createMockDb();
      const app = new Hono<{ Bindings: Env }>();
      app.use("*", mockDashboardAuth);
      app.route("/", hosts);

      const res = await app.request(
        "/register",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        },
        { DB: mockDb, DASHBOARD_SERVICE_TOKEN: "token" }
      );

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body).toHaveProperty("error.code", "invalid_request");
    });

    it("should return 403 when not dashboard role", async () => {
      const mockDb = createMockDb();
      const app = new Hono<{ Bindings: Env }>();
      app.use("*", async (c, next) => {
        c.set("auth", { role: "host", hostId: "host_123" });
        await next();
      });
      app.route("/", hosts);

      const res = await app.request(
        "/register",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: "test-host" }),
        },
        { DB: mockDb, DASHBOARD_SERVICE_TOKEN: "token" }
      );

      expect(res.status).toBe(403);
    });

    it("should return 409 when unique constraint violated", async () => {
      const mockDb = {
        prepare: vi.fn(() => ({
          bind: vi.fn(() => ({
            run: vi.fn(async () => {
              throw new Error("UNIQUE constraint failed");
            }),
          })),
        })),
      } as unknown as D1Database;

      const app = new Hono<{ Bindings: Env }>();
      app.use("*", mockDashboardAuth);
      app.route("/", hosts);

      const res = await app.request(
        "/register",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: "test-host" }),
        },
        { DB: mockDb, DASHBOARD_SERVICE_TOKEN: "token" }
      );

      expect(res.status).toBe(409);
      const body = await res.json();
      expect(body).toHaveProperty("error.code", "conflict");
    });

    it("should return 500 on other errors", async () => {
      const mockDb = {
        prepare: vi.fn(() => ({
          bind: vi.fn(() => ({
            run: vi.fn(async () => {
              throw new Error("Database connection failed");
            }),
          })),
        })),
      } as unknown as D1Database;

      const app = new Hono<{ Bindings: Env }>();
      app.use("*", mockDashboardAuth);
      app.route("/", hosts);

      const res = await app.request(
        "/register",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: "test-host" }),
        },
        { DB: mockDb, DASHBOARD_SERVICE_TOKEN: "token" }
      );

      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body).toHaveProperty("error.code", "internal_error");
    });

    it("should return 400 on invalid JSON", async () => {
      const mockDb = createMockDb();
      const app = new Hono<{ Bindings: Env }>();
      app.use("*", mockDashboardAuth);
      app.route("/", hosts);

      const res = await app.request(
        "/register",
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

  describe("GET /", () => {
    it("should return empty list when no hosts", async () => {
      const mockDb = createMockDb();
      const app = new Hono<{ Bindings: Env }>();
      app.use("*", mockDashboardAuth);
      app.route("/", hosts);

      const res = await app.request(
        "/",
        {},
        { DB: mockDb, DASHBOARD_SERVICE_TOKEN: "token" }
      );

      expect(res.status).toBe(200);
      const body = (await res.json()) as HostWithStatus[];
      expect(body).toEqual([]);
    });

    it("should return hosts with status", async () => {
      const mockDb = createMockDb();
      const hostsData = mockDb._data.get("hosts") as unknown[];
      hostsData.push({
        id: "host_123",
        name: "test-host",
        api_key_hash: "hash123",
        created_at: "2026-04-14T00:00:00Z",
        last_seen_at: new Date().toISOString(),
      });

      const app = new Hono<{ Bindings: Env }>();
      app.use("*", mockDashboardAuth);
      app.route("/", hosts);

      const res = await app.request(
        "/",
        {},
        { DB: mockDb, DASHBOARD_SERVICE_TOKEN: "token" }
      );

      expect(res.status).toBe(200);
      const body = (await res.json()) as HostWithStatus[];
      expect(body).toHaveLength(1);
      expect(body[0]?.status).toBe("online");
      expect(body[0]?.api_key_hash).toBe(""); // Should not expose hash
    });

    it("should return 403 when not dashboard role", async () => {
      const mockDb = createMockDb();
      const app = new Hono<{ Bindings: Env }>();
      app.use("*", async (c, next) => {
        c.set("auth", { role: "public", hostId: null });
        await next();
      });
      app.route("/", hosts);

      const res = await app.request(
        "/",
        {},
        { DB: mockDb, DASHBOARD_SERVICE_TOKEN: "token" }
      );

      expect(res.status).toBe(403);
    });
  });
});
