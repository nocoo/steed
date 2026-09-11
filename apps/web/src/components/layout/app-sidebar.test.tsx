import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { AppSidebar } from "./app-sidebar";
import { ShellProviders } from "./shell-providers";

const originalMatchMedia = window.matchMedia;

function renderSidebar(path = "/overview", collapsed = false) {
  window.matchMedia = vi.fn().mockReturnValue({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  });

  const onToggle = vi.fn();
  const view = render(
    <MemoryRouter initialEntries={[path]}>
      <ShellProviders>
        <AppSidebar collapsed={collapsed} onToggle={onToggle} />
      </ShellProviders>
    </MemoryRouter>
  );
  return { ...view, onToggle };
}

function logoSlot() {
  return document.querySelector("[data-sidebar-logo-slot]");
}

describe("AppSidebar", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    window.matchMedia = originalMatchMedia;
  });

  describe("expanded", () => {
    it("renders logo in the 68px leading slot", () => {
      renderSidebar();
      expect(screen.getByAltText("Steed")).toBeInTheDocument();
      expect(logoSlot()?.className).toContain("w-[68px]");
    });

    it("renders app name and version", () => {
      renderSidebar();
      expect(screen.getByText("Steed")).toBeInTheDocument();
      expect(screen.getAllByText(/v0\.0\.1/).length).toBeGreaterThan(0);
    });

    it("renders nav groups", () => {
      renderSidebar();
      expect(screen.getByText("Dashboard")).toBeInTheDocument();
      expect(screen.getByText("Infrastructure")).toBeInTheDocument();
    });

    it("renders overview and hosts controls", () => {
      renderSidebar();
      expect(
        screen.getByRole("button", { name: /overview/i })
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: /hosts/i })
      ).toBeInTheDocument();
    });

    it("marks the active item", () => {
      renderSidebar("/hosts");
      expect(screen.getByRole("button", { name: /hosts/i })).toHaveAttribute(
        "aria-current",
        "page"
      );
    });

    it("shows collapse button", () => {
      renderSidebar();
      expect(
        screen.getByRole("button", { name: "Collapse sidebar" })
      ).toBeInTheDocument();
    });

    it("hides collapse when hideCollapse is set", () => {
      render(
        <MemoryRouter>
          <ShellProviders>
            <AppSidebar
              collapsed={false}
              onToggle={vi.fn()}
              hideCollapse
            />
          </ShellProviders>
        </MemoryRouter>
      );
      expect(
        screen.queryByRole("button", { name: "Collapse sidebar" })
      ).not.toBeInTheDocument();
    });

    it("notifies toggle on collapse", () => {
      const { onToggle } = renderSidebar();
      act(() => {
        fireEvent.click(screen.getByRole("button", { name: "Collapse sidebar" }));
      });
      expect(onToggle).toHaveBeenCalled();
    });
  });

  describe("collapsed", () => {
    it("keeps the same 68px logo slot without the name", () => {
      renderSidebar("/overview", true);
      expect(screen.getByAltText("Steed")).toBeInTheDocument();
      expect(screen.queryByText("Steed")).not.toBeInTheDocument();
      expect(logoSlot()?.className).toContain("w-[68px]");
      expect(logoSlot()?.className).toContain("h-14");
    });

    it("shows expand button", () => {
      renderSidebar("/overview", true);
      expect(
        screen.getByRole("button", { name: "Expand sidebar" })
      ).toBeInTheDocument();
    });

    it("notifies toggle on expand", () => {
      const { onToggle } = renderSidebar("/overview", true);
      act(() => {
        fireEvent.click(screen.getByRole("button", { name: "Expand sidebar" }));
      });
      expect(onToggle).toHaveBeenCalled();
    });

    it("navigates from icon items", () => {
      renderSidebar("/overview", true);
      fireEvent.click(screen.getByRole("button", { name: "Hosts" }));
      expect(screen.getByRole("button", { name: "Hosts" })).toBeInTheDocument();
    });
  });

  it("closes the mobile sheet after choosing a section", () => {
    const onToggle = vi.fn();
    render(
      <MemoryRouter initialEntries={["/overview"]}>
        <ShellProviders>
          <AppSidebar collapsed={false} onToggle={onToggle} hideCollapse />
        </ShellProviders>
      </MemoryRouter>
    );
    fireEvent.click(screen.getByRole("button", { name: /hosts/i }));
    expect(onToggle).toHaveBeenCalled();
  });
});
