import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import type { HostWithStatus } from "@steed/shared";
import { createMockApiClient } from "@/viewmodels/__tests__/test-utils";

const mockApiClient = createMockApiClient();

vi.mock("@/contexts/api-client", () => ({
  useApiClient: () => mockApiClient,
}));

import { HostsPage } from "../hosts";

const mockHosts: HostWithStatus[] = [
  {
    id: "h1",
    name: "macbook-pro",
    api_key_hash: "abc",
    created_at: "2024-01-01T00:00:00Z",
    last_seen_at: "2024-01-02T10:30:00Z",
    status: "online",
  },
  {
    id: "h2",
    name: "linux-server",
    api_key_hash: "def",
    created_at: "2024-01-01T00:00:00Z",
    last_seen_at: null,
    status: "offline",
  },
];

describe("HostsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders loading skeletons initially", () => {
    vi.mocked(mockApiClient.hosts.list).mockImplementation(
      () => new Promise(() => {})
    );

    render(<HostsPage />);

    expect(screen.getByRole("heading", { name: "Hosts" })).toBeInTheDocument();
    expect(screen.getByText("Loading hosts...")).toBeInTheDocument();
  });

  it("renders hosts list with data", async () => {
    vi.mocked(mockApiClient.hosts.list).mockResolvedValueOnce(mockHosts);

    render(<HostsPage />);

    await waitFor(() => {
      expect(screen.getByText("macbook-pro")).toBeInTheDocument();
    });

    expect(screen.getByText("2 hosts registered")).toBeInTheDocument();
    expect(screen.getByText("linux-server")).toBeInTheDocument();
    expect(screen.getByText("online")).toBeInTheDocument();
    expect(screen.getByText("offline")).toBeInTheDocument();
    expect(screen.getByText(/Last seen: Never/)).toBeInTheDocument();
  });

  it("renders empty state when no hosts", async () => {
    vi.mocked(mockApiClient.hosts.list).mockResolvedValueOnce([]);

    render(<HostsPage />);

    await waitFor(() => {
      expect(
        screen.getByText(/No hosts registered yet/)
      ).toBeInTheDocument();
    });
  });

  it("renders error state", async () => {
    vi.mocked(mockApiClient.hosts.list).mockRejectedValueOnce(
      new Error("Connection failed")
    );

    render(<HostsPage />);

    await waitFor(() => {
      expect(screen.getByText("Connection failed")).toBeInTheDocument();
    });
  });
});
