import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { routes } from "./router";

function renderRoute(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(<RouterProvider router={router} />);
}

describe("router", () => {
  it("redirects / to /overview", () => {
    renderRoute("/");
    expect(screen.getByRole("heading", { name: "Overview" })).toBeInTheDocument();
  });

  it("renders overview page", () => {
    renderRoute("/overview");
    expect(screen.getByRole("heading", { name: "Overview" })).toBeInTheDocument();
    expect(screen.getByText(/Dashboard overview/)).toBeInTheDocument();
  });

  it("renders hosts page", () => {
    renderRoute("/hosts");
    expect(screen.getByRole("heading", { name: "Hosts" })).toBeInTheDocument();
    expect(screen.getByText(/Host list/)).toBeInTheDocument();
  });

  it("renders agents list page", () => {
    renderRoute("/agents");
    expect(screen.getByRole("heading", { name: "Agents" })).toBeInTheDocument();
    expect(screen.getByText(/Agent list/)).toBeInTheDocument();
  });

  it("renders agent detail page with id", () => {
    renderRoute("/agents/abc-123");
    expect(screen.getByRole("heading", { name: "Agent Details" })).toBeInTheDocument();
    expect(screen.getByText(/abc-123/)).toBeInTheDocument();
  });

  it("renders data sources list page", () => {
    renderRoute("/data-sources");
    expect(screen.getByRole("heading", { name: "Data Sources" })).toBeInTheDocument();
    expect(screen.getByText(/Data source list/)).toBeInTheDocument();
  });

  it("renders data source detail page with id", () => {
    renderRoute("/data-sources/ds-456");
    expect(screen.getByRole("heading", { name: "Data Source Details" })).toBeInTheDocument();
    expect(screen.getByText(/ds-456/)).toBeInTheDocument();
  });

  it("renders map page", () => {
    renderRoute("/map");
    expect(screen.getByRole("heading", { name: "Map" })).toBeInTheDocument();
    expect(screen.getByText(/Relationship map/)).toBeInTheDocument();
  });
});
