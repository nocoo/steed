import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import type { Lane } from "@steed/shared";

// Mock auth module
vi.mock("@/auth", () => ({
  auth: vi.fn(),
}));

// Mock worker-api module
vi.mock("@/lib/worker-api", () => ({
  workerApi: {
    lanes: {
      list: vi.fn(),
    },
  },
}));

import { GET } from "../lanes/route";
import { auth } from "@/auth";
import { workerApi } from "@/lib/worker-api";

const mockAuth = auth as Mock;
const mockLanesList = workerApi.lanes.list as Mock;

const mockLanes: Lane[] = [
  { id: "lane_work", name: "work" },
  { id: "lane_life", name: "life" },
  { id: "lane_learning", name: "learning" },
];

describe("GET /api/lanes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return 401 when not authenticated", async () => {
    mockAuth.mockResolvedValue(null);

    const response = await GET();
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data).toEqual({ error: "Unauthorized" });
    expect(mockLanesList).not.toHaveBeenCalled();
  });

  it("should return lanes data when authenticated", async () => {
    mockAuth.mockResolvedValue({ user: { email: "test@example.com" } });
    mockLanesList.mockResolvedValue({ data: mockLanes });

    const response = await GET();
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual({ data: mockLanes });
    expect(mockLanesList).toHaveBeenCalledTimes(1);
  });

  it("should return 500 when worker API throws Error", async () => {
    mockAuth.mockResolvedValue({ user: { email: "test@example.com" } });
    mockLanesList.mockRejectedValue(new Error("Service unavailable"));

    const response = await GET();
    const data = await response.json();

    expect(response.status).toBe(500);
    expect(data).toEqual({ error: "Service unavailable" });
  });

  it("should return 500 with 'Unknown error' when worker API throws non-Error", async () => {
    mockAuth.mockResolvedValue({ user: { email: "test@example.com" } });
    mockLanesList.mockRejectedValue(42);

    const response = await GET();
    const data = await response.json();

    expect(response.status).toBe(500);
    expect(data).toEqual({ error: "Unknown error" });
  });
});
