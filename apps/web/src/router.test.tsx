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

  it("renders agent detail page with id", async () => {
    vi.mocked(mockApiClient.agents.get).mockResolvedValueOnce({
      id: "abc-123",
      host_id: "h1",
      match_key: "test-agent",
      nickname: "Test Agent Nickname",
      role: null,
      lane_id: null,
      runtime_app: null,
      runtime_version: null,
      status: "running",
      created_at: "2024-01-01T00:00:00Z",
      last_seen_at: null,
      metadata: {},
    });
    vi.mocked(mockApiClient.bindings.list).mockResolvedValueOnce({ data: [], next_cursor: null });

    renderRoute("/agents/abc-123");
    await waitFor(() => {
      expect(screen.getByText("Test Agent Nickname")).toBeInTheDocument();
    });
    expect(screen.getByText("Back to agents")).toBeInTheDocument();
  });

  it("renders data sources list page", async () => {
    renderRoute("/data-sources");
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Data Sources" })).toBeInTheDocument();
    });
    expect(screen.getByText(/CLIs, MCP services, platforms/)).toBeInTheDocument();
  });

  it("renders data source detail page with id", async () => {
    vi.mocked(mockApiClient.dataSources.get).mockResolvedValueOnce({
      id: "ds-456",
      host_id: "h1",
      type: "personal_cli",
      name: "Test Data Source",
      version: "1.0.0",
      auth_status: "authenticated",
      status: "active",
      metadata: {},
      created_at: "2024-01-01T00:00:00Z",
      last_seen_at: null,
      lane_ids: [],
    });

    renderRoute("/data-sources/ds-456");
    await waitFor(() => {
      expect(screen.getByText("Test Data Source")).toBeInTheDocument();
    });
    expect(screen.getByText("Back to data sources")).toBeInTheDocument();
  });

  it("renders map page", () => {
    renderRoute("/map");
    expect(screen.getByRole("heading", { name: "Map" })).toBeInTheDocument();
    expect(screen.getByText(/Relationship map/)).toBeInTheDocument();
  });
});
