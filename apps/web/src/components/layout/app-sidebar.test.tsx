import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { AppSidebar } from "./app-sidebar";
import { ShellProviders } from "./shell-providers";

const profile = vi.hoisted(() => vi.fn());
vi.mock("@/hooks/use-profile", () => ({ useProfile: profile }));

const originalMatchMedia = window.matchMedia;

function renderSidebar(path = "/topology", collapsed = false) {
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

describe("AppSidebar", () => {
  beforeEach(() => {
    localStorage.clear();
    profile.mockReturnValue(null);
  });

  it("shows the signed-in name, email, and avatar in the expanded footer", () => {
    profile.mockReturnValue({ name: "Example User", email: "user@example.com", avatar: "https://example.com/a.png" });
    renderSidebar();
    expect(screen.getByText("Example User")).toBeInTheDocument();
    expect(screen.getByText("user@example.com")).toBeInTheDocument();
    expect(screen.getByLabelText("Example User")).toBeInTheDocument();
  });

  it("keeps the profile avatar in the collapsed footer", () => {
    profile.mockReturnValue({ name: "Example User", email: "user@example.com", avatar: null });
    renderSidebar("/topology", true);
    expect(screen.getByLabelText("Example User")).toBeInTheDocument();
    expect(screen.queryByText("user@example.com")).not.toBeInTheDocument();
  });

  afterEach(() => {
    window.matchMedia = originalMatchMedia;
  });

  describe("expanded", () => {
    it("renders the brand mark in the header", () => {
      renderSidebar();
      expect(screen.getByAltText("Steed")).toBeInTheDocument();
    });

    it("collapses a nav group from its label", () => {
      renderSidebar();
      const label = screen.getByRole("button", { name: /workspace/i });
      expect(screen.getByRole("button", { name: /connect/i })).toBeInTheDocument();
      fireEvent.click(label);
      expect(screen.queryByRole("button", { name: /connect/i })).not.toBeInTheDocument();
    });

    it("renders app name and version", () => {
      renderSidebar();
      expect(screen.getByText("Steed")).toBeInTheDocument();
      expect(screen.getAllByText(/v0\.5\.1/).length).toBeGreaterThan(0);
    });

    it("renders only the workspace group", () => {
      renderSidebar();
      expect(screen.getByText("Workspace")).toBeInTheDocument();
      expect(screen.queryByText("Dashboard")).not.toBeInTheDocument();
      expect(screen.queryByText("Infrastructure")).not.toBeInTheDocument();
    });

    it("renders topology and connect controls only", () => {
      renderSidebar();
      expect(screen.getByRole("button", { name: /topology/i })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /connect/i })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /hosts/i })).not.toBeInTheDocument();
    });

    it("marks the active item", () => {
      renderSidebar("/connect");
      expect(screen.getByRole("button", { name: /connect/i })).toHaveAttribute(
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
    it("keeps the brand mark without the app name", () => {
      renderSidebar("/topology", true);
      expect(screen.getByAltText("Steed")).toBeInTheDocument();
      expect(screen.queryByText("Steed")).not.toBeInTheDocument();
    });

    it("shows expand button", () => {
      renderSidebar("/topology", true);
      expect(
        screen.getByRole("button", { name: "Expand sidebar" })
      ).toBeInTheDocument();
    });

    it("notifies toggle on expand", () => {
      const { onToggle } = renderSidebar("/topology", true);
      act(() => {
        fireEvent.click(screen.getByRole("button", { name: "Expand sidebar" }));
      });
      expect(onToggle).toHaveBeenCalled();
    });

    it("navigates from icon items", () => {
      renderSidebar("/topology", true);
      fireEvent.click(screen.getByRole("button", { name: "Connect" }));
      expect(screen.getByRole("button", { name: "Connect" })).toBeInTheDocument();
    });
  });

  it("closes the mobile sheet after choosing a section", () => {
    const onToggle = vi.fn();
    render(
      <MemoryRouter initialEntries={["/topology"]}>
        <ShellProviders>
          <AppSidebar collapsed={false} onToggle={onToggle} hideCollapse />
        </ShellProviders>
      </MemoryRouter>
    );
    fireEvent.click(screen.getByRole("button", { name: /connect/i }));
    expect(onToggle).toHaveBeenCalled();
  });
});
