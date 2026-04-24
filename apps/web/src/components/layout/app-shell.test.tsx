import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { AppShell } from "./app-shell";
import { SidebarProvider } from "./sidebar-context";

const originalMatchMedia = window.matchMedia;

function renderAppShell(
  path = "/overview",
  isMobile = false
) {
  window.matchMedia = vi.fn().mockReturnValue({
    matches: isMobile,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  });

  return render(
    <MemoryRouter initialEntries={[path]}>
      <SidebarProvider>
        <AppShell>
          <div data-testid="child-content">Page content</div>
        </AppShell>
      </SidebarProvider>
    </MemoryRouter>
  );
}

describe("AppShell", () => {
  beforeEach(() => {
    localStorage.clear();
    document.body.style.overflow = "";
  });

  afterEach(() => {
    window.matchMedia = originalMatchMedia;
    document.body.style.overflow = "";
  });

  it("renders children", () => {
    renderAppShell();
    expect(screen.getByTestId("child-content")).toBeInTheDocument();
  });

  it("renders sidebar with app name", () => {
    renderAppShell();
    expect(screen.getAllByText("Steed").length).toBeGreaterThan(0);
  });

  it("renders breadcrumbs for hosts path", () => {
    renderAppShell("/hosts");
    expect(screen.getAllByText("Hosts").length).toBeGreaterThan(0);
  });

  it("renders theme toggle button", () => {
    renderAppShell();
    const themeButton = screen.getByRole("button", { name: /switch to/i });
    expect(themeButton).toBeInTheDocument();
  });

  it("renders GitHub link", () => {
    renderAppShell();
    expect(screen.getByRole("link", { name: "GitHub repository" })).toBeInTheDocument();
  });

  it("shows mobile menu button on mobile viewport", () => {
    renderAppShell("/overview", true);
    expect(screen.getByRole("button", { name: "Open navigation" })).toBeInTheDocument();
  });

  it("hides mobile menu button on desktop viewport", () => {
    renderAppShell("/overview", false);
    expect(screen.queryByRole("button", { name: "Open navigation" })).not.toBeInTheDocument();
  });

  it("clicking mobile menu button sets body overflow hidden", () => {
    renderAppShell("/overview", true);

    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Open navigation" }));
    });

    expect(document.body.style.overflow).toBe("hidden");
  });
});
