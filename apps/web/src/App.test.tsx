import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { routes } from "./router";

vi.mock("@/lib/diagram-client", () => ({ diagramClient: { list: vi.fn().mockResolvedValue({ data: [], nextCursor: null }) } }));
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

  it("renders sidebar navigation", () => {
    renderApp("/topology");
    expect(screen.getByText("Steed")).toBeInTheDocument();
  });
});
