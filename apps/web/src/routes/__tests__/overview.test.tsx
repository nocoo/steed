import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import type { Overview } from "@steed/shared";
import { createMockApiClient } from "@/viewmodels/__tests__/test-utils";

const mockApiClient = createMockApiClient();

vi.mock("@/contexts/api-client", () => ({
  useApiClient: () => mockApiClient,
}));

import { OverviewPage } from "../overview";

const mockOverview: Overview = {
  hosts: { total: 5, online: 3, offline: 2 },
  agents: {
    total: 12,
    running: 8,
    by_lane: { work: 4, life: 3, learning: 2, unassigned: 3 },
  },
  data_sources: { total: 10, active: 7 },
};

describe("OverviewPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders loading skeletons initially", () => {
    vi.mocked(mockApiClient.overview.get).mockImplementation(
      () => new Promise(() => {})
    );

    render(<OverviewPage />);

    expect(
      screen.getByRole("heading", { name: "Overview" })
    ).toBeInTheDocument();
    expect(screen.getByText("AI asset visibility at a glance")).toBeInTheDocument();
  });

  it("renders stat cards with data", async () => {
    vi.mocked(mockApiClient.overview.get).mockResolvedValueOnce(mockOverview);

    render(<OverviewPage />);

    await waitFor(() => {
      expect(screen.getByText("5")).toBeInTheDocument();
    });

    expect(screen.getByText("Hosts")).toBeInTheDocument();
    expect(screen.getByText("Connected machines")).toBeInTheDocument();
    expect(screen.getByText("12")).toBeInTheDocument();
    expect(screen.getByText("8 running")).toBeInTheDocument();
    expect(screen.getByText("10")).toBeInTheDocument();
    expect(screen.getByText("7 active")).toBeInTheDocument();
    expect(screen.getByText("Online")).toBeInTheDocument();
    expect(screen.getByText("2 offline")).toBeInTheDocument();
  });

  it("renders agents by lane section", async () => {
    vi.mocked(mockApiClient.overview.get).mockResolvedValueOnce(mockOverview);

    render(<OverviewPage />);

    await waitFor(() => {
      expect(screen.getByText("Agents by Lane")).toBeInTheDocument();
    });

    expect(screen.getByText("Work")).toBeInTheDocument();
    expect(screen.getByText("Life")).toBeInTheDocument();
    expect(screen.getByText("Learning")).toBeInTheDocument();
    expect(screen.getByText("Unassigned")).toBeInTheDocument();
  });

  it("renders error state", async () => {
    vi.mocked(mockApiClient.overview.get).mockRejectedValueOnce(
      new Error("Network failure")
    );

    render(<OverviewPage />);

    await waitFor(() => {
      expect(screen.getByText("Network failure")).toBeInTheDocument();
    });
  });
});
