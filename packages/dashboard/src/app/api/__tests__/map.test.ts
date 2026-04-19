import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import type {
  AgentListItem,
  Binding,
  DataSourceListItem,
  DataSourceWithLanes,
  HostWithStatus,
  Lane,
} from "@steed/shared";

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
      hosts: { list: vi.fn() },
      agents: { list: vi.fn() },
      dataSources: { list: vi.fn(), get: vi.fn() },
      bindings: { list: vi.fn() },
      lanes: { list: vi.fn() },
    },
  };
});

import { GET } from "../map/route";
import { auth } from "@/auth";
import { workerApi, WorkerApiError } from "@/lib/worker-api";

const mockAuth = auth as Mock;
const mockHosts = workerApi.hosts.list as Mock;
const mockAgents = workerApi.agents.list as Mock;
const mockDsList = workerApi.dataSources.list as Mock;
const mockDsGet = workerApi.dataSources.get as Mock;
const mockBindings = workerApi.bindings.list as Mock;
const mockLanes = workerApi.lanes.list as Mock;

const host: HostWithStatus = {
  id: "h1",
  name: "host_a",
  api_key_hash: "x",
  created_at: "2024-01-01T00:00:00Z",
  last_seen_at: "2024-01-02T00:00:00Z",
  status: "online",
};

const agent: AgentListItem = {
  id: "a1",
  host_id: "h1",
  match_key: "agent_1",
  nickname: "n",
  role: null,
  lane_id: "lane_work",
  runtime_app: "node",
  runtime_version: "20",
  status: "running",
  created_at: "",
  last_seen_at: null,
};

const dsListItem: DataSourceListItem = {
  id: "ds1",
  host_id: "h1",
  type: "personal_cli",
  name: "claude",
  version: null,
  auth_status: "authenticated",
  status: "active",
  created_at: "",
  last_seen_at: null,
};

const dsWithLanes: DataSourceWithLanes = {
  ...dsListItem,
  metadata: {},
  lane_ids: ["lane_work"],
};

const binding: Binding = {
  agent_id: "a1",
  data_source_id: "ds1",
  created_at: "",
};

const lane: Lane = { id: "lane_work", name: "work" };

describe("GET /api/map", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("401 when unauthenticated", async () => {
    mockAuth.mockResolvedValue(null);
    const res = await GET();
    expect(res.status).toBe(401);
    expect(mockHosts).not.toHaveBeenCalled();
  });

  it("200 returns aggregated payload with lane_ids resolved", async () => {
    mockAuth.mockResolvedValue({ user: { email: "t@x" } });
    mockHosts.mockResolvedValue([host]);
    mockAgents.mockResolvedValue({ data: [agent], next_cursor: null });
    mockDsList.mockResolvedValue({ data: [dsListItem], next_cursor: null });
    mockDsGet.mockResolvedValue(dsWithLanes);
    mockBindings.mockResolvedValue({ data: [binding], next_cursor: null });
    mockLanes.mockResolvedValue({ data: [lane] });

    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.hosts).toEqual([host]);
    expect(body.agents).toEqual([agent]);
    expect(body.data_sources).toEqual([dsWithLanes]);
    expect(body.bindings).toEqual([binding]);
    expect(body.lanes).toEqual([lane]);
    expect(mockDsGet).toHaveBeenCalledWith("ds1");
  });

  it("propagates upstream WorkerApiError status", async () => {
    mockAuth.mockResolvedValue({ user: { email: "t@x" } });
    mockHosts.mockRejectedValue(new WorkerApiError("upstream gone", 503));
    mockAgents.mockResolvedValue({ data: [], next_cursor: null });
    mockDsList.mockResolvedValue({ data: [], next_cursor: null });
    mockBindings.mockResolvedValue({ data: [], next_cursor: null });
    mockLanes.mockResolvedValue({ data: [] });

    const res = await GET();
    const body = await res.json();
    expect(res.status).toBe(503);
    expect(body.error).toBe("upstream gone");
  });

  it("returns 500 on unknown error", async () => {
    mockAuth.mockResolvedValue({ user: { email: "t@x" } });
    mockHosts.mockResolvedValue([host]);
    mockAgents.mockResolvedValue({ data: [], next_cursor: null });
    mockDsList.mockResolvedValue({ data: [dsListItem], next_cursor: null });
    mockDsGet.mockRejectedValue("string err");
    mockBindings.mockResolvedValue({ data: [], next_cursor: null });
    mockLanes.mockResolvedValue({ data: [] });

    const res = await GET();
    const body = await res.json();
    expect(res.status).toBe(500);
    expect(body.error).toBe("Unknown error");
  });
});
