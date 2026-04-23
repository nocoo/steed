import { describe, it, expect, vi, beforeEach } from "vitest";
import { createApiClient, ApiHttpError } from "./index";

describe("createApiClient", () => {
  const mockFetch = vi.fn();

  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("creates client with all endpoints", () => {
    const client = createApiClient({ baseUrl: "", fetch: mockFetch });

    expect(client.overview).toBeDefined();
    expect(client.hosts).toBeDefined();
    expect(client.lanes).toBeDefined();
    expect(client.agents).toBeDefined();
    expect(client.dataSources).toBeDefined();
    expect(client.bindings).toBeDefined();
    expect(client.map).toBeDefined();
  });

  describe("overview", () => {
    it("fetches overview", async () => {
      const mockOverview = { host_count: 5, agent_count: 10 };
      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify(mockOverview), { status: 200 })
      );

      const client = createApiClient({ baseUrl: "", fetch: mockFetch });
      const result = await client.overview.get();

      expect(result).toEqual(mockOverview);
      expect(mockFetch).toHaveBeenCalledWith("/api/overview", expect.anything());
    });
  });

  describe("hosts", () => {
    it("fetches hosts list", async () => {
      const mockHosts = [{ id: "h1", name: "host1", status: "online" }];
      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify(mockHosts), { status: 200 })
      );

      const client = createApiClient({ baseUrl: "", fetch: mockFetch });
      const result = await client.hosts.list();

      expect(result).toEqual(mockHosts);
      expect(mockFetch).toHaveBeenCalledWith("/api/hosts", expect.anything());
    });
  });

  describe("lanes", () => {
    it("fetches lanes and unwraps data", async () => {
      const mockLanes = { data: [{ id: "l1", name: "Work" }] };
      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify(mockLanes), { status: 200 })
      );

      const client = createApiClient({ baseUrl: "", fetch: mockFetch });
      const result = await client.lanes.list();

      expect(result).toEqual([{ id: "l1", name: "Work" }]);
    });
  });

  describe("agents", () => {
    it("lists agents with query params", async () => {
      const mockAgents = { data: [], next_cursor: null };
      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify(mockAgents), { status: 200 })
      );

      const client = createApiClient({ baseUrl: "", fetch: mockFetch });
      await client.agents.list({ host_id: "h1", limit: 50 });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("host_id=h1"),
        expect.anything()
      );
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("limit=50"),
        expect.anything()
      );
    });

    it("lists agents without params", async () => {
      const mockAgents = { data: [], next_cursor: null };
      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify(mockAgents), { status: 200 })
      );

      const client = createApiClient({ baseUrl: "", fetch: mockFetch });
      await client.agents.list();

      expect(mockFetch).toHaveBeenCalledWith("/api/agents", expect.anything());
    });

    it("lists agents with all params", async () => {
      const mockAgents = { data: [], next_cursor: null };
      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify(mockAgents), { status: 200 })
      );

      const client = createApiClient({ baseUrl: "", fetch: mockFetch });
      await client.agents.list({
        host_id: "h1",
        lane_id: "l1",
        status: "active",
        limit: 50,
        cursor: "abc",
      });

      const callUrl = mockFetch.mock.calls[0][0] as string;
      expect(callUrl).toContain("host_id=h1");
      expect(callUrl).toContain("lane_id=l1");
      expect(callUrl).toContain("status=active");
      expect(callUrl).toContain("limit=50");
      expect(callUrl).toContain("cursor=abc");
    });

    it("gets single agent", async () => {
      const mockAgent = { id: "a1", nickname: "test" };
      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify(mockAgent), { status: 200 })
      );

      const client = createApiClient({ baseUrl: "", fetch: mockFetch });
      const result = await client.agents.get("a1");

      expect(result).toEqual(mockAgent);
      expect(mockFetch).toHaveBeenCalledWith(
        "/api/agents/a1",
        expect.anything()
      );
    });

    it("updates agent", async () => {
      const mockAgent = { id: "a1", nickname: "updated" };
      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify(mockAgent), { status: 200 })
      );

      const client = createApiClient({ baseUrl: "", fetch: mockFetch });
      await client.agents.update("a1", { nickname: "updated" });

      expect(mockFetch).toHaveBeenCalledWith(
        "/api/agents/a1",
        expect.objectContaining({ method: "PATCH" })
      );
    });

    it("lists agent bindings", async () => {
      const mockBindings = { data: [{ agent_id: "a1", data_source_id: "ds1" }], next_cursor: null };
      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify(mockBindings), { status: 200 })
      );

      const client = createApiClient({ baseUrl: "", fetch: mockFetch });
      const result = await client.agents.listBindings("a1");

      expect(result).toEqual([{ agent_id: "a1", data_source_id: "ds1" }]);
      expect(mockFetch).toHaveBeenCalledWith(
        "/api/bindings?agent_id=a1",
        expect.anything()
      );
    });
  });

  describe("dataSources", () => {
    it("lists data sources with query params", async () => {
      const mockDs = { data: [], next_cursor: null };
      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify(mockDs), { status: 200 })
      );

      const client = createApiClient({ baseUrl: "", fetch: mockFetch });
      await client.dataSources.list({ host_id: "h1" });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("host_id=h1"),
        expect.anything()
      );
    });

    it("lists data sources without params", async () => {
      const mockDs = { data: [], next_cursor: null };
      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify(mockDs), { status: 200 })
      );

      const client = createApiClient({ baseUrl: "", fetch: mockFetch });
      await client.dataSources.list();

      expect(mockFetch).toHaveBeenCalledWith(
        "/api/data-sources",
        expect.anything()
      );
    });

    it("lists data sources with all params", async () => {
      const mockDs = { data: [], next_cursor: null };
      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify(mockDs), { status: 200 })
      );

      const client = createApiClient({ baseUrl: "", fetch: mockFetch });
      await client.dataSources.list({
        host_id: "h1",
        lane_id: "l1",
        status: "connected",
        limit: 100,
        cursor: "xyz",
      });

      const callUrl = mockFetch.mock.calls[0][0] as string;
      expect(callUrl).toContain("host_id=h1");
      expect(callUrl).toContain("lane_id=l1");
      expect(callUrl).toContain("status=connected");
      expect(callUrl).toContain("limit=100");
      expect(callUrl).toContain("cursor=xyz");
    });

    it("gets single data source", async () => {
      const mockDs = { id: "ds1", name: "test" };
      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify(mockDs), { status: 200 })
      );

      const client = createApiClient({ baseUrl: "", fetch: mockFetch });
      const result = await client.dataSources.get("ds1");

      expect(result).toEqual(mockDs);
    });

    it("updates data source", async () => {
      const mockDs = { id: "ds1", nickname: "updated" };
      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify(mockDs), { status: 200 })
      );

      const client = createApiClient({ baseUrl: "", fetch: mockFetch });
      await client.dataSources.update("ds1", { nickname: "updated" });

      expect(mockFetch).toHaveBeenCalledWith(
        "/api/data-sources/ds1",
        expect.objectContaining({ method: "PATCH" })
      );
    });

    it("sets lanes", async () => {
      const mockRes = { added_lanes: ["l1"], removed_lanes: [] };
      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify(mockRes), { status: 200 })
      );

      const client = createApiClient({ baseUrl: "", fetch: mockFetch });
      const result = await client.dataSources.setLanes("ds1", {
        lane_ids: ["l1"],
      });

      expect(result).toEqual(mockRes);
      expect(mockFetch).toHaveBeenCalledWith(
        "/api/data-sources/ds1/lanes",
        expect.objectContaining({ method: "PUT" })
      );
    });
  });

  describe("bindings", () => {
    it("lists bindings with params", async () => {
      const mockBindings = { data: [], next_cursor: null };
      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify(mockBindings), { status: 200 })
      );

      const client = createApiClient({ baseUrl: "", fetch: mockFetch });
      await client.bindings.list({ agent_id: "a1" });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("agent_id=a1"),
        expect.anything()
      );
    });

    it("lists bindings without params", async () => {
      const mockBindings = { data: [], next_cursor: null };
      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify(mockBindings), { status: 200 })
      );

      const client = createApiClient({ baseUrl: "", fetch: mockFetch });
      await client.bindings.list();

      expect(mockFetch).toHaveBeenCalledWith("/api/bindings", expect.anything());
    });

    it("lists bindings with all params", async () => {
      const mockBindings = { data: [], next_cursor: null };
      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify(mockBindings), { status: 200 })
      );

      const client = createApiClient({ baseUrl: "", fetch: mockFetch });
      await client.bindings.list({
        agent_id: "a1",
        data_source_id: "ds1",
        limit: 10,
        cursor: "cur",
      });

      const callUrl = mockFetch.mock.calls[0][0] as string;
      expect(callUrl).toContain("agent_id=a1");
      expect(callUrl).toContain("data_source_id=ds1");
      expect(callUrl).toContain("limit=10");
      expect(callUrl).toContain("cursor=cur");
    });

    it("creates binding", async () => {
      const mockBinding = { agent_id: "a1", data_source_id: "ds1" };
      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify(mockBinding), { status: 201 })
      );

      const client = createApiClient({ baseUrl: "", fetch: mockFetch });
      const result = await client.bindings.create({
        agent_id: "a1",
        data_source_id: "ds1",
      });

      expect(result).toEqual(mockBinding);
      expect(mockFetch).toHaveBeenCalledWith(
        "/api/bindings",
        expect.objectContaining({ method: "POST" })
      );
    });

    it("deletes binding", async () => {
      mockFetch.mockResolvedValueOnce(new Response(null, { status: 204 }));

      const client = createApiClient({ baseUrl: "", fetch: mockFetch });
      await client.bindings.delete("a1", "ds1");

      expect(mockFetch).toHaveBeenCalledWith(
        "/api/bindings/a1/ds1",
        expect.objectContaining({ method: "DELETE" })
      );
    });
  });

  describe("map", () => {
    it("fetches map data", async () => {
      const mockMap = {
        hosts: [],
        agents: [],
        data_sources: [],
        bindings: [],
        lanes: [],
        graph: { nodes: [], edges: [] },
      };
      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify(mockMap), { status: 200 })
      );

      const client = createApiClient({ baseUrl: "", fetch: mockFetch });
      const result = await client.map.get();

      expect(result).toEqual(mockMap);
      expect(mockFetch).toHaveBeenCalledWith("/api/map", expect.anything());
    });
  });

  describe("error handling", () => {
    it("throws ApiHttpError on non-2xx response", async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({ error: { message: "Not found" } }),
          { status: 404 }
        )
      );

      const client = createApiClient({ baseUrl: "", fetch: mockFetch });
      await expect(client.agents.get("a1")).rejects.toThrow(ApiHttpError);
    });

    it("uses statusText when error body has no message", async () => {
      mockFetch.mockResolvedValueOnce(
        new Response("{}", { status: 500, statusText: "Server Error" })
      );

      const client = createApiClient({ baseUrl: "", fetch: mockFetch });
      try {
        await client.agents.get("a1");
      } catch (e) {
        expect(e).toBeInstanceOf(ApiHttpError);
        expect((e as ApiHttpError).message).toBe("HTTP 500");
      }
    });

    it("handles non-JSON error response", async () => {
      mockFetch.mockResolvedValueOnce(
        new Response("Internal Server Error", {
          status: 500,
          statusText: "Internal Server Error",
        })
      );

      const client = createApiClient({ baseUrl: "", fetch: mockFetch });
      try {
        await client.agents.get("a1");
      } catch (e) {
        expect(e).toBeInstanceOf(ApiHttpError);
        expect((e as ApiHttpError).message).toBe("Internal Server Error");
      }
    });
  });

  describe("options", () => {
    it("uses baseUrl", async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify([]), { status: 200 })
      );

      const client = createApiClient({
        baseUrl: "https://api.example.com",
        fetch: mockFetch,
      });
      await client.hosts.list();

      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.example.com/api/hosts",
        expect.anything()
      );
    });

    it("uses custom headers", async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify([]), { status: 200 })
      );

      const client = createApiClient({
        baseUrl: "",
        fetch: mockFetch,
        headers: () => ({ "X-Custom": "value" }),
      });
      await client.hosts.list();

      const headers = mockFetch.mock.calls[0][1].headers as Headers;
      expect(headers.get("X-Custom")).toBe("value");
    });
  });
});
