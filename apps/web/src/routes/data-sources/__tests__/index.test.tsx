import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import type { DataSourceListItem } from "@steed/shared";
import { createMockApiClient } from "../../../viewmodels/__tests__/test-utils";

const mockApiClient = createMockApiClient();

vi.mock("@/contexts/api-client", () => ({
  useApiClient: () => mockApiClient,
}));

import { DataSourcesPage } from "../index";

const mockDataSources: DataSourceListItem[] = [
  {
    id: "ds-1",
    host_id: "h1",
    type: "personal_cli",
    name: "Claude Code",
    version: "1.2.0",
    auth_status: "authenticated",
    status: "active",
    metadata: {},
    created_at: "2024-01-01T00:00:00Z",
    last_seen_at: "2024-01-02T10:30:00Z",
    lane_ids: [],
  },
  {
    id: "ds-2",
    host_id: "h1",
    type: "mcp",
    name: "Slack MCP",
    version: null,
    auth_status: "unknown",
    status: "missing",
    metadata: {},
    created_at: "2024-01-01T00:00:00Z",
    last_seen_at: null,
    lane_ids: [],
  },
];

describe("DataSourcesPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders loading skeletons initially", () => {
    vi.mocked(mockApiClient.dataSources.list).mockImplementation(
      () => new Promise(() => {})
    );

    render(
      <MemoryRouter>
        <DataSourcesPage />
      </MemoryRouter>
    );

    expect(screen.getByRole("heading", { name: "Data Sources" })).toBeInTheDocument();
    expect(screen.getByText("Loading data sources...")).toBeInTheDocument();
  });

  it("renders data sources list with data", async () => {
    vi.mocked(mockApiClient.dataSources.list).mockResolvedValueOnce({
      data: mockDataSources,
      next_cursor: null,
    });

    render(
      <MemoryRouter>
        <DataSourcesPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("Claude Code")).toBeInTheDocument();
    });

    expect(screen.getByText("2 data sources discovered")).toBeInTheDocument();
    expect(screen.getByText("Slack MCP")).toBeInTheDocument();
    expect(screen.getByText("Authed")).toBeInTheDocument();
    expect(screen.getByText("active")).toBeInTheDocument();
    expect(screen.getByText("missing")).toBeInTheDocument();
    expect(screen.getByText(/Personal CLI/)).toBeInTheDocument();
    expect(screen.getByText(/MCP Service/)).toBeInTheDocument();
  });

  it("renders empty state when no data sources", async () => {
    vi.mocked(mockApiClient.dataSources.list).mockResolvedValueOnce({
      data: [],
      next_cursor: null,
    });

    render(
      <MemoryRouter>
        <DataSourcesPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(
        screen.getByText(/No data sources discovered yet/)
      ).toBeInTheDocument();
    });
  });

  it("renders error state", async () => {
    vi.mocked(mockApiClient.dataSources.list).mockRejectedValueOnce(
      new Error("Failed to fetch")
    );

    render(
      <MemoryRouter>
        <DataSourcesPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("Failed to fetch")).toBeInTheDocument();
    });
  });

  it("shows load more button when hasMore", async () => {
    vi.mocked(mockApiClient.dataSources.list).mockResolvedValueOnce({
      data: mockDataSources,
      next_cursor: "cursor123",
    });

    render(
      <MemoryRouter>
        <DataSourcesPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Load More" })).toBeInTheDocument();
    });
  });

  it("calls loadMore when button clicked", async () => {
    vi.mocked(mockApiClient.dataSources.list)
      .mockResolvedValueOnce({
        data: mockDataSources,
        next_cursor: "cursor123",
      })
      .mockResolvedValueOnce({
        data: [
          {
            id: "ds-3",
            host_id: "h1",
            type: "third_party_cli",
            name: "AWS CLI",
            version: "2.0",
            auth_status: "unauthenticated",
            status: "active",
            metadata: {},
            created_at: "2024-01-01T00:00:00Z",
            last_seen_at: null,
            lane_ids: [],
          },
        ],
        next_cursor: null,
      });

    render(
      <MemoryRouter>
        <DataSourcesPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Load More" })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Load More" }));

    await waitFor(() => {
      expect(screen.getByText("AWS CLI")).toBeInTheDocument();
    });

    expect(mockApiClient.dataSources.list).toHaveBeenCalledTimes(2);
  });
});
