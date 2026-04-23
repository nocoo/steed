import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import { NextRequest } from "next/server";
import type { DataSourceListItem } from "@steed/shared";

// Mock auth module
vi.mock("@/auth", () => ({
  auth: vi.fn(),
}));

// Mock worker-api module
vi.mock("@/lib/worker-api", () => ({
  workerApi: {
    dataSources: {
      list: vi.fn(),
    },
  },
}));

import { GET } from "../data-sources/route";
import { auth } from "@/auth";
import { workerApi } from "@/lib/worker-api";

const mockAuth = auth as Mock;
const mockDataSourcesList = workerApi.dataSources.list as Mock;

const mockDataSources: DataSourceListItem[] = [
  {
    id: "ds_1",
    host_id: "host_1",
    type: "personal_cli",
    name: "gh",
    version: "2.40.0",
    auth_status: "authenticated",
    status: "active",
    created_at: "2024-01-01T00:00:00Z",
    last_seen_at: "2024-01-02T12:00:00Z",
  },
];

function createRequest(searchParams: Record<string, string> = {}): NextRequest {
  const url = new URL("http://localhost:3000/api/data-sources");
  Object.entries(searchParams).forEach(([key, value]) => {
    url.searchParams.set(key, value);
  });
  return new NextRequest(url);
}

describe("GET /api/data-sources", () => {
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
    expect(mockDataSourcesList).not.toHaveBeenCalled();
  });

  it("should return data sources when authenticated", async () => {
    mockAuth.mockResolvedValue({ user: { email: "test@example.com" } });
    mockDataSourcesList.mockResolvedValue({ data: mockDataSources, next_cursor: null });

    const request = createRequest();
    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual({ data: mockDataSources, next_cursor: null });
    expect(mockDataSourcesList).toHaveBeenCalledWith({});
  });

  it("should pass all query params to workerApi", async () => {
    mockAuth.mockResolvedValue({ user: { email: "test@example.com" } });
    mockDataSourcesList.mockResolvedValue({ data: mockDataSources, next_cursor: "cursor456" });

    const request = createRequest({
      host_id: "host_1",
      lane_id: "lane_life",
      status: "active",
      limit: "100",
      cursor: "prev_cursor",
    });
    const response = await GET(request);

    expect(response.status).toBe(200);
    expect(mockDataSourcesList).toHaveBeenCalledWith({
      host_id: "host_1",
      lane_id: "lane_life",
      status: "active",
      limit: 100,
      cursor: "prev_cursor",
    });
  });

  it("should handle partial query params", async () => {
    mockAuth.mockResolvedValue({ user: { email: "test@example.com" } });
    mockDataSourcesList.mockResolvedValue({ data: [], next_cursor: null });

    const request = createRequest({ status: "missing" });
    await GET(request);

    expect(mockDataSourcesList).toHaveBeenCalledWith({
      status: "missing",
    });
  });

  it("should return 500 when worker API throws Error", async () => {
    mockAuth.mockResolvedValue({ user: { email: "test@example.com" } });
    mockDataSourcesList.mockRejectedValue(new Error("Timeout"));

    const request = createRequest();
    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(500);
    expect(data).toEqual({ error: "Timeout" });
  });

  it("should return 500 with 'Unknown error' when worker API throws non-Error", async () => {
    mockAuth.mockResolvedValue({ user: { email: "test@example.com" } });
    mockDataSourcesList.mockRejectedValue(null);

    const request = createRequest();
    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(500);
    expect(data).toEqual({ error: "Unknown error" });
  });
});
