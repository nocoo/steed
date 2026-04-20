import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import { NextRequest } from "next/server";
import type { DataSourceWithLanes } from "@steed/shared";

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
      dataSources: {
        get: vi.fn(),
        update: vi.fn(),
      },
    },
  };
});

import { GET, PATCH } from "../data-sources/[id]/route";
import { auth } from "@/auth";
import { workerApi, WorkerApiError } from "@/lib/worker-api";

const mockAuth = auth as Mock;
const mockGet = workerApi.dataSources.get as Mock;
const mockUpdate = workerApi.dataSources.update as Mock;

const baseDS: DataSourceWithLanes = {
  id: "ds_1",
  host_id: "host_1",
  type: "personal_cli",
  name: "claude",
  version: "1.2.3",
  auth_status: "authenticated",
  status: "active",
  metadata: { notes: "primary" },
  created_at: "2024-01-01T00:00:00Z",
  last_seen_at: "2024-01-02T00:00:00Z",
  lane_ids: ["lane_work"],
};

function makeReq(method: "GET" | "PATCH", body?: unknown): NextRequest {
  const url = "http://localhost:3000/api/data-sources/ds_1";
  const init: { method: string; body?: string; headers?: Record<string, string> } = { method };
  if (body !== undefined) {
    init.body = typeof body === "string" ? body : JSON.stringify(body);
    init.headers = { "Content-Type": "application/json" };
  }
  return new NextRequest(new URL(url), init);
}

const params = { params: Promise.resolve({ id: "ds_1" }) };

describe("GET /api/data-sources/[id]", () => {
  beforeEach(() => vi.clearAllMocks());

  it("401 when unauthenticated", async () => {
    mockAuth.mockResolvedValue(null);
    const res = await GET(makeReq("GET"), params);
    expect(res.status).toBe(401);
    expect(mockGet).not.toHaveBeenCalled();
  });

  it("200 returns data source", async () => {
    mockAuth.mockResolvedValue({ user: { email: "x@y.z" } });
    mockGet.mockResolvedValue(baseDS);
    const res = await GET(makeReq("GET"), params);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(baseDS);
    expect(mockGet).toHaveBeenCalledWith("ds_1");
  });

  it("propagates Worker 404", async () => {
    mockAuth.mockResolvedValue({ user: { email: "x@y.z" } });
    mockGet.mockRejectedValue(new WorkerApiError("Not found", 404));
    const res = await GET(makeReq("GET"), params);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Not found" });
  });

  it("500 wraps generic Error", async () => {
    mockAuth.mockResolvedValue({ user: { email: "x@y.z" } });
    mockGet.mockRejectedValue(new Error("boom"));
    const res = await GET(makeReq("GET"), params);
    expect(res.status).toBe(500);
  });
});

describe("PATCH /api/data-sources/[id]", () => {
  beforeEach(() => vi.clearAllMocks());

  it("401 when unauthenticated", async () => {
    mockAuth.mockResolvedValue(null);
    const res = await PATCH(makeReq("PATCH", { metadata: {} }), params);
    expect(res.status).toBe(401);
  });

  it("400 when body not JSON", async () => {
    mockAuth.mockResolvedValue({ user: { email: "x@y.z" } });
    const res = await PATCH(makeReq("PATCH", "nope"), params);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Invalid JSON body" });
  });

  it("400 when metadata missing (schema requires it)", async () => {
    mockAuth.mockResolvedValue({ user: { email: "x@y.z" } });
    const res = await PATCH(makeReq("PATCH", {}), params);
    expect(res.status).toBe(400);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("400 when metadata is array (not plain object)", async () => {
    mockAuth.mockResolvedValue({ user: { email: "x@y.z" } });
    const res = await PATCH(makeReq("PATCH", { metadata: [] }), params);
    expect(res.status).toBe(400);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("200 returns updated DS", async () => {
    mockAuth.mockResolvedValue({ user: { email: "x@y.z" } });
    const updated = { ...baseDS, metadata: { notes: "n2" } };
    mockUpdate.mockResolvedValue(updated);
    const res = await PATCH(
      makeReq("PATCH", { metadata: { notes: "n2" } }),
      params
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(updated);
    expect(mockUpdate).toHaveBeenCalledWith("ds_1", {
      metadata: { notes: "n2" },
    });
  });

  it("propagates Worker 404", async () => {
    mockAuth.mockResolvedValue({ user: { email: "x@y.z" } });
    mockUpdate.mockRejectedValue(new WorkerApiError("Gone", 404));
    const res = await PATCH(
      makeReq("PATCH", { metadata: { x: 1 } }),
      params
    );
    expect(res.status).toBe(404);
  });
});
