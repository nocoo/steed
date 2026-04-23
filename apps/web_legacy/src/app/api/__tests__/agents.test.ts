import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import { NextRequest } from "next/server";
import type { AgentListItem } from "@steed/shared";

// Mock auth module
vi.mock("@/auth", () => ({
  auth: vi.fn(),
}));

// Mock worker-api module
vi.mock("@/lib/worker-api", () => ({
  workerApi: {
    agents: {
      list: vi.fn(),
    },
  },
}));

import { GET } from "../agents/route";
import { auth } from "@/auth";
import { workerApi } from "@/lib/worker-api";

const mockAuth = auth as Mock;
const mockAgentsList = workerApi.agents.list as Mock;

const mockAgents: AgentListItem[] = [
  {
    id: "agent_1",
    host_id: "host_1",
    match_key: "agent-a",
    nickname: "Alpha",
    role: "assistant",
    lane_id: "lane_work",
    runtime_app: "node",
    runtime_version: "20.0.0",
    status: "running",
    created_at: "2024-01-01T00:00:00Z",
    last_seen_at: "2024-01-02T12:00:00Z",
  },
];

function createRequest(searchParams: Record<string, string> = {}): NextRequest {
  const url = new URL("http://localhost:3000/api/agents");
  Object.entries(searchParams).forEach(([key, value]) => {
    url.searchParams.set(key, value);
  });
  return new NextRequest(url);
}

describe("GET /api/agents", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return 401 when not authenticated", async () => {
    mockAuth.mockResolvedValue(null);

    const request = createRequest();
    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data).toEqual({ error: "Unauthorized" });
    expect(mockAgentsList).not.toHaveBeenCalled();
  });

  it("should return agents data when authenticated", async () => {
    mockAuth.mockResolvedValue({ user: { email: "test@example.com" } });
    mockAgentsList.mockResolvedValue({ data: mockAgents, next_cursor: null });

    const request = createRequest();
    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual({ data: mockAgents, next_cursor: null });
    expect(mockAgentsList).toHaveBeenCalledWith({});
  });

  it("should pass all query params to workerApi", async () => {
    mockAuth.mockResolvedValue({ user: { email: "test@example.com" } });
    mockAgentsList.mockResolvedValue({ data: mockAgents, next_cursor: "cursor123" });

    const request = createRequest({
      host_id: "host_1",
      lane_id: "lane_work",
      status: "running",
      limit: "25",
      cursor: "prev_cursor",
    });
    const response = await GET(request);

    expect(response.status).toBe(200);
    expect(mockAgentsList).toHaveBeenCalledWith({
      host_id: "host_1",
      lane_id: "lane_work",
      status: "running",
      limit: 25,
      cursor: "prev_cursor",
    });
  });

  it("should handle partial query params", async () => {
    mockAuth.mockResolvedValue({ user: { email: "test@example.com" } });
    mockAgentsList.mockResolvedValue({ data: [], next_cursor: null });

    const request = createRequest({ host_id: "host_2" });
    await GET(request);

    expect(mockAgentsList).toHaveBeenCalledWith({
      host_id: "host_2",
    });
  });

  it("should return 500 when worker API throws Error", async () => {
    mockAuth.mockResolvedValue({ user: { email: "test@example.com" } });
    mockAgentsList.mockRejectedValue(new Error("Database error"));

    const request = createRequest();
    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(500);
    expect(data).toEqual({ error: "Database error" });
  });

  it("should return 500 with 'Unknown error' when worker API throws non-Error", async () => {
    mockAuth.mockResolvedValue({ user: { email: "test@example.com" } });
    mockAgentsList.mockRejectedValue(undefined);

    const request = createRequest();
    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(500);
    expect(data).toEqual({ error: "Unknown error" });
  });
});
