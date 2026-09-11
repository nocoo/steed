import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { createMockApiClient } from "@/viewmodels/__tests__/test-utils";
const mockApiClient = createMockApiClient();

vi.mock("@/contexts/api-client", () => ({
  useApiClient: () => mockApiClient,
}));

vi.mock("@/components/map/lane-map", () => ({
  LaneMap: ({
    onNodeClick,
  }: {
    onNodeClick?: (node: {
      id: string;
      kind: "host";
      data: Record<string, unknown>;
    }) => void;
  }) => (
    <button
      type="button"
      data-testid="lane-map"
      onClick={() =>
        onNodeClick?.({
          id: "h1",
          kind: "host",
          data: {
            kind: "host",
            label: "Host A",
            laneKeys: [],
            orphan: false,
            raw: {
              id: "h1",
              name: "Host A",
              os: "darwin",
              arch: "arm64",
              hostname: "host-a",
              status: "online",
              created_at: "2024-01-01T00:00:00Z",
              last_seen_at: null,
            },
          },
        })
      }
    >
      map
    </button>
  ),
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

    render(
      <MemoryRouter>
        <MapPage />
      </MemoryRouter>
    );

    expect(screen.getByRole("heading", { name: "Map" })).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByTestId("lane-map")).toBeInTheDocument();
    });

    expect(screen.getByText("Hosts")).toBeInTheDocument();
    expect(screen.getByText("Bindings")).toBeInTheDocument();
  });

  it("opens and closes the node drawer", async () => {
    vi.mocked(mockApiClient.map.get).mockResolvedValueOnce({
      hosts: [],
      agents: [],
      data_sources: [],
      bindings: [],
      lanes: [],
      graph: { nodes: [], edges: [] },
    });

    render(
      <MemoryRouter>
        <MapPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByTestId("lane-map")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("lane-map"));
    expect(screen.getByText("Host A")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Close drawer" }));
    expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
  });

  it("renders error state", async () => {
    vi.mocked(mockApiClient.map.get).mockRejectedValueOnce(
      new Error("Map fetch failed")
    );

    render(
      <MemoryRouter>
        <MapPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("Map fetch failed")).toBeInTheDocument();
    });
  });
});
