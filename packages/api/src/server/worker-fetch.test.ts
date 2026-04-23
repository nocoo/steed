import { describe, it, expect, vi, beforeEach } from "vitest";
import { WorkerApiError, ApiHttpError } from "./errors";
import { createWorkerClient } from "./worker-fetch";
import type { ApiEnv } from "./context";

const mockEnv: ApiEnv = {
  WORKER_API_URL: "https://api.example.com",
  DASHBOARD_SERVICE_TOKEN: "test-token",
};

describe("WorkerApiError", () => {
  it("stores status and body", () => {
    const error = new WorkerApiError(404, { error: "not found" }, "Not found");
    expect(error.status).toBe(404);
    expect(error.body).toEqual({ error: "not found" });
    expect(error.message).toBe("Not found");
    expect(error.name).toBe("WorkerApiError");
  });
});

describe("ApiHttpError", () => {
  it("stores status and body", () => {
    const error = new ApiHttpError(400, { field: "invalid" }, "Bad request");
    expect(error.status).toBe(400);
    expect(error.body).toEqual({ field: "invalid" });
    expect(error.message).toBe("Bad request");
    expect(error.name).toBe("ApiHttpError");
  });
});

describe("createWorkerClient", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("creates client with all endpoints", () => {
    const client = createWorkerClient(mockEnv);
    expect(client.overview).toBeDefined();
    expect(client.hosts).toBeDefined();
    expect(client.agents).toBeDefined();
    expect(client.dataSources).toBeDefined();
    expect(client.lanes).toBeDefined();
    expect(client.bindings).toBeDefined();
  });

  describe("overview.get", () => {
    it("fetches overview from worker", async () => {
      const mockOverview = {
        host_count: 1,
        agent_count: 2,
        data_source_count: 3,
        binding_count: 4,
      };
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(JSON.stringify(mockOverview), { status: 200 })
      );

      const client = createWorkerClient(mockEnv);
      const result = await client.overview.get();

      expect(result).toEqual(mockOverview);
      expect(fetch).toHaveBeenCalledWith(
        "https://api.example.com/api/v1/overview",
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: "Bearer test-token",
          }),
        })
      );
    });

    it("throws WorkerApiError on non-2xx response", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { message: "Server error" } }), {
          status: 500,
        })
      );

      const client = createWorkerClient(mockEnv);
      await expect(client.overview.get()).rejects.toThrow(WorkerApiError);
    });

    it("handles non-JSON error response", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response("Internal Server Error", {
          status: 500,
          statusText: "Internal Server Error",
        })
      );

      const client = createWorkerClient(mockEnv);
      await expect(client.overview.get()).rejects.toThrow("Internal Server Error");
    });
  });

  describe("hosts.list", () => {
    it("fetches hosts list", async () => {
      const mockHosts = [{ id: "h1", name: "host1", status: "online" }];
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(JSON.stringify(mockHosts), { status: 200 })
      );

      const client = createWorkerClient(mockEnv);
      const result = await client.hosts.list();

      expect(result).toEqual(mockHosts);
    });
  });

  describe("agents.list", () => {
    it("builds query string from params", async () => {
      const mockResponse = { data: [], next_cursor: null };
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(JSON.stringify(mockResponse), { status: 200 })
      );

      const client = createWorkerClient(mockEnv);
      await client.agents.list({ host_id: "h1", status: "active", limit: 10 });

      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining("host_id=h1"),
        expect.anything()
      );
      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining("status=active"),
        expect.anything()
      );
      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining("limit=10"),
        expect.anything()
      );
    });

    it("handles lane_id and cursor params", async () => {
      const mockResponse = { data: [], next_cursor: null };
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(JSON.stringify(mockResponse), { status: 200 })
      );

      const client = createWorkerClient(mockEnv);
      await client.agents.list({ lane_id: "lane1", cursor: "abc123" });

      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining("lane_id=lane1"),
        expect.anything()
      );
      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining("cursor=abc123"),
        expect.anything()
      );
    });

    it("works without params", async () => {
      const mockResponse = { data: [], next_cursor: null };
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(JSON.stringify(mockResponse), { status: 200 })
      );

      const client = createWorkerClient(mockEnv);
      await client.agents.list();

      expect(fetch).toHaveBeenCalledWith(
        "https://api.example.com/api/v1/agents",
        expect.anything()
      );
    });

    it("works with empty params object", async () => {
      const mockResponse = { data: [], next_cursor: null };
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(JSON.stringify(mockResponse), { status: 200 })
      );

      const client = createWorkerClient(mockEnv);
      await client.agents.list({});

      expect(fetch).toHaveBeenCalledWith(
        "https://api.example.com/api/v1/agents",
        expect.anything()
      );
    });
  });

  describe("agents.get", () => {
    it("fetches single agent", async () => {
      const mockAgent = { id: "a1", nickname: "test" };
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(JSON.stringify(mockAgent), { status: 200 })
      );

      const client = createWorkerClient(mockEnv);
      const result = await client.agents.get("a1");

      expect(result).toEqual(mockAgent);
      expect(fetch).toHaveBeenCalledWith(
        "https://api.example.com/api/v1/agents/a1",
        expect.anything()
      );
    });
  });

  describe("agents.update", () => {
    it("sends PATCH request with body", async () => {
      const mockAgent = { id: "a1", nickname: "updated" };
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(JSON.stringify(mockAgent), { status: 200 })
      );

      const client = createWorkerClient(mockEnv);
      await client.agents.update("a1", { nickname: "updated" });

      expect(fetch).toHaveBeenCalledWith(
        "https://api.example.com/api/v1/agents/a1",
        expect.objectContaining({
          method: "PATCH",
          body: JSON.stringify({ nickname: "updated" }),
        })
      );
    });
  });

  describe("dataSources.list", () => {
    it("builds query string from all params", async () => {
      const mockResponse = { data: [], next_cursor: null };
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(JSON.stringify(mockResponse), { status: 200 })
      );

      const client = createWorkerClient(mockEnv);
      await client.dataSources.list({
        host_id: "h1",
        lane_id: "l1",
        status: "active",
        limit: 20,
        cursor: "xyz",
      });

      const callUrl = (fetch as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(callUrl).toContain("host_id=h1");
      expect(callUrl).toContain("lane_id=l1");
      expect(callUrl).toContain("status=active");
      expect(callUrl).toContain("limit=20");
      expect(callUrl).toContain("cursor=xyz");
    });

    it("works without params", async () => {
      const mockResponse = { data: [], next_cursor: null };
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(JSON.stringify(mockResponse), { status: 200 })
      );

      const client = createWorkerClient(mockEnv);
      await client.dataSources.list();

      expect(fetch).toHaveBeenCalledWith(
        "https://api.example.com/api/v1/data-sources",
        expect.anything()
      );
    });

    it("works with empty params object", async () => {
      const mockResponse = { data: [], next_cursor: null };
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(JSON.stringify(mockResponse), { status: 200 })
      );

      const client = createWorkerClient(mockEnv);
      await client.dataSources.list({});

      expect(fetch).toHaveBeenCalledWith(
        "https://api.example.com/api/v1/data-sources",
        expect.anything()
      );
    });
  });

  describe("dataSources.get", () => {
    it("fetches single data source", async () => {
      const mockDs = { id: "ds1", nickname: "test" };
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(JSON.stringify(mockDs), { status: 200 })
      );

      const client = createWorkerClient(mockEnv);
      const result = await client.dataSources.get("ds1");

      expect(result).toEqual(mockDs);
    });
  });

  describe("dataSources.update", () => {
    it("sends PATCH request", async () => {
      const mockDs = { id: "ds1", nickname: "updated" };
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(JSON.stringify(mockDs), { status: 200 })
      );

      const client = createWorkerClient(mockEnv);
      await client.dataSources.update("ds1", { nickname: "updated" });

      expect(fetch).toHaveBeenCalledWith(
        "https://api.example.com/api/v1/data-sources/ds1",
        expect.objectContaining({
          method: "PATCH",
        })
      );
    });
  });

  describe("dataSources.setLanes", () => {
    it("sends PUT request to lanes endpoint", async () => {
      const mockResponse = { added_lanes: ["l1"], removed_lanes: [] };
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(JSON.stringify(mockResponse), { status: 200 })
      );

      const client = createWorkerClient(mockEnv);
      await client.dataSources.setLanes("ds1", { lane_ids: ["l1"] });

      expect(fetch).toHaveBeenCalledWith(
        "https://api.example.com/api/v1/data-sources/ds1/lanes",
        expect.objectContaining({
          method: "PUT",
          body: JSON.stringify({ lane_ids: ["l1"] }),
        })
      );
    });
  });

  describe("lanes.list", () => {
    it("fetches lanes", async () => {
      const mockLanes = { data: [{ id: "l1", name: "Work" }] };
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(JSON.stringify(mockLanes), { status: 200 })
      );

      const client = createWorkerClient(mockEnv);
      const result = await client.lanes.list();

      expect(result).toEqual(mockLanes);
    });
  });

  describe("bindings.list", () => {
    it("builds query string from params", async () => {
      const mockResponse = { data: [], next_cursor: null };
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(JSON.stringify(mockResponse), { status: 200 })
      );

      const client = createWorkerClient(mockEnv);
      await client.bindings.list({
        agent_id: "a1",
        data_source_id: "ds1",
        limit: 5,
        cursor: "cur",
      });

      const callUrl = (fetch as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(callUrl).toContain("agent_id=a1");
      expect(callUrl).toContain("data_source_id=ds1");
      expect(callUrl).toContain("limit=5");
      expect(callUrl).toContain("cursor=cur");
    });

    it("works without params", async () => {
      const mockResponse = { data: [], next_cursor: null };
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(JSON.stringify(mockResponse), { status: 200 })
      );

      const client = createWorkerClient(mockEnv);
      await client.bindings.list();

      expect(fetch).toHaveBeenCalledWith(
        "https://api.example.com/api/v1/bindings",
        expect.anything()
      );
    });

    it("works with empty params object", async () => {
      const mockResponse = { data: [], next_cursor: null };
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(JSON.stringify(mockResponse), { status: 200 })
      );

      const client = createWorkerClient(mockEnv);
      await client.bindings.list({});

      expect(fetch).toHaveBeenCalledWith(
        "https://api.example.com/api/v1/bindings",
        expect.anything()
      );
    });
  });

  describe("bindings.create", () => {
    it("sends POST request", async () => {
      const mockBinding = { agent_id: "a1", data_source_id: "ds1" };
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(JSON.stringify(mockBinding), { status: 201 })
      );

      const client = createWorkerClient(mockEnv);
      await client.bindings.create({ agent_id: "a1", data_source_id: "ds1" });

      expect(fetch).toHaveBeenCalledWith(
        "https://api.example.com/api/v1/bindings",
        expect.objectContaining({
          method: "POST",
        })
      );
    });
  });

  describe("bindings.delete", () => {
    it("sends DELETE request and returns void", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(null, { status: 204 })
      );

      const client = createWorkerClient(mockEnv);
      await client.bindings.delete("agent1", "ds1");

      expect(fetch).toHaveBeenCalledWith(
        "https://api.example.com/api/v1/bindings/agent1/ds1",
        expect.objectContaining({ method: "DELETE" })
      );
    });

    it("throws on error response", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { message: "Not found" } }), {
          status: 404,
        })
      );

      const client = createWorkerClient(mockEnv);
      await expect(client.bindings.delete("agent1", "ds1")).rejects.toThrow(
        WorkerApiError
      );
    });
  });
});
