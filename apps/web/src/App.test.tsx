import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { routes } from "./router";

vi.mock("@/lib/diagram-client", () => ({ diagramClient: { list: vi.fn().mockResolvedValue({ data: [], nextCursor: null }) } }));

function renderApp(initialPath = "/") {
  const router = createMemoryRouter(routes, { initialEntries: [initialPath] });
  return render(<RouterProvider router={router} />);
}

describe("App", () => {
  it("renders the diagrams workspace", () => {
    renderApp("/diagrams");
    expect(screen.getAllByRole("heading", { name: "Diagrams" }).length).toBeGreaterThan(0);
  });

  it("renders sidebar navigation", () => {
    renderApp("/diagrams");
    expect(screen.getByText("Steed")).toBeInTheDocument();
  });
});
