import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { routes } from "./router";

vi.mock("@/lib/topology-client", () => ({
  topologyClient: { get: vi.fn().mockResolvedValue({ data: { schemaVersion: 2, title: "Topology", description: "", revision: 0, layers: [], types: [], boundaries: [], nodes: [], edges: [], views: [] }, updatedAt: "1970-01-01T00:00:00.000Z" }) },
  downloadTopology: vi.fn(),
}));

function renderApp(initialPath = "/") {
  const router = createMemoryRouter(routes, { initialEntries: [initialPath] });
  return render(<RouterProvider router={router} />);
}

describe("App", () => {
  it("renders the topology workspace", () => {
    renderApp("/topology");
    expect(screen.getAllByRole("heading", { name: "Topology" }).length).toBeGreaterThan(0);
  });

  it("renders sidebar navigation", async () => {
    renderApp("/topology");
    expect(screen.getByAltText("Steed")).toBeInTheDocument();
    const topologyNav = await waitFor(() => screen.getByRole("link", { name: "Topology" }));
    expect(topologyNav).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Expand sidebar" }));
    expect(screen.getByText("Steed")).toBeInTheDocument();
  });
});
