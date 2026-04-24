import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import type { Agent, Binding, DataSourceListItem } from "@steed/shared";
import { createMockApiClient } from "../../../viewmodels/__tests__/test-utils";

const mockApiClient = createMockApiClient();

vi.mock("@/contexts/api-client", () => ({
  useApiClient: () => mockApiClient,
}));

vi.mock("react-router", async () => {
  const actual = await vi.importActual("react-router");
  return {
    ...actual,
    useParams: () => ({ id: "agent-123" }),
  };
});

vi.mock("@/components/ui/sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

import { AgentDetailPage } from "../$id";
import { toast } from "@/components/ui/sonner";

const mockAgent: Agent = {
  id: "agent-123",
  host_id: "host-1",
  match_key: "test-agent",
  nickname: "Test Agent",
  role: "Main assistant",
  lane_id: "lane_work",
  runtime_app: "node",
  runtime_version: "20.0.0",
  status: "running",
  created_at: "2024-01-01T00:00:00Z",
  last_seen_at: "2024-01-02T10:30:00Z",
  metadata: {},
};

const mockBindings: Binding[] = [
  {
    agent_id: "agent-123",
    data_source_id: "ds-1",
    created_at: "2024-01-01T00:00:00Z",
  },
];

const mockDataSources: DataSourceListItem[] = [
  {
    id: "ds-1",
    host_id: "host-1",
    type: "personal_cli",
    name: "Claude",
    version: "1.0",
    auth_status: "authenticated",
    status: "active",
    metadata: {},
    created_at: "2024-01-01T00:00:00Z",
    last_seen_at: null,
    lane_ids: [],
  },
  {
    id: "ds-2",
    host_id: "host-1",
    type: "mcp_server",
    name: "Slack MCP",
    version: null,
    auth_status: null,
    status: "active",
    metadata: {},
    created_at: "2024-01-01T00:00:00Z",
    last_seen_at: null,
    lane_ids: [],
  },
];

describe("AgentDetailPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(mockApiClient.agents.get).mockResolvedValue(mockAgent);
    vi.mocked(mockApiClient.agents.update).mockResolvedValue(mockAgent);
    vi.mocked(mockApiClient.bindings.list).mockResolvedValue({ data: mockBindings, next_cursor: null });
    vi.mocked(mockApiClient.bindings.create).mockResolvedValue(mockBindings[0]!);
    vi.mocked(mockApiClient.bindings.delete).mockResolvedValue(undefined);
    vi.mocked(mockApiClient.dataSources.list).mockResolvedValue({
      data: mockDataSources,
      next_cursor: null,
    });
  });

  it("renders loading state", () => {
    vi.mocked(mockApiClient.agents.get).mockImplementation(
      () => new Promise(() => {})
    );

    render(
      <MemoryRouter>
        <AgentDetailPage />
      </MemoryRouter>
    );

    expect(screen.getByText("Back to agents")).toBeInTheDocument();
  });

  it("renders agent details", async () => {
    render(
      <MemoryRouter>
        <AgentDetailPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("Test Agent")).toBeInTheDocument();
    });

    expect(screen.getByText("test-agent")).toBeInTheDocument();
    expect(screen.getByText("running")).toBeInTheDocument();
    expect(screen.getByText("node v20.0.0")).toBeInTheDocument();
    expect(screen.getByText("host-1")).toBeInTheDocument();
  });

  it("renders edit form with pre-filled values", async () => {
    render(
      <MemoryRouter>
        <AgentDetailPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByLabelText("Nickname")).toHaveValue("Test Agent");
    });

    expect(screen.getByLabelText("Role")).toHaveValue("Main assistant");
  });

  it("renders error state", async () => {
    vi.mocked(mockApiClient.agents.get).mockRejectedValueOnce(
      new Error("Agent not found")
    );

    render(
      <MemoryRouter>
        <AgentDetailPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("Agent not found")).toBeInTheDocument();
    });
  });

  it("renders bindings list", async () => {
    render(
      <MemoryRouter>
        <AgentDetailPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("Data Sources")).toBeInTheDocument();
    });

    expect(screen.getByText("ds-1")).toBeInTheDocument();
  });

  it("opens add binding dialog", async () => {
    render(
      <MemoryRouter>
        <AgentDetailPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Add/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /Add/i }));

    await waitFor(() => {
      expect(screen.getByText("Add data source")).toBeInTheDocument();
    });

    expect(screen.getByText("Slack MCP")).toBeInTheDocument();
  });

  it("submits form successfully", async () => {
    render(
      <MemoryRouter>
        <AgentDetailPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByLabelText("Nickname")).toBeInTheDocument();
    });

    fireEvent.change(screen.getByLabelText("Nickname"), {
      target: { value: "New Nickname" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(mockApiClient.agents.update).toHaveBeenCalled();
    });

    expect(toast.success).toHaveBeenCalledWith("Agent saved");
  });

  it("shows error on form submission failure", async () => {
    vi.mocked(mockApiClient.agents.update).mockRejectedValueOnce(
      new Error("Update failed")
    );

    render(
      <MemoryRouter>
        <AgentDetailPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByLabelText("Nickname")).toBeInTheDocument();
    });

    fireEvent.change(screen.getByLabelText("Nickname"), {
      target: { value: "New Nickname" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalled();
    });
  });

  it("removes binding successfully", async () => {
    render(
      <MemoryRouter>
        <AgentDetailPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("ds-1")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /Remove/i }));

    await waitFor(() => {
      expect(mockApiClient.bindings.delete).toHaveBeenCalledWith(
        "agent-123",
        "ds-1"
      );
    });

    expect(toast.success).toHaveBeenCalledWith("Binding removed");
  });

  it("adds binding successfully", async () => {
    render(
      <MemoryRouter>
        <AgentDetailPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Add/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /Add/i }));

    await waitFor(() => {
      expect(screen.getByText("Slack MCP")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Slack MCP"));
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));

    await waitFor(() => {
      expect(mockApiClient.bindings.create).toHaveBeenCalledWith({
        agent_id: "agent-123",
        data_source_id: "ds-2",
      });
    });

    expect(toast.success).toHaveBeenCalledWith("Binding added");
  });

  it("shows empty state when no more data sources available", async () => {
    vi.mocked(mockApiClient.dataSources.list).mockResolvedValueOnce({
      data: [mockDataSources[0]!],
      next_cursor: null,
    });

    render(
      <MemoryRouter>
        <AgentDetailPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Add/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /Add/i }));

    await waitFor(() => {
      expect(screen.getByText("No more data sources available.")).toBeInTheDocument();
    });
  });

  it("closes dialog on cancel", async () => {
    render(
      <MemoryRouter>
        <AgentDetailPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Add/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /Add/i }));

    await waitFor(() => {
      expect(screen.getByText("Add data source")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    await waitFor(() => {
      expect(screen.queryByText("Add data source")).not.toBeInTheDocument();
    });
  });

  it("renders agent with no runtime info", async () => {
    vi.mocked(mockApiClient.agents.get).mockResolvedValueOnce({
      ...mockAgent,
      runtime_app: null,
      runtime_version: null,
    });

    render(
      <MemoryRouter>
        <AgentDetailPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("Unknown")).toBeInTheDocument();
    });
  });

  it("renders agent with no last_seen_at", async () => {
    vi.mocked(mockApiClient.agents.get).mockResolvedValueOnce({
      ...mockAgent,
      last_seen_at: null,
    });

    render(
      <MemoryRouter>
        <AgentDetailPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("Never")).toBeInTheDocument();
    });
  });

  it("shows empty bindings state", async () => {
    vi.mocked(mockApiClient.bindings.list).mockResolvedValueOnce({
      data: [],
      next_cursor: null,
    });

    render(
      <MemoryRouter>
        <AgentDetailPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("No data sources bound yet.")).toBeInTheDocument();
    });
  });
});
