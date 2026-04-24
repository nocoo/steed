import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import type { AgentListItem } from "@steed/shared";
import { createMockApiClient } from "../../../viewmodels/__tests__/test-utils";

const mockApiClient = createMockApiClient();

vi.mock("@/contexts/api-client", () => ({
  useApiClient: () => mockApiClient,
}));

import { AgentsPage } from "../index";

const mockAgents: AgentListItem[] = [
  {
    id: "a1",
    host_id: "h1",
    match_key: "agent-001",
    nickname: "My Agent",
    role: null,
    lane_id: "lane_work",
    runtime_app: "node",
    runtime_version: "20.0.0",
    status: "running",
    created_at: "2024-01-01T00:00:00Z",
    last_seen_at: "2024-01-02T10:30:00Z",
  },
  {
    id: "a2",
    host_id: "h1",
    match_key: "agent-002",
    nickname: null,
    role: null,
    lane_id: null,
    runtime_app: null,
    runtime_version: null,
    status: "stopped",
    created_at: "2024-01-01T00:00:00Z",
    last_seen_at: null,
  },
];

describe("AgentsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders loading skeletons initially", () => {
    vi.mocked(mockApiClient.agents.list).mockImplementation(
      () => new Promise(() => {})
    );

    render(
      <MemoryRouter>
        <AgentsPage />
      </MemoryRouter>
    );

    expect(screen.getByRole("heading", { name: "Agents" })).toBeInTheDocument();
    expect(screen.getByText("Loading agents...")).toBeInTheDocument();
  });

  it("renders agents list with data", async () => {
    vi.mocked(mockApiClient.agents.list).mockResolvedValueOnce({
      data: mockAgents,
      next_cursor: null,
    });

    render(
      <MemoryRouter>
        <AgentsPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("My Agent")).toBeInTheDocument();
    });

    expect(screen.getByText("2 agents registered")).toBeInTheDocument();
    expect(screen.getByText("agent-002")).toBeInTheDocument();
    expect(screen.getByText("running")).toBeInTheDocument();
    expect(screen.getByText("stopped")).toBeInTheDocument();
    expect(screen.getByText("Work")).toBeInTheDocument();
    expect(screen.getByText(/node v20\.0\.0/)).toBeInTheDocument();
    expect(screen.getByText(/Unknown runtime/)).toBeInTheDocument();
  });

  it("renders empty state when no agents", async () => {
    vi.mocked(mockApiClient.agents.list).mockResolvedValueOnce({
      data: [],
      next_cursor: null,
    });

    render(
      <MemoryRouter>
        <AgentsPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(
        screen.getByText(/No agents discovered yet/)
      ).toBeInTheDocument();
    });
  });

  it("renders error state", async () => {
    vi.mocked(mockApiClient.agents.list).mockRejectedValueOnce(
      new Error("Failed to fetch")
    );

    render(
      <MemoryRouter>
        <AgentsPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("Failed to fetch")).toBeInTheDocument();
    });
  });

  it("shows load more button when hasMore", async () => {
    vi.mocked(mockApiClient.agents.list).mockResolvedValueOnce({
      data: mockAgents,
      next_cursor: "cursor123",
    });

    render(
      <MemoryRouter>
        <AgentsPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Load More" })).toBeInTheDocument();
    });
  });

  it("calls loadMore when button clicked", async () => {
    vi.mocked(mockApiClient.agents.list)
      .mockResolvedValueOnce({
        data: mockAgents,
        next_cursor: "cursor123",
      })
      .mockResolvedValueOnce({
        data: [
          {
            id: "a3",
            host_id: "h1",
            match_key: "agent-003",
            nickname: "Third Agent",
            role: null,
            lane_id: null,
            runtime_app: "python",
            runtime_version: "3.11",
            status: "running",
            created_at: "2024-01-01T00:00:00Z",
            last_seen_at: null,
          },
        ],
        next_cursor: null,
      });

    render(
      <MemoryRouter>
        <AgentsPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Load More" })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Load More" }));

    await waitFor(() => {
      expect(screen.getByText("Third Agent")).toBeInTheDocument();
    });

    expect(mockApiClient.agents.list).toHaveBeenCalledTimes(2);
    expect(mockApiClient.agents.list).toHaveBeenLastCalledWith({
      cursor: "cursor123",
      limit: 50,
    });
  });
});
