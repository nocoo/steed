import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { Sidebar } from "./sidebar";
import { SidebarProvider } from "./sidebar-context";

const originalMatchMedia = window.matchMedia;

function renderSidebar(
  path = "/overview",
  isMobile = false,
  initialExpanded = true
) {
  if (initialExpanded) {
    localStorage.setItem("sidebar-expanded", "true");
  } else {
    localStorage.setItem("sidebar-expanded", "false");
  }

  window.matchMedia = vi.fn().mockReturnValue({
    matches: isMobile,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  });

  return render(
    <MemoryRouter initialEntries={[path]}>
      <SidebarProvider>
        <Sidebar />
      </SidebarProvider>
    </MemoryRouter>
  );
}

describe("Sidebar", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    window.matchMedia = originalMatchMedia;
    localStorage.clear();
  });

  describe("expanded view", () => {
    it("renders logo", () => {
      renderSidebar();
      expect(screen.getAllByText("S").length).toBeGreaterThan(0);
    });

    it("renders app name", () => {
      renderSidebar();
      expect(screen.getByText("Steed")).toBeInTheDocument();
    });

    it("renders version", () => {
      renderSidebar();
      expect(screen.getAllByText(/v0\.0\.1/).length).toBeGreaterThan(0);
    });

    it("renders dashboard nav group", () => {
      renderSidebar();
      expect(screen.getByText("Dashboard")).toBeInTheDocument();
    });

    it("renders infrastructure nav group", () => {
      renderSidebar();
      expect(screen.getByText("Infrastructure")).toBeInTheDocument();
    });

    it("renders overview nav item", () => {
      renderSidebar();
      expect(screen.getByRole("link", { name: /overview/i })).toBeInTheDocument();
    });

    it("renders hosts nav item", () => {
      renderSidebar();
      expect(screen.getByRole("link", { name: /hosts/i })).toBeInTheDocument();
    });

    it("highlights active nav item", () => {
      renderSidebar("/hosts");
      const hostsLinks = screen.getAllByRole("link", { name: /hosts/i });
      expect(hostsLinks.some(link => link.className.includes("bg-accent"))).toBe(true);
    });

    it("shows collapse button on desktop", () => {
      renderSidebar("/overview", false, true);
      expect(screen.getByRole("button", { name: "Collapse sidebar" })).toBeInTheDocument();
    });

    it("hides collapse button on mobile", () => {
      renderSidebar("/overview", true, true);
      expect(screen.queryByRole("button", { name: "Collapse sidebar" })).not.toBeInTheDocument();
    });

    it("clicking collapse updates localStorage", () => {
      renderSidebar("/overview", false, true);

      act(() => {
        fireEvent.click(screen.getByRole("button", { name: "Collapse sidebar" }));
      });

      expect(localStorage.getItem("sidebar-expanded")).toBe("false");
    });
  });

  describe("collapsed view", () => {
    it("shows logo but not app name", () => {
      renderSidebar("/overview", false, false);
      expect(screen.getAllByText("S").length).toBeGreaterThan(0);
      expect(screen.queryByText("Steed")).not.toBeInTheDocument();
    });

    it("shows expand button", () => {
      renderSidebar("/overview", false, false);
      expect(screen.getByRole("button", { name: "Expand sidebar" })).toBeInTheDocument();
    });

    it("clicking expand updates localStorage", () => {
      renderSidebar("/overview", false, false);

      act(() => {
        fireEvent.click(screen.getByRole("button", { name: "Expand sidebar" }));
      });

      expect(localStorage.getItem("sidebar-expanded")).toBe("true");
    });
  });

  describe("mobile view", () => {
    it("shows expanded content on mobile", () => {
      renderSidebar("/overview", true, false);
      expect(screen.getByText("Steed")).toBeInTheDocument();
    });
  });
});
