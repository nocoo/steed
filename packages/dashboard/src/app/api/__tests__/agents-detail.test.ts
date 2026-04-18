import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import { NextRequest } from "next/server";
import type { Agent } from "@steed/shared";

vi.mock("@/auth", () => ({
  auth: vi.fn(),
}));

vi.mock("@/lib/worker-api", () => {
  class WorkerApiError extends Error {
    readonly status: number;
    constructor(message: string, status: number) {
      super(message);
      this.name = "WorkerApiError";
      this.status = status;
    }
  }
  return {
    WorkerApiError,
    workerApi: {
      agents: {
        get: vi.fn(),
        update: vi.fn(),
      },
    },
  };
});

import { GET, PATCH } from "../agents/[id]/route";
import { auth } from "@/auth";
import { workerApi, WorkerApiError } from "@/lib/worker-api";

const mockAuth = auth as Mock;
const mockGet = workerApi.agents.get as Mock;
const mockUpdate = workerApi.agents.update as Mock;

const baseAgent: Agent = {
  id: "agent_1",
  host_id: "host_1",
  match_key: "agent-a",
  nickname: "Alpha",
  role: "assistant",
  lane_id: "lane_work",
  metadata: {},
  extra: {},
  runtime_app: "node",
  runtime_version: "20.0.0",
  status: "running",
  created_at: "2024-01-01T00:00:00Z",
  last_seen_at: "2024-01-02T12:00:00Z",
};

function makeReq(method: "GET" | "PATCH", body?: unknown): NextRequest {
  const url = "http://localhost:3000/api/agents/agent_1";
  const init: RequestInit = { method };
  if (body !== undefined) {
    init.body = typeof body === "string" ? body : JSON.stringify(body);
    init.headers = { "Content-Type": "application/json" };
  }
  return new NextRequest(new URL(url), init);
}

const params = { params: Promise.resolve({ id: "agent_1" }) };

describe("GET /api/agents/[id]", () => {
  beforeEach(() => vi.clearAllMocks());

  it("401 when unauthenticated", async () => {
    mockAuth.mockResolvedValue(null);
    const res = await GET(makeReq("GET"), params);
    expect(res.status).toBe(401);
    expect(mockGet).not.toHaveBeenCalled();
  });

  it("returns agent when authenticated", async () => {
    mockAuth.mockResolvedValue({ user: { email: "x@y.z" } });
    mockGet.mockResolvedValue(baseAgent);
    const res = await GET(makeReq("GET"), params);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(baseAgent);
    expect(mockGet).toHaveBeenCalledWith("agent_1");
  });

  it("propagates Worker 404 with status code", async () => {
    mockAuth.mockResolvedValue({ user: { email: "x@y.z" } });
    mockGet.mockRejectedValue(new WorkerApiError("Agent not found", 404));
    const res = await GET(makeReq("GET"), params);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Agent not found" });
  });

  it("500 when worker throws generic Error", async () => {
    mockAuth.mockResolvedValue({ user: { email: "x@y.z" } });
    mockGet.mockRejectedValue(new Error("kaboom"));
    const res = await GET(makeReq("GET"), params);
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "kaboom" });
  });

  it("500 with 'Unknown error' when worker throws non-Error", async () => {
    mockAuth.mockResolvedValue({ user: { email: "x@y.z" } });
    mockGet.mockRejectedValue("oops");
    const res = await GET(makeReq("GET"), params);
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Unknown error" });
  });
});

describe("PATCH /api/agents/[id]", () => {
  beforeEach(() => vi.clearAllMocks());

  it("401 when unauthenticated", async () => {
    mockAuth.mockResolvedValue(null);
    const res = await PATCH(makeReq("PATCH", { nickname: "x" }), params);
    expect(res.status).toBe(401);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("400 when body is not JSON", async () => {
    mockAuth.mockResolvedValue({ user: { email: "x@y.z" } });
    const res = await PATCH(makeReq("PATCH", "not-json"), params);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Invalid JSON body" });
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("400 when body fails schema (unknown lane_id)", async () => {
    mockAuth.mockResolvedValue({ user: { email: "x@y.z" } });
    const res = await PATCH(
      makeReq("PATCH", { lane_id: "lane_misc" }),
      params
    );
    expect(res.status).toBe(400);
    const data = (await res.json()) as { error: string };
    expect(data.error).toBe("Invalid request body");
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("400 when body has no fields", async () => {
    mockAuth.mockResolvedValue({ user: { email: "x@y.z" } });
    const res = await PATCH(makeReq("PATCH", {}), params);
    expect(res.status).toBe(400);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("returns updated agent on success", async () => {
    mockAuth.mockResolvedValue({ user: { email: "x@y.z" } });
    const updated: Agent = { ...baseAgent, nickname: "Beta" };
    mockUpdate.mockResolvedValue(updated);
    const res = await PATCH(makeReq("PATCH", { nickname: "Beta" }), params);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(updated);
    expect(mockUpdate).toHaveBeenCalledWith("agent_1", { nickname: "Beta" });
  });

  it("propagates Worker 404 with status code", async () => {
    mockAuth.mockResolvedValue({ user: { email: "x@y.z" } });
    mockUpdate.mockRejectedValue(new WorkerApiError("Agent not found", 404));
    const res = await PATCH(makeReq("PATCH", { nickname: "Beta" }), params);
    expect(res.status).toBe(404);
  });
});
