import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import type { Overview } from "@steed/shared";

// Mock auth module
vi.mock("@/auth", () => ({
  auth: vi.fn(),
}));

// Mock worker-api module
vi.mock("@/lib/worker-api", () => ({
  workerApi: {
    overview: {
      get: vi.fn(),
    },
  },
}));

import { GET } from "../overview/route";
import { auth } from "@/auth";
import { workerApi } from "@/lib/worker-api";

const mockAuth = auth as Mock;
const mockOverviewGet = workerApi.overview.get as Mock;

const mockOverview: Overview = {
  hosts: { total: 3, online: 2, offline: 1 },
  agents: {
    total: 10,
    running: 5,
    stopped: 3,
    missing: 2,
    by_lane: { work: 4, life: 2, learning: 1, unassigned: 3 },
  },
  data_sources: { total: 15, active: 12, missing: 3 },
};

describe("GET /api/overview", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return 401 when not authenticated", async () => {
    mockAuth.mockResolvedValue(null);

    const response = await GET();
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data).toEqual({ error: "Unauthorized" });
    expect(mockOverviewGet).not.toHaveBeenCalled();
  });

  it("should return overview data when authenticated", async () => {
    mockAuth.mockResolvedValue({ user: { email: "test@example.com" } });
    mockOverviewGet.mockResolvedValue(mockOverview);

    const response = await GET();
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual(mockOverview);
    expect(mockOverviewGet).toHaveBeenCalledTimes(1);
  });

  it("should return 500 when worker API throws Error", async () => {
    mockAuth.mockResolvedValue({ user: { email: "test@example.com" } });
    mockOverviewGet.mockRejectedValue(new Error("Worker unavailable"));

    const response = await GET();
    const data = await response.json();

    expect(response.status).toBe(500);
    expect(data).toEqual({ error: "Worker unavailable" });
  });

  it("should return 500 with 'Unknown error' when worker API throws non-Error", async () => {
    mockAuth.mockResolvedValue({ user: { email: "test@example.com" } });
    mockOverviewGet.mockRejectedValue("string error");

    const response = await GET();
    const data = await response.json();

    expect(response.status).toBe(500);
    expect(data).toEqual({ error: "Unknown error" });
  });
});
