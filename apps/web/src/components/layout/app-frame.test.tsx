import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { AppFrame } from "./app-frame";
import { ShellProviders } from "./shell-providers";

const originalMatchMedia = window.matchMedia;

function renderFrame(path = "/overview", isMobile = false) {
  window.matchMedia = vi.fn().mockReturnValue({
    matches: isMobile,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  });

  const router = createMemoryRouter(
    [
      {
        path: "/",
        element: (
          <ShellProviders>
            <AppFrame />
          </ShellProviders>
        ),
        children: [
          { path: "overview", element: <div data-testid="child-content">Page content</div> },
          { path: "hosts", element: <div data-testid="child-content">Hosts</div> },
          { path: "agents/:id", element: <div data-testid="child-content">Agent</div> },
        ],
      },
    ],
    { initialEntries: [path] }
  );

  return render(<RouterProvider router={router} />);
}

describe("AppFrame", () => {
  beforeEach(() => {
    localStorage.clear();
    document.body.style.overflow = "";
  });

  afterEach(() => {
    window.matchMedia = originalMatchMedia;
    document.body.style.overflow = "";
  });

  it("renders children", () => {
    renderFrame();
    expect(screen.getByTestId("child-content")).toBeInTheDocument();
  });

  it("renders sidebar with app name", () => {
    renderFrame();
    expect(screen.getAllByText("Steed").length).toBeGreaterThan(0);
  });

  it("renders current page title for hosts", () => {
    renderFrame("/hosts");
    expect(screen.getAllByText("Hosts").length).toBeGreaterThan(0);
  });

  it("does not link the current page in breadcrumbs", () => {
    renderFrame("/hosts");
    const overviewLinks = screen.getAllByRole("link", { name: "Overview" });
    expect(overviewLinks.length).toBeGreaterThan(0);
    expect(
      screen.queryByRole("link", { name: "Hosts" })
    ).not.toBeInTheDocument();
  });

  it("keeps agent id as title, not a link", () => {
    renderFrame("/agents/agent-123");
    expect(screen.getByText("agent-123")).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "agent-123" })
    ).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Agents" })).toBeInTheDocument();
  });

  it("renders theme toggle", () => {
    renderFrame();
    expect(
      screen.getByRole("button", { name: /toggle theme/i })
    ).toBeInTheDocument();
  });

  it("renders GitHub link to nocoo/steed", () => {
    renderFrame();
    const link = screen.getByRole("link", { name: "GitHub repository" });
    expect(link).toHaveAttribute("href", "https://github.com/nocoo/steed");
  });

  it("shows mobile menu button on mobile viewport", () => {
    renderFrame("/overview", true);
    expect(
      screen.getByRole("button", { name: "Open navigation" })
    ).toBeInTheDocument();
  });

  it("hides mobile menu button on desktop viewport", () => {
    renderFrame("/overview", false);
    expect(
      screen.queryByRole("button", { name: "Open navigation" })
    ).not.toBeInTheDocument();
  });

  it("clicking mobile menu button sets body overflow hidden", () => {
    renderFrame("/overview", true);

    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Open navigation" }));
    });

    expect(document.body.style.overflow).toBe("hidden");
  });

  it("persists collapse in localStorage", () => {
    renderFrame();
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Collapse sidebar" }));
    });
    expect(localStorage.getItem("sidebar-expanded")).toBe("false");
  });

  it("restores collapsed rail from localStorage", async () => {
    localStorage.setItem("sidebar-expanded", "false");
    renderFrame();
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Expand sidebar" })
      ).toBeInTheDocument();
    });
  });
});
