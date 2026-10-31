import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { routes } from "./router";

vi.mock("@/lib/diagram-client", () => ({ diagramClient: { list: vi.fn().mockResolvedValue({ data: [], nextCursor: null }) } }));

function renderRoute(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(<RouterProvider router={router} />);
  return router;
}

describe("router", () => {
  it("redirects / to /diagrams", async () => {
    const router = renderRoute("/");
    await waitFor(() => {
      expect(screen.getAllByRole("heading", { name: "Diagrams" }).length).toBeGreaterThan(0);
    });
    expect(router.state.location.pathname).toBe("/diagrams");
  });

  it("only routes the workspace pages", () => {
    const children = routes[0]!.children!.map((route) => route.path ?? "index");
    expect(children).toEqual(["index", "diagrams", "diagrams/:id", "connect"]);
  });
});
