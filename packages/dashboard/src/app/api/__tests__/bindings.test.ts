import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import { NextRequest } from "next/server";
import type { Binding } from "@steed/shared";

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
      bindings: {
        list: vi.fn(),
        create: vi.fn(),
        delete: vi.fn(),
      },
    },
  };
});

import { GET, POST } from "../bindings/route";
import { DELETE as DEL } from "../bindings/[agent_id]/[data_source_id]/route";
import { auth } from "@/auth";
import { workerApi, WorkerApiError } from "@/lib/worker-api";

const mockAuth = auth as Mock;
const mockList = workerApi.bindings.list as Mock;
const mockCreate = workerApi.bindings.create as Mock;
const mockDelete = workerApi.bindings.delete as Mock;

const sample: Binding = {
  agent_id: "agent_1",
  data_source_id: "ds_1",
  created_at: "2024-01-01T00:00:00Z",
};

function listReq(query = ""): NextRequest {
  return new NextRequest(
    new URL(`http://localhost:3000/api/bindings${query}`),
    { method: "GET" }
  );
}

function postReq(body: unknown): NextRequest {
  const init: RequestInit = {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  };
  return new NextRequest(new URL("http://localhost:3000/api/bindings"), init);
}

function delReq(): NextRequest {
  return new NextRequest(
    new URL("http://localhost:3000/api/bindings/agent_1/ds_1"),
    { method: "DELETE" }
  );
}

const delParams = {
  params: Promise.resolve({ agent_id: "agent_1", data_source_id: "ds_1" }),
};

describe("GET /api/bindings", () => {
  beforeEach(() => vi.clearAllMocks());

  it("401 when unauthenticated", async () => {
    mockAuth.mockResolvedValue(null);
    const res = await GET(listReq());
    expect(res.status).toBe(401);
    expect(mockList).not.toHaveBeenCalled();
  });

  it("200 with no filter", async () => {
    mockAuth.mockResolvedValue({ user: { email: "x@y.z" } });
    mockList.mockResolvedValue({ data: [sample], next_cursor: null });
    const res = await GET(listReq());
    expect(res.status).toBe(200);
    expect(mockList).toHaveBeenCalledWith({});
  });

  it("200 with filters and pagination", async () => {
    mockAuth.mockResolvedValue({ user: { email: "x@y.z" } });
    mockList.mockResolvedValue({ data: [], next_cursor: null });
    const res = await GET(
      listReq("?agent_id=agent_1&data_source_id=ds_1&limit=10&cursor=abc")
    );
    expect(res.status).toBe(200);
    expect(mockList).toHaveBeenCalledWith({
      agent_id: "agent_1",
      data_source_id: "ds_1",
      limit: 10,
      cursor: "abc",
    });
  });

  it("400 on invalid limit", async () => {
    mockAuth.mockResolvedValue({ user: { email: "x@y.z" } });
    const res = await GET(listReq("?limit=-3"));
    expect(res.status).toBe(400);
    expect(mockList).not.toHaveBeenCalled();
  });

  it("400 on non-numeric limit", async () => {
    mockAuth.mockResolvedValue({ user: { email: "x@y.z" } });
    const res = await GET(listReq("?limit=abc"));
    expect(res.status).toBe(400);
  });

  it("propagates Worker error", async () => {
    mockAuth.mockResolvedValue({ user: { email: "x@y.z" } });
    mockList.mockRejectedValue(new WorkerApiError("denied", 403));
    const res = await GET(listReq());
    expect(res.status).toBe(403);
  });
});

describe("POST /api/bindings", () => {
  beforeEach(() => vi.clearAllMocks());

  it("401 when unauthenticated", async () => {
    mockAuth.mockResolvedValue(null);
    const res = await POST(postReq({ agent_id: "a", data_source_id: "d" }));
    expect(res.status).toBe(401);
  });

  it("400 on bad JSON", async () => {
    mockAuth.mockResolvedValue({ user: { email: "x@y.z" } });
    const res = await POST(postReq("nope"));
    expect(res.status).toBe(400);
  });

  it("400 on missing fields", async () => {
    mockAuth.mockResolvedValue({ user: { email: "x@y.z" } });
    const res = await POST(postReq({ agent_id: "a" }));
    expect(res.status).toBe(400);
  });

  it("400 on empty fields", async () => {
    mockAuth.mockResolvedValue({ user: { email: "x@y.z" } });
    const res = await POST(postReq({ agent_id: "", data_source_id: "" }));
    expect(res.status).toBe(400);
  });

  it("201 on success", async () => {
    mockAuth.mockResolvedValue({ user: { email: "x@y.z" } });
    mockCreate.mockResolvedValue(sample);
    const res = await POST(
      postReq({ agent_id: "agent_1", data_source_id: "ds_1" })
    );
    expect(res.status).toBe(201);
    expect(mockCreate).toHaveBeenCalledWith({
      agent_id: "agent_1",
      data_source_id: "ds_1",
    });
  });

  it("propagates Worker 409 conflict", async () => {
    mockAuth.mockResolvedValue({ user: { email: "x@y.z" } });
    mockCreate.mockRejectedValue(new WorkerApiError("Already bound", 409));
    const res = await POST(
      postReq({ agent_id: "agent_1", data_source_id: "ds_1" })
    );
    expect(res.status).toBe(409);
  });
});

describe("DELETE /api/bindings/[agent_id]/[data_source_id]", () => {
  beforeEach(() => vi.clearAllMocks());

  it("401 when unauthenticated", async () => {
    mockAuth.mockResolvedValue(null);
    const res = await DEL(delReq(), delParams);
    expect(res.status).toBe(401);
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it("204 on success", async () => {
    mockAuth.mockResolvedValue({ user: { email: "x@y.z" } });
    mockDelete.mockResolvedValue(undefined);
    const res = await DEL(delReq(), delParams);
    expect(res.status).toBe(204);
    expect(mockDelete).toHaveBeenCalledWith("agent_1", "ds_1");
  });

  it("propagates Worker 404", async () => {
    mockAuth.mockResolvedValue({ user: { email: "x@y.z" } });
    mockDelete.mockRejectedValue(new WorkerApiError("Not bound", 404));
    const res = await DEL(delReq(), delParams);
    expect(res.status).toBe(404);
  });
});
