import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { SidebarProvider } from "@nocoo/basalt";
import { AppSidebar } from "./app-sidebar";
import { ShellProviders } from "./shell-providers";

const profile = vi.hoisted(() => vi.fn());
vi.mock("@/hooks/use-profile", () => ({ useProfile: profile }));

const originalMatchMedia = window.matchMedia;

function renderSidebar(
  path = "/topology",
  collapsed = false,
  options?: { variant?: "mobile"; onNavigate?: () => void; onDismiss?: () => void },
): ReturnType<typeof render> & { onCollapsedChange: ReturnType<typeof vi.fn>; router: ReturnType<typeof createMemoryRouter> } {
  window.matchMedia = vi.fn().mockReturnValue({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  });

  const onCollapsedChange = vi.fn();
  function SidebarShell() {
    return (
      <ShellProviders>
        <SidebarProvider collapsed={collapsed} onCollapsedChange={onCollapsedChange}>
          <AppSidebar ariaLabel="Main navigation" {...(options ?? {})} />
        </SidebarProvider>
      </ShellProviders>
    );
  }
  const router = createMemoryRouter(
    [
      { path: "/topology", element: <SidebarShell /> },
      { path: "/connect", element: <SidebarShell /> },
      { path: "/connect/nested", element: <SidebarShell /> },
    ],
    { initialEntries: [path] },
  );
  const view = render(<RouterProvider router={router} />);
  return { ...view, onCollapsedChange, router };
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
  });

  it("keeps the profile avatar in the collapsed footer", () => {
    profile.mockReturnValue({ name: "Example User", email: "user@example.com", avatar: null });
    renderSidebar("/topology", true);
    expect(screen.getByText("E")).toBeInTheDocument();
    expect(screen.queryByText("user@example.com")).not.toBeInTheDocument();
  });

  it("falls back to a generic user label without a profile", () => {
    renderSidebar();
    expect(screen.getByText("User")).toBeInTheDocument();
  });

  it("hides sign-out on the collapsed rail", () => {
    profile.mockReturnValue({ name: "Example User", email: "user@example.com" });
    renderSidebar("/topology", true);
    expect(screen.queryByRole("link", { name: "Sign out" })).not.toBeInTheDocument();
  });

  it("wires Cloudflare Access sign-out", () => {
    profile.mockReturnValue({ name: "Example User", email: "user@example.com", avatar: null });
    renderSidebar();
    const signOut = screen.getByRole("link", { name: "Sign out" });
    expect(signOut).toHaveAttribute("href", "/cdn-cgi/access/logout");
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
      expect(screen.getByRole("link", { name: /connect/i })).toBeInTheDocument();
      fireEvent.click(label);
      expect(screen.queryByRole("link", { name: /connect/i })).not.toBeInTheDocument();
    });

    it("renders app name and version", () => {
      renderSidebar();
      expect(screen.getByText("Steed")).toBeInTheDocument();
      expect(screen.getAllByText(/v0\.6\.2/).length).toBeGreaterThan(0);
    });

    it("renders only the workspace group", () => {
      renderSidebar();
      expect(screen.getByText("Workspace")).toBeInTheDocument();
      expect(screen.queryByText("Dashboard")).not.toBeInTheDocument();
      expect(screen.queryByText("Infrastructure")).not.toBeInTheDocument();
    });

    it("renders topology and connect controls only", () => {
      renderSidebar();
      expect(screen.getByRole("link", { name: /topology/i })).toBeInTheDocument();
      expect(screen.getByRole("link", { name: /connect/i })).toBeInTheDocument();
      expect(screen.queryByRole("link", { name: /hosts/i })).not.toBeInTheDocument();
    });

    it("marks the active item", () => {
      renderSidebar("/connect");
      expect(screen.getByRole("link", { name: /connect/i })).toHaveAttribute("aria-current", "page");
    });

    it("marks connect active for nested paths", () => {
      renderSidebar("/connect/nested");
      expect(document.querySelector('a[href="/connect"]')).toHaveAttribute("aria-current", "page");
    });

    it("renders the mobile dismiss control without a custom handler", () => {
      renderSidebar("/topology", false, { variant: "mobile" });
      expect(screen.getByRole("button", { name: "Close navigation" })).toBeInTheDocument();
    });

    it("shows collapse button", () => {
      renderSidebar();
      expect(screen.getByRole("button", { name: "Collapse sidebar" })).toBeInTheDocument();
    });

    it("uses dismiss toggle in the mobile drawer", () => {
      const router = createMemoryRouter(
        [
          {
            path: "/topology",
            element: (
              <ShellProviders>
                <SidebarProvider collapsed={false}>
                  <AppSidebar ariaLabel="Navigation" variant="mobile" onDismiss={vi.fn()} />
                </SidebarProvider>
              </ShellProviders>
            ),
          },
        ],
        { initialEntries: ["/topology"] },
      );
      render(<RouterProvider router={router} />);
      expect(screen.getByRole("button", { name: "Close navigation" })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Collapse sidebar" })).not.toBeInTheDocument();
    });

    it("notifies provider on collapse", () => {
      const { onCollapsedChange } = renderSidebar();
      act(() => {
        fireEvent.click(screen.getByRole("button", { name: "Collapse sidebar" }));
      });
      expect(onCollapsedChange).toHaveBeenCalledWith(true);
    });
  });

  describe("collapsed", () => {
    it("keeps the brand mark", () => {
      renderSidebar("/topology", true);
      expect(screen.getByAltText("Steed")).toBeInTheDocument();
    });

    it("shows expand button", () => {
      renderSidebar("/topology", true);
      expect(screen.getByRole("button", { name: "Expand sidebar" })).toBeInTheDocument();
    });

    it("notifies provider on expand", () => {
      const { onCollapsedChange } = renderSidebar("/topology", true);
      act(() => {
        fireEvent.click(screen.getByRole("button", { name: "Expand sidebar" }));
      });
      expect(onCollapsedChange).toHaveBeenCalledWith(false);
    });

    it("navigates from icon items", async () => {
      const { router } = renderSidebar("/topology", true);
      fireEvent.click(document.querySelector('a[href="/connect"]')!);
      await vi.waitFor(() => {
        expect(router.state.location.pathname).toBe("/connect");
      });
    });
  });

    it("closes the mobile sheet after choosing a section", () => {
      const onNavigate = vi.fn();
      renderSidebar("/topology", false, { variant: "mobile", onNavigate });
      const connect = document.querySelector('a[href="/connect"]');
      expect(connect).not.toBeNull();
      fireEvent.click(connect!);
      expect(onNavigate).toHaveBeenCalled();
    });

  it("closes the mobile drawer from the dismiss toggle", () => {
    const onDismiss = vi.fn();
    renderSidebar("/topology", false, { variant: "mobile", onDismiss });
    fireEvent.click(screen.getByRole("button", { name: "Close navigation" }));
    expect(onDismiss).toHaveBeenCalled();
  });
});
