import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import { NextRequest } from "next/server";

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
        setLanes: vi.fn(),
      },
    },
  };
});

import { PUT } from "../data-sources/[id]/lanes/route";
import { auth } from "@/auth";
import { workerApi, WorkerApiError } from "@/lib/worker-api";

const mockAuth = auth as Mock;
const mockSetLanes = workerApi.dataSources.setLanes as Mock;

function makeReq(body?: unknown): NextRequest {
  const init: RequestInit = { method: "PUT" };
  if (body !== undefined) {
    init.body = typeof body === "string" ? body : JSON.stringify(body);
    init.headers = { "Content-Type": "application/json" };
  }
  return new NextRequest(
    new URL("http://localhost:3000/api/data-sources/ds_1/lanes"),
    init
  );
}

const params = { params: Promise.resolve({ id: "ds_1" }) };

describe("PUT /api/data-sources/[id]/lanes", () => {
  beforeEach(() => vi.clearAllMocks());

  it("401 when unauthenticated", async () => {
    mockAuth.mockResolvedValue(null);
    const res = await PUT(makeReq({ lane_ids: [] }), params);
    expect(res.status).toBe(401);
  });

  it("400 when body not JSON", async () => {
    mockAuth.mockResolvedValue({ user: { email: "x@y.z" } });
    const res = await PUT(makeReq("nope"), params);
    expect(res.status).toBe(400);
  });

  it("400 when lane_ids missing", async () => {
    mockAuth.mockResolvedValue({ user: { email: "x@y.z" } });
    const res = await PUT(makeReq({}), params);
    expect(res.status).toBe(400);
    expect(mockSetLanes).not.toHaveBeenCalled();
  });

  it("400 when lane_ids contains unknown id", async () => {
    mockAuth.mockResolvedValue({ user: { email: "x@y.z" } });
    const res = await PUT(makeReq({ lane_ids: ["lane_misc"] }), params);
    expect(res.status).toBe(400);
    expect(mockSetLanes).not.toHaveBeenCalled();
  });

  it("200 sets lanes (empty array allowed = clear)", async () => {
    mockAuth.mockResolvedValue({ user: { email: "x@y.z" } });
    mockSetLanes.mockResolvedValue({
      data_source_id: "ds_1",
      lane_ids: [],
    });
    const res = await PUT(makeReq({ lane_ids: [] }), params);
    expect(res.status).toBe(200);
    expect(mockSetLanes).toHaveBeenCalledWith("ds_1", { lane_ids: [] });
  });

  it("200 sets lanes with multi", async () => {
    mockAuth.mockResolvedValue({ user: { email: "x@y.z" } });
    mockSetLanes.mockResolvedValue({
      data_source_id: "ds_1",
      lane_ids: ["lane_work", "lane_learning"],
    });
    const res = await PUT(
      makeReq({ lane_ids: ["lane_work", "lane_learning"] }),
      params
    );
    expect(res.status).toBe(200);
    const data = (await res.json()) as { lane_ids: string[] };
    expect(data.lane_ids).toEqual(["lane_work", "lane_learning"]);
  });

  it("propagates Worker 404", async () => {
    mockAuth.mockResolvedValue({ user: { email: "x@y.z" } });
    mockSetLanes.mockRejectedValue(new WorkerApiError("Missing DS", 404));
    const res = await PUT(makeReq({ lane_ids: ["lane_work"] }), params);
    expect(res.status).toBe(404);
  });
});
