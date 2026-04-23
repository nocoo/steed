import { describe, it, expect, vi, beforeEach } from "vitest";
import { createApiRouter } from "./api-router";
import type { WorkerClient } from "./worker-fetch";

const mockWorkerClient: WorkerClient = {
  overview: {
    get: vi.fn().mockResolvedValue({ host_count: 1 }),
  },
  hosts: {
    list: vi.fn().mockResolvedValue([{ id: "h1", name: "host1" }]),
  },
  agents: {
    list: vi.fn().mockResolvedValue({ data: [], next_cursor: null }),
    get: vi.fn().mockResolvedValue({ id: "a1" }),
    update: vi.fn().mockResolvedValue({ id: "a1", nickname: "updated" }),
  },
  dataSources: {
    list: vi.fn().mockResolvedValue({ data: [], next_cursor: null }),
    get: vi.fn().mockResolvedValue({ id: "ds1" }),
    update: vi.fn().mockResolvedValue({ id: "ds1" }),
    setLanes: vi.fn().mockResolvedValue({ added_lanes: [], removed_lanes: [] }),
  },
  lanes: {
    list: vi.fn().mockResolvedValue({ data: [{ id: "l1", name: "Work" }] }),
  },
  bindings: {
    list: vi.fn().mockResolvedValue({ data: [], next_cursor: null }),
    create: vi.fn().mockResolvedValue({ agent_id: "a1", data_source_id: "ds1" }),
    delete: vi.fn().mockResolvedValue(undefined),
  },
};

vi.mock("./worker-fetch", () => ({
  createWorkerClient: () => mockWorkerClient,
  WorkerApiError: class WorkerApiError extends Error {
    status: number;
    body: unknown;
    constructor(status: number, body: unknown, message: string) {
      super(message);
      this.status = status;
      this.body = body;
    }
  },
}));

describe("createApiRouter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const env = { WORKER_API_URL: "http://test", DASHBOARD_SERVICE_TOKEN: "tok" };
  const user = { email: "test@example.com", sub: "123" };

  it("handles GET /api/overview", async () => {
    const router = createApiRouter();
    const req = new Request("https://example.com/api/overview");
    const res = await router.fetch(req, env, user);

    expect(res.status).toBe(200);
    expect(mockWorkerClient.overview.get).toHaveBeenCalled();
  });

  it("handles GET /api/hosts", async () => {
    const router = createApiRouter();
    const req = new Request("https://example.com/api/hosts");
    const res = await router.fetch(req, env, user);

    expect(res.status).toBe(200);
    expect(mockWorkerClient.hosts.list).toHaveBeenCalled();
  });

  it("handles GET /api/lanes", async () => {
    const router = createApiRouter();
    const req = new Request("https://example.com/api/lanes");
    const res = await router.fetch(req, env, user);

    expect(res.status).toBe(200);
    expect(mockWorkerClient.lanes.list).toHaveBeenCalled();
  });

  it("handles GET /api/agents with all query params", async () => {
    const router = createApiRouter();
    const req = new Request("https://example.com/api/agents?host_id=h1&limit=10");
    const res = await router.fetch(req, env, user);

    expect(res.status).toBe(200);
    expect(mockWorkerClient.agents.list).toHaveBeenCalledWith(
      expect.objectContaining({ host_id: "h1", limit: 10 })
    );
  });

  it("handles GET /api/agents with lane_id, status, cursor params", async () => {
    const router = createApiRouter();
    const req = new Request("https://example.com/api/agents?lane_id=l1&status=active&cursor=abc");
    const res = await router.fetch(req, env, user);

    expect(res.status).toBe(200);
    expect(mockWorkerClient.agents.list).toHaveBeenCalledWith(
      expect.objectContaining({ lane_id: "l1", status: "active", cursor: "abc" })
    );
  });

  it("handles GET /api/agents without any params", async () => {
    const router = createApiRouter();
    const req = new Request("https://example.com/api/agents");
    const res = await router.fetch(req, env, user);

    expect(res.status).toBe(200);
    expect(mockWorkerClient.agents.list).toHaveBeenCalledWith(
      expect.objectContaining({
        host_id: undefined,
        lane_id: undefined,
        status: undefined,
        limit: undefined,
        cursor: undefined,
      })
    );
  });

  it("handles GET /api/agents/:id", async () => {
    const router = createApiRouter();
    const req = new Request("https://example.com/api/agents/a1");
    const res = await router.fetch(req, env, user);

    expect(res.status).toBe(200);
    expect(mockWorkerClient.agents.get).toHaveBeenCalledWith("a1");
  });

  it("handles PATCH /api/agents/:id", async () => {
    const router = createApiRouter();
    const req = new Request("https://example.com/api/agents/a1", {
      method: "PATCH",
      body: JSON.stringify({ nickname: "new" }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await router.fetch(req, env, user);

    expect(res.status).toBe(200);
    expect(mockWorkerClient.agents.update).toHaveBeenCalledWith("a1", {
      nickname: "new",
    });
  });

  it("returns 400 for invalid agent update body", async () => {
    const router = createApiRouter();
    const req = new Request("https://example.com/api/agents/a1", {
      method: "PATCH",
      body: JSON.stringify({ lane_id: "invalid_lane" }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await router.fetch(req, env, user);

    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error.issues).toBeDefined();
  });

  it("returns 400 for empty agent update body", async () => {
    const router = createApiRouter();
    const req = new Request("https://example.com/api/agents/a1", {
      method: "PATCH",
      body: JSON.stringify({}),
      headers: { "Content-Type": "application/json" },
    });
    const res = await router.fetch(req, env, user);

    expect(res.status).toBe(400);
  });

  it("handles GET /api/data-sources", async () => {
    const router = createApiRouter();
    const req = new Request("https://example.com/api/data-sources");
    const res = await router.fetch(req, env, user);

    expect(res.status).toBe(200);
    expect(mockWorkerClient.dataSources.list).toHaveBeenCalled();
  });

  it("handles GET /api/data-sources with all query params", async () => {
    const router = createApiRouter();
    const req = new Request("https://example.com/api/data-sources?host_id=h1&lane_id=l1&status=active&limit=50&cursor=xyz");
    const res = await router.fetch(req, env, user);

    expect(res.status).toBe(200);
    expect(mockWorkerClient.dataSources.list).toHaveBeenCalledWith(
      expect.objectContaining({
        host_id: "h1",
        lane_id: "l1",
        status: "active",
        limit: 50,
        cursor: "xyz",
      })
    );
  });

  it("handles GET /api/data-sources/:id", async () => {
    const router = createApiRouter();
    const req = new Request("https://example.com/api/data-sources/ds1");
    const res = await router.fetch(req, env, user);

    expect(res.status).toBe(200);
    expect(mockWorkerClient.dataSources.get).toHaveBeenCalledWith("ds1");
  });

  it("handles PATCH /api/data-sources/:id", async () => {
    const router = createApiRouter();
    const req = new Request("https://example.com/api/data-sources/ds1", {
      method: "PATCH",
      body: JSON.stringify({ metadata: {} }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await router.fetch(req, env, user);

    expect(res.status).toBe(200);
    expect(mockWorkerClient.dataSources.update).toHaveBeenCalled();
  });

  it("returns 400 for missing metadata in data source update", async () => {
    const router = createApiRouter();
    const req = new Request("https://example.com/api/data-sources/ds1", {
      method: "PATCH",
      body: JSON.stringify({}),
      headers: { "Content-Type": "application/json" },
    });
    const res = await router.fetch(req, env, user);

    expect(res.status).toBe(400);
  });

  it("handles PUT /api/data-sources/:id/lanes", async () => {
    const router = createApiRouter();
    const req = new Request("https://example.com/api/data-sources/ds1/lanes", {
      method: "PUT",
      body: JSON.stringify({ lane_ids: ["lane_work"] }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await router.fetch(req, env, user);

    expect(res.status).toBe(200);
    expect(mockWorkerClient.dataSources.setLanes).toHaveBeenCalled();
  });

  it("returns 400 for invalid lane_ids in PUT /api/data-sources/:id/lanes", async () => {
    const router = createApiRouter();
    const req = new Request("https://example.com/api/data-sources/ds1/lanes", {
      method: "PUT",
      body: JSON.stringify({ lane_ids: ["invalid_lane"] }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await router.fetch(req, env, user);

    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error.issues).toBeDefined();
  });

  it("handles GET /api/bindings", async () => {
    const router = createApiRouter();
    const req = new Request("https://example.com/api/bindings");
    const res = await router.fetch(req, env, user);

    expect(res.status).toBe(200);
    expect(mockWorkerClient.bindings.list).toHaveBeenCalled();
  });

  it("handles GET /api/bindings with all query params", async () => {
    const router = createApiRouter();
    const req = new Request("https://example.com/api/bindings?agent_id=a1&data_source_id=ds1&limit=100&cursor=c1");
    const res = await router.fetch(req, env, user);

    expect(res.status).toBe(200);
    expect(mockWorkerClient.bindings.list).toHaveBeenCalledWith(
      expect.objectContaining({
        agent_id: "a1",
        data_source_id: "ds1",
        limit: 100,
        cursor: "c1",
      })
    );
  });

  it("handles POST /api/bindings", async () => {
    const router = createApiRouter();
    const req = new Request("https://example.com/api/bindings", {
      method: "POST",
      body: JSON.stringify({ agent_id: "a1", data_source_id: "ds1" }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await router.fetch(req, env, user);

    expect(res.status).toBe(201);
    expect(mockWorkerClient.bindings.create).toHaveBeenCalled();
  });

  it("returns 400 for invalid binding create body", async () => {
    const router = createApiRouter();
    const req = new Request("https://example.com/api/bindings", {
      method: "POST",
      body: JSON.stringify({ agent_id: "" }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await router.fetch(req, env, user);

    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error.issues).toBeDefined();
  });

  it("returns 400 for invalid limit in GET /api/bindings", async () => {
    const router = createApiRouter();
    const req = new Request("https://example.com/api/bindings?limit=-5");
    const res = await router.fetch(req, env, user);

    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error.message).toBe("Invalid limit");
  });

  it("returns 400 for non-numeric limit in GET /api/bindings", async () => {
    const router = createApiRouter();
    const req = new Request("https://example.com/api/bindings?limit=abc");
    const res = await router.fetch(req, env, user);

    expect(res.status).toBe(400);
  });

  it("handles DELETE /api/bindings/:agentId/:dataSourceId", async () => {
    const router = createApiRouter();
    const req = new Request("https://example.com/api/bindings/a1/ds1", {
      method: "DELETE",
    });
    const res = await router.fetch(req, env, user);

    expect(res.status).toBe(204);
    expect(mockWorkerClient.bindings.delete).toHaveBeenCalledWith("a1", "ds1");
  });

  it("handles GET /api/map", async () => {
    const router = createApiRouter();
    const req = new Request("https://example.com/api/map");
    const res = await router.fetch(req, env, user);

    expect(res.status).toBe(200);
    expect(mockWorkerClient.hosts.list).toHaveBeenCalled();
    expect(mockWorkerClient.agents.list).toHaveBeenCalled();
    expect(mockWorkerClient.dataSources.list).toHaveBeenCalled();
    expect(mockWorkerClient.bindings.list).toHaveBeenCalled();
    expect(mockWorkerClient.lanes.list).toHaveBeenCalled();
  });

  it("handles GET /api/map with data sources and fallback on get error", async () => {
    vi.mocked(mockWorkerClient.dataSources.list).mockResolvedValueOnce({
      data: [
        { id: "ds1", host_id: "h1", name: "DS1", match_key: "ds1", status: "connected" },
        { id: "ds2", host_id: "h1", name: "DS2", match_key: "ds2", status: "connected" },
      ],
      next_cursor: null,
    });
    vi.mocked(mockWorkerClient.dataSources.get)
      .mockResolvedValueOnce({ id: "ds1", host_id: "h1", name: "DS1", match_key: "ds1", status: "connected", metadata: {}, lane_ids: ["l1"] })
      .mockRejectedValueOnce(new Error("Not found"));

    const router = createApiRouter();
    const req = new Request("https://example.com/api/map");
    const res = await router.fetch(req, env, user);

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.data_sources).toHaveLength(2);
    expect(data.data_sources[0].lane_ids).toEqual(["l1"]);
    expect(data.data_sources[1].lane_ids).toEqual([]);
  });

  it("returns 404 for unknown routes", async () => {
    const router = createApiRouter();
    const req = new Request("https://example.com/api/unknown");
    const res = await router.fetch(req, env, user);

    expect(res.status).toBe(404);
  });

  it("returns 400 for invalid JSON body", async () => {
    const router = createApiRouter();
    const req = new Request("https://example.com/api/agents/a1", {
      method: "PATCH",
      body: "not json",
      headers: { "Content-Type": "application/json" },
    });
    const res = await router.fetch(req, env, user);

    expect(res.status).toBe(400);
  });

  it("returns 400 for invalid JSON in POST /api/bindings", async () => {
    const router = createApiRouter();
    const req = new Request("https://example.com/api/bindings", {
      method: "POST",
      body: "not json",
      headers: { "Content-Type": "application/json" },
    });
    const res = await router.fetch(req, env, user);

    expect(res.status).toBe(400);
  });

  it("returns 400 for invalid JSON in PATCH /api/data-sources/:id", async () => {
    const router = createApiRouter();
    const req = new Request("https://example.com/api/data-sources/ds1", {
      method: "PATCH",
      body: "not json",
      headers: { "Content-Type": "application/json" },
    });
    const res = await router.fetch(req, env, user);

    expect(res.status).toBe(400);
  });

  it("returns 400 for invalid JSON in PUT /api/data-sources/:id/lanes", async () => {
    const router = createApiRouter();
    const req = new Request("https://example.com/api/data-sources/ds1/lanes", {
      method: "PUT",
      body: "not json",
      headers: { "Content-Type": "application/json" },
    });
    const res = await router.fetch(req, env, user);

    expect(res.status).toBe(400);
  });
});
