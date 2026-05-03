import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { createMockApiClient } from "@/viewmodels/__tests__/test-utils";

const mockApiClient = createMockApiClient();

vi.mock("@/contexts/api-client", () => ({
  useApiClient: () => mockApiClient,
}));

vi.mock("@/components/map/lane-map", () => ({
  LaneMap: () => <div data-testid="lane-map" />,
}));

import { MapPage } from "../map";

describe("MapPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders KPIs and lane map after loading", async () => {
    vi.mocked(mockApiClient.map.get).mockResolvedValueOnce({
      hosts: [
        {
          id: "h1",
          fingerprint: "f",
          hostname: "Host A",
          platform: "darwin",
          arch: "arm64",
          status: "online",
          last_seen_at: null,
          metadata: {},
        },
      ],
      agents: [],
      data_sources: [],
      bindings: [],
      lanes: [],
      graph: { nodes: [], edges: [] },
    });

    render(<MapPage />);

    expect(screen.getByRole("heading", { name: "Map" })).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByTestId("lane-map")).toBeInTheDocument();
    });

    expect(screen.getByText("Hosts")).toBeInTheDocument();
    expect(screen.getByText("Bindings")).toBeInTheDocument();
  });

  it("renders error state", async () => {
    vi.mocked(mockApiClient.map.get).mockRejectedValueOnce(
      new Error("Map fetch failed")
    );

    render(<MapPage />);

    await waitFor(() => {
      expect(screen.getByText("Map fetch failed")).toBeInTheDocument();
    });
  });
});
