import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { routes } from "./router";

vi.mock("@/lib/diagram-client", () => ({ diagramClient: {
  list: vi.fn().mockResolvedValue({ data: [], nextCursor: null }),
  get: vi.fn().mockRejectedValue(new Error("missing")),
} }));
vi.mock("@/lib/topology-client", () => ({
  topologyClient: { get: vi.fn().mockResolvedValue({ data: { schemaVersion: 2, title: "Topology", description: "", revision: 0, layers: [], types: [], boundaries: [], nodes: [], edges: [], views: [] }, updatedAt: "1970-01-01T00:00:00.000Z" }) },
  downloadTopology: vi.fn(),
}));

function renderRoute(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(<RouterProvider router={router} />);
  return router;
}

describe("router", () => {
  it("redirects / to /topology", async () => {
    const router = renderRoute("/");
    await waitFor(() => {
      expect(screen.getAllByRole("heading", { name: "Topology" }).length).toBeGreaterThan(0);
    });
    expect(router.state.location.pathname).toBe("/topology");
  });

  it("redirects the former diagrams list", async () => {
    const router = renderRoute("/diagrams");
    await waitFor(() => expect(router.state.location.pathname).toBe("/topology"));
  });

  it("redirects former topology links to the canonical topology page", async () => {
    const router = renderRoute("/topology/service%20platform");
    await waitFor(() => expect(router.state.location.pathname).toBe("/topology"));
  });

  it("redirects former diagram links to the canonical topology page", async () => {
    const router = renderRoute("/diagrams/service%20platform");
    await waitFor(() => expect(router.state.location.pathname).toBe("/topology"));
  });

  it("only routes the workspace pages", () => {
    const children = routes[0]!.children!.map((route) => route.path ?? "index");
    expect(children).toEqual(["index", "topology", "topology/:id", "diagrams", "diagrams/:id", "connect"]);
  });
});
