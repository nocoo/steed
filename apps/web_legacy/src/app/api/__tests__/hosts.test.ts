import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import type { HostWithStatus } from "@steed/shared";

// Mock auth module
vi.mock("@/auth", () => ({
  auth: vi.fn(),
}));

// Mock worker-api module
vi.mock("@/lib/worker-api", () => ({
  workerApi: {
    hosts: {
      list: vi.fn(),
    },
  },
}));

import { GET } from "../hosts/route";
import { auth } from "@/auth";
import { workerApi } from "@/lib/worker-api";

const mockAuth = auth as Mock;
const mockHostsList = workerApi.hosts.list as Mock;

const mockHosts: HostWithStatus[] = [
  {
    id: "host_1",
    name: "workstation-a",
    api_key_hash: "hash1",
    created_at: "2024-01-01T00:00:00Z",
    last_seen_at: "2024-01-02T12:00:00Z",
    status: "online",
  },
];

describe("GET /api/hosts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return 401 when not authenticated", async () => {
    mockAuth.mockResolvedValue(null);

    const response = await GET();
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data).toEqual({ error: "Unauthorized" });
    expect(mockHostsList).not.toHaveBeenCalled();
  });

  it("should return hosts data when authenticated", async () => {
    mockAuth.mockResolvedValue({ user: { email: "test@example.com" } });
    mockHostsList.mockResolvedValue(mockHosts);

    const response = await GET();
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual(mockHosts);
    expect(mockHostsList).toHaveBeenCalledTimes(1);
  });

  it("should return 500 when worker API throws Error", async () => {
    mockAuth.mockResolvedValue({ user: { email: "test@example.com" } });
    mockHostsList.mockRejectedValue(new Error("Connection failed"));

    const response = await GET();
    const data = await response.json();

    expect(response.status).toBe(500);
    expect(data).toEqual({ error: "Connection failed" });
  });

  it("should return 500 with 'Unknown error' when worker API throws non-Error", async () => {
    mockAuth.mockResolvedValue({ user: { email: "test@example.com" } });
    mockHostsList.mockRejectedValue({ code: "ERR" });

    const response = await GET();
    const data = await response.json();

    expect(response.status).toBe(500);
    expect(data).toEqual({ error: "Unknown error" });
  });
});
