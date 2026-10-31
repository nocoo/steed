import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { routes } from "./router";

vi.mock("@/lib/diagram-client", () => ({ diagramClient: {
  list: vi.fn().mockResolvedValue({ data: [], nextCursor: null }),
  get: vi.fn().mockRejectedValue(new Error("missing")),
} }));

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

  it("redirects a former diagram link to its topology page", async () => {
    const router = renderRoute("/diagrams/service%20platform");
    await waitFor(() => expect(router.state.location.pathname).toBe("/topology/service%20platform"));
  });

  it("only routes the workspace pages", () => {
    const children = routes[0]!.children!.map((route) => route.path ?? "index");
    expect(children).toEqual(["index", "topology", "topology/:id", "diagrams", "diagrams/:id", "connect"]);
  });
});
