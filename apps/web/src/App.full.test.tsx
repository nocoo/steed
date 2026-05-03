import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { createMockApiClient } from "@/viewmodels/__tests__/test-utils";

const mockApiClient = createMockApiClient();

vi.mock("./contexts/api-client", async () => {
  const actual = await vi.importActual<typeof import("./contexts/api-client")>(
    "./contexts/api-client"
  );
  return {
    ...actual,
    useApiClient: () => mockApiClient,
  };
});

import { App } from "./App";

describe("App", () => {
  it("renders inside ApiClientProvider with the live router", async () => {
    vi.mocked(mockApiClient.overview.get).mockResolvedValue({
      hosts: { total: 0, online: 0, offline: 0 },
      agents: {
        total: 0,
        running: 0,
        by_lane: { work: 0, life: 0, learning: 0, unassigned: 0 },
      },
      data_sources: { total: 0, active: 0 },
    });

    window.history.pushState({}, "", "/overview");

    render(<App />);

    await waitFor(() => {
      expect(
        screen.getByRole("heading", { name: "Overview" })
      ).toBeInTheDocument();
    });
  });
});
