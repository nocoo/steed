import { describe, it, expect, vi } from "vitest";
import { Hono } from "hono";
import { dataSources } from "./data-sources";
import type { Env } from "../env";
import type { DataSourceListItem } from "@steed/shared";

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

// Data source type for mock data
type MockDataSource = {
  id: string;
  host_id: string;
  type: string;
  name: string;
  version?: string | null;
  auth_status?: string;
  status?: string;
  metadata?: string;
  created_at?: string;
  last_seen_at?: string | null;
};

// Create mock D1 database with configurable behavior
function createMockDb(options: {
  dataSources?: MockDataSource[];
  dataSourceLanes?: Array<{ data_source_id: string; lane_id: string }>;
} = {}) {
  const dataSourcesData = options.dataSources ?? [];
  const dataSourceLanes = options.dataSourceLanes ?? [];

  return {
    prepare: vi.fn((sql: string) => ({
      bind: vi.fn((...args: unknown[]) => ({
        run: vi.fn(async () => ({ success: true })),
        first: vi.fn(async () => {
          // Handle GET /:id query
          if (sql.includes("FROM data_sources") && sql.includes("WHERE id = ?")) {
            const id = args[0] as string;
            const ds = dataSourcesData.find(d => d.id === id);
            if (ds) {
              return {
                id: ds.id,
                host_id: ds.host_id,
                type: ds.type,
                name: ds.name,
                version: ds.version ?? null,
                auth_status: ds.auth_status ?? "unknown",
                status: ds.status ?? "active",
                metadata: ds.metadata ?? "{}",
                created_at: ds.created_at ?? new Date().toISOString(),
                last_seen_at: ds.last_seen_at ?? null,
              };
            }
            return null;
          }
          return null;
        }),
        all: vi.fn(async () => {
          // Handle lane_ids fetch for GET /:id
          if (sql.includes("FROM data_source_lanes") && sql.includes("WHERE data_source_id = ?")) {
            const dsId = args[0] as string;
            const lanes = dataSourceLanes.filter(dsl => dsl.data_source_id === dsId);
            return { results: lanes.map(l => ({ lane_id: l.lane_id })) };
          }
          // Handle list queries
          if (sql.includes("FROM data_sources")) {
            // Check if it's a lane filter query (has JOIN)
            if (sql.includes("INNER JOIN data_source_lanes")) {
              // Filter by lane_id from args
              const laneIdIndex = sql.includes("ds.host_id = ?") ? 1 : 0;
              const laneId = args[laneIdIndex] as string;
              const dsIds = dataSourceLanes
                .filter(dsl => dsl.lane_id === laneId)
                .map(dsl => dsl.data_source_id);
              const filtered = dataSourcesData.filter(ds => dsIds.includes(ds.id));
              return {
                results: filtered.map(ds => ({
                  id: ds.id,
                  host_id: ds.host_id,
                  type: ds.type,
                  name: ds.name,
                  version: ds.version ?? null,
                  auth_status: ds.auth_status ?? "unknown",
                  status: ds.status ?? "active",
                  created_at: ds.created_at ?? new Date().toISOString(),
                  last_seen_at: ds.last_seen_at ?? null,
                })),
              };
            }
            // Regular list query
            return {
              results: dataSourcesData.map(ds => ({
                id: ds.id,
                host_id: ds.host_id,
                type: ds.type,
                name: ds.name,
                version: ds.version ?? null,
                auth_status: ds.auth_status ?? "unknown",
                status: ds.status ?? "active",
                created_at: ds.created_at ?? new Date().toISOString(),
                last_seen_at: ds.last_seen_at ?? null,
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

// Create mock D1 database with update support for PATCH tests
function createMockDbWithUpdate(options: {
  dataSources?: MockDataSource[];
  dataSourceLanes?: Array<{ data_source_id: string; lane_id: string }>;
  failPostUpdate?: boolean;
} = {}) {
  const dataSourcesData = [...(options.dataSources ?? [])];
  const dataSourceLanes = options.dataSourceLanes ?? [];
  let fetchCount = 0;

  return {
    prepare: vi.fn((sql: string) => ({
      bind: vi.fn((...args: unknown[]) => ({
        run: vi.fn(async () => ({ success: true })),
        first: vi.fn(async () => {
          // Handle GET /:id query
          if (sql.includes("FROM data_sources") && sql.includes("WHERE id = ?")) {
            fetchCount++;
            // If failPostUpdate is set, return null on the second fetch
            if (options.failPostUpdate && fetchCount > 1) {
              return null;
            }
            const id = args[args.length - 1] as string;
            const ds = dataSourcesData.find(d => d.id === id);
            if (ds) {
              return {
                id: ds.id,
                host_id: ds.host_id,
                type: ds.type,
                name: ds.name,
                version: ds.version ?? null,
                auth_status: ds.auth_status ?? "unknown",
                status: ds.status ?? "active",
                metadata: ds.metadata ?? "{}",
                created_at: ds.created_at ?? new Date().toISOString(),
                last_seen_at: ds.last_seen_at ?? null,
              };
            }
            return null;
          }
          return null;
        }),
        all: vi.fn(async () => {
          // Handle lane_ids fetch
          if (sql.includes("FROM data_source_lanes") && sql.includes("WHERE data_source_id = ?")) {
            const dsId = args[0] as string;
            const lanes = dataSourceLanes.filter(dsl => dsl.data_source_id === dsId);
            return { results: lanes.map(l => ({ lane_id: l.lane_id })) };
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

describe("Data Sources Routes", () => {
  describe("Route scaffold", () => {
    it("GET /data-sources should reject unauthenticated", async () => {
      const mockDb = createMockDb();
      const app = new Hono<{ Bindings: Env }>();
      app.use("*", mockPublicAuth);
      app.route("/", dataSources);

      const res = await app.request(
        "/",
        {},
        { DB: mockDb, DASHBOARD_SERVICE_TOKEN: "token" }
      );

      expect(res.status).toBe(401);
    });

    it("GET /data-sources should reject host role", async () => {
      const mockDb = createMockDb();
      const app = new Hono<{ Bindings: Env }>();
      app.use("*", mockHostAuth("host_123"));
      app.route("/", dataSources);

      const res = await app.request(
        "/",
        {},
        { DB: mockDb, DASHBOARD_SERVICE_TOKEN: "token" }
      );

      expect(res.status).toBe(403);
    });
  });

  describe("GET /data-sources", () => {
    it("should return empty list when no data sources", async () => {
      const mockDb = createMockDb();
      const app = new Hono<{ Bindings: Env }>();
      app.use("*", mockDashboardAuth);
      app.route("/", dataSources);

      const res = await app.request(
        "/",
        {},
        { DB: mockDb, DASHBOARD_SERVICE_TOKEN: "token" }
      );

      expect(res.status).toBe(200);
      const body = await res.json() as { data: DataSourceListItem[]; next_cursor: string | null };
      expect(body.data).toEqual([]);
      expect(body.next_cursor).toBeNull();
    });

    it("should return list of data sources", async () => {
      const mockDb = createMockDb({
        dataSources: [
          {
            id: "ds_1",
            host_id: "host_123",
            type: "personal_cli",
            name: "nmem",
            version: "1.2.0",
            auth_status: "authenticated",
            status: "active",
            created_at: "2026-04-15T12:00:00Z",
            last_seen_at: "2026-04-15T14:00:00Z",
          },
        ],
      });
      const app = new Hono<{ Bindings: Env }>();
      app.use("*", mockDashboardAuth);
      app.route("/", dataSources);

      const res = await app.request(
        "/",
        {},
        { DB: mockDb, DASHBOARD_SERVICE_TOKEN: "token" }
      );

      expect(res.status).toBe(200);
      const body = await res.json() as { data: DataSourceListItem[]; next_cursor: string | null };
      expect(body.data).toHaveLength(1);
      expect(body.data[0]?.id).toBe("ds_1");
      expect(body.data[0]?.name).toBe("nmem");
      // Should NOT have metadata field
      expect(body.data[0]).not.toHaveProperty("metadata");
    });

    it("should filter by host_id", async () => {
      const mockDb = createMockDb({
        dataSources: [
          { id: "ds_1", host_id: "host_a", type: "personal_cli", name: "nmem" },
        ],
      });
      const app = new Hono<{ Bindings: Env }>();
      app.use("*", mockDashboardAuth);
      app.route("/", dataSources);

      const res = await app.request(
        "/?host_id=host_a",
        {},
        { DB: mockDb, DASHBOARD_SERVICE_TOKEN: "token" }
      );

      expect(res.status).toBe(200);
      expect(mockDb.prepare).toHaveBeenCalled();
    });

    it("should filter by lane_id with JOIN", async () => {
      const mockDb = createMockDb({
        dataSources: [
          { id: "ds_1", host_id: "host_123", type: "personal_cli", name: "nmem" },
          { id: "ds_2", host_id: "host_123", type: "third_party_cli", name: "wrangler" },
        ],
        dataSourceLanes: [
          { data_source_id: "ds_1", lane_id: "lane_work" },
        ],
      });
      const app = new Hono<{ Bindings: Env }>();
      app.use("*", mockDashboardAuth);
      app.route("/", dataSources);

      const res = await app.request(
        "/?lane_id=lane_work",
        {},
        { DB: mockDb, DASHBOARD_SERVICE_TOKEN: "token" }
      );

      expect(res.status).toBe(200);
      const body = await res.json() as { data: DataSourceListItem[] };
      expect(body.data).toHaveLength(1);
      expect(body.data[0]?.id).toBe("ds_1");
    });

    it("should filter by status", async () => {
      const mockDb = createMockDb({
        dataSources: [
          { id: "ds_1", host_id: "host_123", type: "personal_cli", name: "nmem", status: "active" },
        ],
      });
      const app = new Hono<{ Bindings: Env }>();
      app.use("*", mockDashboardAuth);
      app.route("/", dataSources);

      const res = await app.request(
        "/?status=active",
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
      app.route("/", dataSources);

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
      app.route("/", dataSources);

      const res = await app.request(
        "/?cursor=ds_abc",
        {},
        { DB: mockDb, DASHBOARD_SERVICE_TOKEN: "token" }
      );

      expect(res.status).toBe(200);
    });

    it("should ignore invalid limit parameter", async () => {
      const mockDb = createMockDb();
      const app = new Hono<{ Bindings: Env }>();
      app.use("*", mockDashboardAuth);
      app.route("/", dataSources);

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
      app.route("/", dataSources);

      const res = await app.request(
        "/?limit=500",
        {},
        { DB: mockDb, DASHBOARD_SERVICE_TOKEN: "token" }
      );

      expect(res.status).toBe(200);
    });

    it("should return next_cursor when more results exist", async () => {
      // Create a mock that returns limit+1 items to simulate hasMore
      const mockDb = {
        prepare: vi.fn(() => ({
          bind: vi.fn(() => ({
            all: vi.fn(async () => ({
              results: [
                { id: "ds_1", host_id: "h", type: "personal_cli", name: "a", version: null, auth_status: "unknown", status: "active", created_at: "2026-01-01", last_seen_at: null },
                { id: "ds_2", host_id: "h", type: "personal_cli", name: "b", version: null, auth_status: "unknown", status: "active", created_at: "2026-01-01", last_seen_at: null },
              ],
            })),
          })),
        })),
      } as unknown as D1Database;

      const app = new Hono<{ Bindings: Env }>();
      app.use("*", mockDashboardAuth);
      app.route("/", dataSources);

      const res = await app.request(
        "/?limit=1",
        {},
        { DB: mockDb, DASHBOARD_SERVICE_TOKEN: "token" }
      );

      expect(res.status).toBe(200);
      const body = await res.json() as { data: DataSourceListItem[]; next_cursor: string | null };
      expect(body.data).toHaveLength(1);
      expect(body.next_cursor).toBe("ds_1");
    });
  });

  describe("GET /data-sources/:id", () => {
    it("should return data source details with metadata and lane_ids", async () => {
      const mockDb = createMockDb({
        dataSources: [
          {
            id: "ds_test",
            host_id: "host_123",
            type: "personal_cli",
            name: "nmem",
            version: "1.2.0",
            auth_status: "authenticated",
            status: "active",
            metadata: JSON.stringify({ notes: "Test notes", priority: "high" }),
            created_at: "2026-04-15T12:00:00Z",
            last_seen_at: "2026-04-15T14:00:00Z",
          },
        ],
        dataSourceLanes: [
          { data_source_id: "ds_test", lane_id: "lane_work" },
          { data_source_id: "ds_test", lane_id: "lane_learning" },
        ],
      });
      const app = new Hono<{ Bindings: Env }>();
      app.use("*", mockDashboardAuth);
      app.route("/", dataSources);

      const res = await app.request(
        "/ds_test",
        {},
        { DB: mockDb, DASHBOARD_SERVICE_TOKEN: "token" }
      );

      expect(res.status).toBe(200);
      const body = await res.json() as {
        id: string;
        name: string;
        metadata: Record<string, unknown>;
        lane_ids: string[];
      };
      expect(body.id).toBe("ds_test");
      expect(body.name).toBe("nmem");
      expect(body.metadata).toEqual({ notes: "Test notes", priority: "high" });
      expect(body.lane_ids).toHaveLength(2);
      expect(body.lane_ids).toContain("lane_work");
      expect(body.lane_ids).toContain("lane_learning");
    });

    it("should return 404 for non-existent data source", async () => {
      const mockDb = createMockDb({ dataSources: [] });
      const app = new Hono<{ Bindings: Env }>();
      app.use("*", mockDashboardAuth);
      app.route("/", dataSources);

      const res = await app.request(
        "/ds_nonexistent",
        {},
        { DB: mockDb, DASHBOARD_SERVICE_TOKEN: "token" }
      );

      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body).toHaveProperty("error.code", "not_found");
    });

    it("should return empty lane_ids when data source has no lanes", async () => {
      const mockDb = createMockDb({
        dataSources: [
          { id: "ds_no_lanes", host_id: "host_123", type: "third_party_cli", name: "wrangler" },
        ],
        dataSourceLanes: [],
      });
      const app = new Hono<{ Bindings: Env }>();
      app.use("*", mockDashboardAuth);
      app.route("/", dataSources);

      const res = await app.request(
        "/ds_no_lanes",
        {},
        { DB: mockDb, DASHBOARD_SERVICE_TOKEN: "token" }
      );

      expect(res.status).toBe(200);
      const body = await res.json() as { lane_ids: string[] };
      expect(body.lane_ids).toEqual([]);
    });

    it("should handle invalid metadata JSON gracefully", async () => {
      const mockDb = createMockDb({
        dataSources: [
          { id: "ds_bad_json", host_id: "host_123", type: "personal_cli", name: "test", metadata: "invalid json" },
        ],
      });
      const app = new Hono<{ Bindings: Env }>();
      app.use("*", mockDashboardAuth);
      app.route("/", dataSources);

      const res = await app.request(
        "/ds_bad_json",
        {},
        { DB: mockDb, DASHBOARD_SERVICE_TOKEN: "token" }
      );

      expect(res.status).toBe(200);
      const body = await res.json() as { metadata: Record<string, unknown> };
      expect(body.metadata).toEqual({});
    });
  });

  describe("PATCH /data-sources/:id", () => {
    it("should update metadata with shallow merge", async () => {
      const mockDb = createMockDbWithUpdate({
        dataSources: [
          {
            id: "ds_1",
            host_id: "host_123",
            type: "personal_cli",
            name: "nmem",
            metadata: JSON.stringify({ existing: "value" }),
          },
        ],
      });
      const app = new Hono<{ Bindings: Env }>();
      app.use("*", mockDashboardAuth);
      app.route("/", dataSources);

      const res = await app.request(
        "/ds_1",
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ metadata: { notes: "New notes", tags: ["dev"] } }),
        },
        { DB: mockDb, DASHBOARD_SERVICE_TOKEN: "token" }
      );

      expect(res.status).toBe(200);
      const body = await res.json() as { id: string };
      expect(body.id).toBe("ds_1");
    });

    it("should return 404 for non-existent data source", async () => {
      const mockDb = createMockDbWithUpdate({ dataSources: [] });
      const app = new Hono<{ Bindings: Env }>();
      app.use("*", mockDashboardAuth);
      app.route("/", dataSources);

      const res = await app.request(
        "/ds_nonexistent",
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ metadata: { notes: "Test" } }),
        },
        { DB: mockDb, DASHBOARD_SERVICE_TOKEN: "token" }
      );

      expect(res.status).toBe(404);
    });

    it("should return 400 for metadata as null", async () => {
      const mockDb = createMockDbWithUpdate({
        dataSources: [{ id: "ds_1", host_id: "host_123", type: "personal_cli", name: "test" }],
      });
      const app = new Hono<{ Bindings: Env }>();
      app.use("*", mockDashboardAuth);
      app.route("/", dataSources);

      const res = await app.request(
        "/ds_1",
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

    it("should return 400 for metadata as array", async () => {
      const mockDb = createMockDbWithUpdate({
        dataSources: [{ id: "ds_1", host_id: "host_123", type: "personal_cli", name: "test" }],
      });
      const app = new Hono<{ Bindings: Env }>();
      app.use("*", mockDashboardAuth);
      app.route("/", dataSources);

      const res = await app.request(
        "/ds_1",
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ metadata: ["invalid"] }),
        },
        { DB: mockDb, DASHBOARD_SERVICE_TOKEN: "token" }
      );

      expect(res.status).toBe(400);
    });

    it("should return 400 for invalid JSON body", async () => {
      const mockDb = createMockDbWithUpdate({
        dataSources: [{ id: "ds_1", host_id: "host_123", type: "personal_cli", name: "test" }],
      });
      const app = new Hono<{ Bindings: Env }>();
      app.use("*", mockDashboardAuth);
      app.route("/", dataSources);

      const res = await app.request(
        "/ds_1",
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: "not json",
        },
        { DB: mockDb, DASHBOARD_SERVICE_TOKEN: "token" }
      );

      expect(res.status).toBe(400);
    });

    it("should handle no metadata update (empty body)", async () => {
      const mockDb = createMockDbWithUpdate({
        dataSources: [
          { id: "ds_1", host_id: "host_123", type: "personal_cli", name: "nmem" },
        ],
      });
      const app = new Hono<{ Bindings: Env }>();
      app.use("*", mockDashboardAuth);
      app.route("/", dataSources);

      const res = await app.request(
        "/ds_1",
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        },
        { DB: mockDb, DASHBOARD_SERVICE_TOKEN: "token" }
      );

      expect(res.status).toBe(200);
    });

    it("should return 500 when post-update fetch fails", async () => {
      const mockDb = createMockDbWithUpdate({
        dataSources: [
          { id: "ds_1", host_id: "host_123", type: "personal_cli", name: "nmem" },
        ],
        failPostUpdate: true,
      });
      const app = new Hono<{ Bindings: Env }>();
      app.use("*", mockDashboardAuth);
      app.route("/", dataSources);

      const res = await app.request(
        "/ds_1",
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ metadata: { notes: "test" } }),
        },
        { DB: mockDb, DASHBOARD_SERVICE_TOKEN: "token" }
      );

      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body).toHaveProperty("error.code", "internal_error");
    });
  });

  describe("PUT /data-sources/:id/lanes", () => {
    // Create mock D1 database with lanes support for PUT lanes tests
    function createMockDbWithLanes(options: {
      dataSources?: MockDataSource[];
      lanes?: Array<{ id: string }>;
      dataSourceLanes?: Array<{ data_source_id: string; lane_id: string }>;
    } = {}) {
      const dataSourcesData = options.dataSources ?? [];
      const lanesData = options.lanes ?? [];
      // dataSourceLanes param is for future use when we need to verify existing assignments
      const _dataSourceLanes = options.dataSourceLanes ?? [];
      void _dataSourceLanes;

      return {
        prepare: vi.fn((sql: string) => ({
          bind: vi.fn((...args: unknown[]) => ({
            run: vi.fn(async () => ({ success: true })),
            first: vi.fn(async () => {
              // Handle data source existence check
              if (sql.includes("FROM data_sources") && sql.includes("WHERE id = ?")) {
                const id = args[0] as string;
                const ds = dataSourcesData.find(d => d.id === id);
                return ds ? { id: ds.id } : null;
              }
              return null;
            }),
            all: vi.fn(async () => {
              // Handle lanes validation query
              if (sql.includes("FROM lanes") && sql.includes("WHERE id IN")) {
                const requestedIds = args as string[];
                const found = lanesData.filter(l => requestedIds.includes(l.id));
                return { results: found };
              }
              return { results: [] };
            }),
          })),
          run: vi.fn(async () => ({ success: true })),
          first: vi.fn(async () => null),
          all: vi.fn(async () => ({ results: [] })),
        })),
        batch: vi.fn(async () => [{ success: true }]),
      } as unknown as D1Database;
    }

    it("should set new lane assignments", async () => {
      const mockDb = createMockDbWithLanes({
        dataSources: [{ id: "ds_1", host_id: "host_123", type: "personal_cli", name: "nmem" }],
        lanes: [{ id: "lane_work" }, { id: "lane_learning" }],
      });
      const app = new Hono<{ Bindings: Env }>();
      app.use("*", mockDashboardAuth);
      app.route("/", dataSources);

      const res = await app.request(
        "/ds_1/lanes",
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ lane_ids: ["lane_work", "lane_learning"] }),
        },
        { DB: mockDb, DASHBOARD_SERVICE_TOKEN: "token" }
      );

      expect(res.status).toBe(200);
      const body = await res.json() as { data_source_id: string; lane_ids: string[] };
      expect(body.data_source_id).toBe("ds_1");
      expect(body.lane_ids).toEqual(["lane_work", "lane_learning"]);
      expect(mockDb.batch).toHaveBeenCalled();
    });

    it("should clear all lane assignments with empty array", async () => {
      const mockDb = createMockDbWithLanes({
        dataSources: [{ id: "ds_1", host_id: "host_123", type: "personal_cli", name: "nmem" }],
        dataSourceLanes: [{ data_source_id: "ds_1", lane_id: "lane_work" }],
      });
      const app = new Hono<{ Bindings: Env }>();
      app.use("*", mockDashboardAuth);
      app.route("/", dataSources);

      const res = await app.request(
        "/ds_1/lanes",
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ lane_ids: [] }),
        },
        { DB: mockDb, DASHBOARD_SERVICE_TOKEN: "token" }
      );

      expect(res.status).toBe(200);
      const body = await res.json() as { data_source_id: string; lane_ids: string[] };
      expect(body.lane_ids).toEqual([]);
    });

    it("should return 400 for lane_ids not array", async () => {
      const mockDb = createMockDbWithLanes({
        dataSources: [{ id: "ds_1", host_id: "host_123", type: "personal_cli", name: "nmem" }],
      });
      const app = new Hono<{ Bindings: Env }>();
      app.use("*", mockDashboardAuth);
      app.route("/", dataSources);

      const res = await app.request(
        "/ds_1/lanes",
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ lane_ids: "not_an_array" }),
        },
        { DB: mockDb, DASHBOARD_SERVICE_TOKEN: "token" }
      );

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error.message).toContain("array");
    });

    it("should return 400 for lane_ids containing non-string", async () => {
      const mockDb = createMockDbWithLanes({
        dataSources: [{ id: "ds_1", host_id: "host_123", type: "personal_cli", name: "nmem" }],
      });
      const app = new Hono<{ Bindings: Env }>();
      app.use("*", mockDashboardAuth);
      app.route("/", dataSources);

      const res = await app.request(
        "/ds_1/lanes",
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ lane_ids: ["lane_work", 123] }),
        },
        { DB: mockDb, DASHBOARD_SERVICE_TOKEN: "token" }
      );

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error.message).toContain("strings");
    });

    it("should return 404 for non-existent data source", async () => {
      const mockDb = createMockDbWithLanes({ dataSources: [] });
      const app = new Hono<{ Bindings: Env }>();
      app.use("*", mockDashboardAuth);
      app.route("/", dataSources);

      const res = await app.request(
        "/ds_nonexistent/lanes",
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ lane_ids: ["lane_work"] }),
        },
        { DB: mockDb, DASHBOARD_SERVICE_TOKEN: "token" }
      );

      expect(res.status).toBe(404);
    });

    it("should return 400 for invalid lane_id", async () => {
      const mockDb = createMockDbWithLanes({
        dataSources: [{ id: "ds_1", host_id: "host_123", type: "personal_cli", name: "nmem" }],
        lanes: [{ id: "lane_work" }],
      });
      const app = new Hono<{ Bindings: Env }>();
      app.use("*", mockDashboardAuth);
      app.route("/", dataSources);

      const res = await app.request(
        "/ds_1/lanes",
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ lane_ids: ["lane_work", "lane_invalid"] }),
        },
        { DB: mockDb, DASHBOARD_SERVICE_TOKEN: "token" }
      );

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error.message).toContain("lane_invalid");
    });

    it("should return 400 for invalid JSON body", async () => {
      const mockDb = createMockDbWithLanes({
        dataSources: [{ id: "ds_1", host_id: "host_123", type: "personal_cli", name: "nmem" }],
      });
      const app = new Hono<{ Bindings: Env }>();
      app.use("*", mockDashboardAuth);
      app.route("/", dataSources);

      const res = await app.request(
        "/ds_1/lanes",
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: "not json",
        },
        { DB: mockDb, DASHBOARD_SERVICE_TOKEN: "token" }
      );

      expect(res.status).toBe(400);
    });
  });
});
