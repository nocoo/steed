import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { createMockApiClient } from "@/viewmodels/__tests__/test-utils";
import { routes } from "./router";

const mockApiClient = createMockApiClient();

vi.mock("@/contexts/api-client", () => ({
  useApiClient: () => mockApiClient,
}));

function renderRoute(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(<RouterProvider router={router} />);
}

describe("router", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(mockApiClient.overview.get).mockResolvedValue({
      hosts: { total: 0, online: 0, offline: 0 },
      agents: { total: 0, running: 0, by_lane: { work: 0, life: 0, learning: 0, unassigned: 0 } },
      data_sources: { total: 0, active: 0 },
    });
    vi.mocked(mockApiClient.hosts.list).mockResolvedValue([]);
    vi.mocked(mockApiClient.agents.list).mockResolvedValue({ data: [], next_cursor: null });
    vi.mocked(mockApiClient.dataSources.list).mockResolvedValue({ data: [], next_cursor: null });
    vi.mocked(mockApiClient.map.get).mockResolvedValue({
      hosts: [],
      agents: [],
      data_sources: [],
      bindings: [],
      lanes: [],
      graph: { nodes: [], edges: [] },
    });
  });

  it("redirects / to /overview", async () => {
    renderRoute("/");
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Overview" })).toBeInTheDocument();
    });
  });

  it("renders overview page", async () => {
    renderRoute("/overview");
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Overview" })).toBeInTheDocument();
    });
    expect(screen.getByText("AI asset visibility at a glance")).toBeInTheDocument();
  });

  it("renders hosts page", async () => {
    renderRoute("/hosts");
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Hosts" })).toBeInTheDocument();
    });
    expect(screen.getByText("Connected machines running the host service")).toBeInTheDocument();
  });

  it("renders agents list page", async () => {
    renderRoute("/agents");
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Agents" })).toBeInTheDocument();
    });
    expect(screen.getByText("Autonomous agent entities across all hosts")).toBeInTheDocument();
  });

  it("renders agent detail page with id", () => {
    renderRoute("/agents/abc-123");
    expect(screen.getByRole("heading", { name: "Agent Details" })).toBeInTheDocument();
    expect(screen.getByText(/abc-123/)).toBeInTheDocument();
  });

  it("renders data sources list page", () => {
    renderRoute("/data-sources");
    expect(screen.getByRole("heading", { name: "Data Sources" })).toBeInTheDocument();
    expect(screen.getByText(/Data source list/)).toBeInTheDocument();
  });

  it("renders data source detail page with id", () => {
    renderRoute("/data-sources/ds-456");
    expect(screen.getByRole("heading", { name: "Data Source Details" })).toBeInTheDocument();
    expect(screen.getByText(/ds-456/)).toBeInTheDocument();
  });

  it("renders map page", () => {
    renderRoute("/map");
    expect(screen.getByRole("heading", { name: "Map" })).toBeInTheDocument();
    expect(screen.getByText(/Relationship map/)).toBeInTheDocument();
  });
});
