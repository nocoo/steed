import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import type { DataSourceWithLanes } from "@steed/shared";
import { createMockApiClient } from "../../../viewmodels/__tests__/test-utils";

const mockApiClient = createMockApiClient();

vi.mock("@/contexts/api-client", () => ({
  useApiClient: () => mockApiClient,
}));

vi.mock("react-router", async () => {
  const actual = await vi.importActual("react-router");
  return {
    ...actual,
    useParams: () => ({ id: "ds-123" }),
  };
});

vi.mock("@/components/ui/sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

import { DataSourceDetailPage } from "../$id";
import { toast } from "@/components/ui/sonner";

const mockDataSource: DataSourceWithLanes = {
  id: "ds-123",
  host_id: "host-1",
  type: "personal_cli",
  name: "Claude Code",
  version: "1.2.0",
  auth_status: "authenticated",
  status: "active",
  metadata: { notes: "Test notes", tags: ["primary", "internal"] },
  created_at: "2024-01-01T00:00:00Z",
  last_seen_at: "2024-01-02T10:30:00Z",
  lane_ids: ["lane_work"],
};

describe("DataSourceDetailPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(mockApiClient.dataSources.get).mockResolvedValue(mockDataSource);
    vi.mocked(mockApiClient.dataSources.update).mockResolvedValue(mockDataSource);
    vi.mocked(mockApiClient.dataSources.setLanes).mockResolvedValue({
      lane_ids: ["lane_work", "lane_life"],
    });
  });

  it("renders loading state", () => {
    vi.mocked(mockApiClient.dataSources.get).mockImplementation(
      () => new Promise(() => {})
    );

    render(
      <MemoryRouter>
        <DataSourceDetailPage />
      </MemoryRouter>
    );

    expect(screen.getByText("Back to data sources")).toBeInTheDocument();
  });

  it("renders data source details", async () => {
    render(
      <MemoryRouter>
        <DataSourceDetailPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("Claude Code")).toBeInTheDocument();
    });

    expect(screen.getByText("Personal CLI")).toBeInTheDocument();
    expect(screen.getByText("Authed")).toBeInTheDocument();
    expect(screen.getByText("active")).toBeInTheDocument();
    expect(screen.getByText("host-1")).toBeInTheDocument();
    expect(screen.getByText("1.2.0")).toBeInTheDocument();
  });

  it("renders form with pre-filled values", async () => {
    render(
      <MemoryRouter>
        <DataSourceDetailPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByLabelText("Notes")).toHaveValue("Test notes");
    });

    expect(screen.getByLabelText("Tags")).toHaveValue("primary, internal");
  });

  it("renders error state", async () => {
    vi.mocked(mockApiClient.dataSources.get).mockRejectedValueOnce(
      new Error("Data source not found")
    );

    render(
      <MemoryRouter>
        <DataSourceDetailPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("Data source not found")).toBeInTheDocument();
    });
  });

  it("calls update API on metadata form submission", async () => {
    vi.mocked(mockApiClient.dataSources.get).mockResolvedValueOnce({
      ...mockDataSource,
      metadata: {},
    });

    render(
      <MemoryRouter>
        <DataSourceDetailPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByLabelText("Notes")).toBeInTheDocument();
    });

    const notesInput = screen.getByLabelText("Notes");
    fireEvent.change(notesInput, { target: { value: "New notes" } });
    fireEvent.blur(notesInput);

    const form = screen.getByLabelText("Notes").closest("form");
    fireEvent.submit(form!);

    await waitFor(() => {
      expect(mockApiClient.dataSources.update).toHaveBeenCalled();
    });

    expect(toast.success).toHaveBeenCalledWith("Metadata saved");
  });

  it("shows error on metadata save failure", async () => {
    vi.mocked(mockApiClient.dataSources.get).mockResolvedValueOnce({
      ...mockDataSource,
      metadata: {},
    });
    vi.mocked(mockApiClient.dataSources.update).mockRejectedValueOnce(
      new Error("Update failed")
    );

    render(
      <MemoryRouter>
        <DataSourceDetailPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByLabelText("Notes")).toBeInTheDocument();
    });

    const notesInput = screen.getByLabelText("Notes");
    fireEvent.change(notesInput, { target: { value: "New notes" } });

    const form = screen.getByLabelText("Notes").closest("form");
    fireEvent.submit(form!);

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalled();
    });
  });

  it("saves lanes successfully", async () => {
    render(
      <MemoryRouter>
        <DataSourceDetailPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("Claude Code")).toBeInTheDocument();
    });

    const lifeCheckbox = screen.getByRole("checkbox", { name: /Life/i });
    fireEvent.click(lifeCheckbox);

    const saveButton = screen.getByRole("button", { name: "Save lanes" });
    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(mockApiClient.dataSources.setLanes).toHaveBeenCalled();
    });

    expect(toast.success).toHaveBeenCalledWith("Lanes saved");
  });

  it("shows error on lanes save failure", async () => {
    vi.mocked(mockApiClient.dataSources.setLanes).mockRejectedValueOnce(
      new Error("Save failed")
    );

    render(
      <MemoryRouter>
        <DataSourceDetailPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("Claude Code")).toBeInTheDocument();
    });

    const lifeCheckbox = screen.getByRole("checkbox", { name: /Life/i });
    fireEvent.click(lifeCheckbox);

    const saveButton = screen.getByRole("button", { name: "Save lanes" });
    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalled();
    });
  });

  it("renders data source with no version", async () => {
    vi.mocked(mockApiClient.dataSources.get).mockResolvedValueOnce({
      ...mockDataSource,
      version: null,
    });

    render(
      <MemoryRouter>
        <DataSourceDetailPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("—")).toBeInTheDocument();
    });
  });

  it("renders data source with no last_seen_at", async () => {
    vi.mocked(mockApiClient.dataSources.get).mockResolvedValueOnce({
      ...mockDataSource,
      last_seen_at: null,
    });

    render(
      <MemoryRouter>
        <DataSourceDetailPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("Never")).toBeInTheDocument();
    });
  });

  it("renders MCP type icon", async () => {
    vi.mocked(mockApiClient.dataSources.get).mockResolvedValueOnce({
      ...mockDataSource,
      type: "mcp",
    });

    render(
      <MemoryRouter>
        <DataSourceDetailPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("MCP Service")).toBeInTheDocument();
    });
  });

  it("renders third_party_cli type icon", async () => {
    vi.mocked(mockApiClient.dataSources.get).mockResolvedValueOnce({
      ...mockDataSource,
      type: "third_party_cli",
    });

    render(
      <MemoryRouter>
        <DataSourceDetailPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("Third-party CLI")).toBeInTheDocument();
    });
  });

  it("renders unauthenticated badge", async () => {
    vi.mocked(mockApiClient.dataSources.get).mockResolvedValueOnce({
      ...mockDataSource,
      auth_status: "unauthenticated",
    });

    render(
      <MemoryRouter>
        <DataSourceDetailPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("No Auth")).toBeInTheDocument();
    });
  });

  it("renders unknown auth badge", async () => {
    vi.mocked(mockApiClient.dataSources.get).mockResolvedValueOnce({
      ...mockDataSource,
      auth_status: "unknown",
    });

    render(
      <MemoryRouter>
        <DataSourceDetailPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("Unknown")).toBeInTheDocument();
    });
  });

  it("renders missing status badge", async () => {
    vi.mocked(mockApiClient.dataSources.get).mockResolvedValueOnce({
      ...mockDataSource,
      status: "missing",
    });

    render(
      <MemoryRouter>
        <DataSourceDetailPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("missing")).toBeInTheDocument();
    });
  });

  it("handles empty metadata fields", async () => {
    vi.mocked(mockApiClient.dataSources.get).mockResolvedValueOnce({
      ...mockDataSource,
      metadata: {},
    });

    render(
      <MemoryRouter>
        <DataSourceDetailPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByLabelText("Notes")).toHaveValue("");
    });

    expect(screen.getByLabelText("Tags")).toHaveValue("");
  });

  it("handles non-string notes in metadata", async () => {
    vi.mocked(mockApiClient.dataSources.get).mockResolvedValueOnce({
      ...mockDataSource,
      metadata: { notes: 123, tags: ["a"] },
    });

    render(
      <MemoryRouter>
        <DataSourceDetailPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByLabelText("Notes")).toHaveValue("");
    });
  });

  it("handles non-array tags in metadata", async () => {
    vi.mocked(mockApiClient.dataSources.get).mockResolvedValueOnce({
      ...mockDataSource,
      metadata: { notes: "test", tags: "not-array" },
    });

    render(
      <MemoryRouter>
        <DataSourceDetailPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByLabelText("Tags")).toHaveValue("");
    });
  });

  it("filters non-string items from tags array", async () => {
    vi.mocked(mockApiClient.dataSources.get).mockResolvedValueOnce({
      ...mockDataSource,
      metadata: { tags: ["valid", 123, null, "also-valid"] },
    });

    render(
      <MemoryRouter>
        <DataSourceDetailPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByLabelText("Tags")).toHaveValue("valid, also-valid");
    });
  });

  it("disables save lanes button when lanes unchanged", async () => {
    render(
      <MemoryRouter>
        <DataSourceDetailPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("Claude Code")).toBeInTheDocument();
    });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Save lanes" })).toBeDisabled();
    });
  });

  it("disables save metadata button when form unchanged", async () => {
    render(
      <MemoryRouter>
        <DataSourceDetailPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("Claude Code")).toBeInTheDocument();
    });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Save metadata" })).toBeDisabled();
    });
  });
});
