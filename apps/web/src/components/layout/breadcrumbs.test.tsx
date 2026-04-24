import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { Breadcrumbs } from "./breadcrumbs";

function renderWithRouter(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Breadcrumbs />
    </MemoryRouter>
  );
}

describe("Breadcrumbs", () => {
  it("renders nothing for root path", () => {
    const { container } = renderWithRouter("/");
    expect(container.querySelector("nav")).toBeNull();
  });

  it("renders home link for non-root paths", () => {
    renderWithRouter("/overview");
    expect(screen.getByRole("link", { name: "" })).toBeInTheDocument();
  });

  it("renders breadcrumb for single segment", () => {
    renderWithRouter("/overview");
    expect(screen.getByText("Overview")).toBeInTheDocument();
  });

  it("renders breadcrumbs for multiple segments", () => {
    renderWithRouter("/agents/123");
    expect(screen.getByRole("link", { name: "Agents" })).toBeInTheDocument();
    expect(screen.getByText("123")).toBeInTheDocument();
  });

  it("formats kebab-case segments as Title Case", () => {
    renderWithRouter("/data-sources");
    expect(screen.getByText("Data Sources")).toBeInTheDocument();
  });

  it("uses nav item title when available", () => {
    renderWithRouter("/hosts");
    expect(screen.getByText("Hosts")).toBeInTheDocument();
  });

  it("last segment is not a link", () => {
    renderWithRouter("/hosts");
    const hostsText = screen.getByText("Hosts");
    expect(hostsText.tagName).toBe("SPAN");
    expect(hostsText.closest("a")).toBeNull();
  });

  it("intermediate segments are links", () => {
    renderWithRouter("/agents/123");
    const agentsLink = screen.getByRole("link", { name: "Agents" });
    expect(agentsLink).toBeInTheDocument();
  });
});
