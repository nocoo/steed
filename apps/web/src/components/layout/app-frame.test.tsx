import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { AppFrame } from "./app-frame";
import { ShellProviders } from "./shell-providers";

const originalMatchMedia = window.matchMedia;

function mockViewport(isMobile: boolean) {
  let listener: ((event: { matches: boolean }) => void) | undefined;
  const mobileMql = {
    matches: isMobile,
    addEventListener: vi.fn(
      (_event: string, handler: (event: { matches: boolean }) => void) => {
        listener = handler;
      }
    ),
    removeEventListener: vi.fn(),
  };
  window.matchMedia = vi.fn((query: string) => {
    if (query.includes("max-width")) {
      return mobileMql;
    }
    return {
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };
  });
  return {
    setMobile(next: boolean) {
      mobileMql.matches = next;
      act(() => {
        listener?.({ matches: next });
      });
    },
  };
}

function renderFrame(path = "/topology", isMobile = false) {
  const viewport = mockViewport(isMobile);

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
          { path: "topology", element: <div data-testid="child-content">Page content</div> },
          { path: "topology/:id", element: <div data-testid="child-content">Diagram</div> },
          { path: "connect", element: <div data-testid="child-content">Connect page</div> },
        ],
      },
    ],
    { initialEntries: [path] }
  );

  return { ...render(<RouterProvider router={router} />), viewport };
}

describe("AppFrame", () => {
  beforeEach(() => {
    localStorage.clear();
    document.body.style.overflow = "";
  });

  afterEach(() => {
    vi.restoreAllMocks();
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

  it("renders current page title for connect", () => {
    renderFrame("/connect");
    expect(screen.getAllByText("Connect").length).toBeGreaterThan(0);
  });

  it("has no overview breadcrumb", () => {
    renderFrame("/connect");
    expect(screen.queryByRole("link", { name: "Overview" })).not.toBeInTheDocument();
  });

  it("links topology details back to the topology list", () => {
    renderFrame("/topology/example");
    expect(screen.getByText("Topology diagram")).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "Topology" }).length).toBeGreaterThan(0);
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
    renderFrame("/topology", true);
    expect(
      screen.getByRole("button", { name: "Open navigation" })
    ).toBeInTheDocument();
  });

  it("hides mobile menu button on desktop viewport", () => {
    renderFrame("/topology", false);
    expect(
      screen.queryByRole("button", { name: "Open navigation" })
    ).not.toBeInTheDocument();
  });

  it("returns focus to the menu button after Escape", async () => {
    renderFrame("/topology", true);
    const menu = screen.getByRole("button", { name: "Open navigation" });

    act(() => {
      fireEvent.click(menu);
    });

    const dialog = await screen.findByRole("dialog");
    act(() => {
      fireEvent.keyDown(dialog, { key: "Escape" });
    });

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: "Open navigation" })).toHaveFocus();
  });

  it("clears the sheet and overflow after leaving the mobile breakpoint", async () => {
    const { viewport } = renderFrame("/topology", true);

    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Open navigation" }));
    });
    expect(await screen.findByRole("dialog")).toBeInTheDocument();

    viewport.setMobile(false);

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    expect(
      screen.queryByRole("button", { name: "Open navigation" })
    ).not.toBeInTheDocument();
    expect(document.body.style.overflow).not.toBe("hidden");

    viewport.setMobile(true);

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Open navigation" })
      ).toBeInTheDocument();
    });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
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

  it("keeps the page and sidebar usable when storage reads fail", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("Storage denied", "SecurityError");
    });

    renderFrame();
    expect(screen.getByTestId("child-content")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Collapse sidebar" }));
    expect(screen.getByRole("button", { name: "Expand sidebar" })).toBeInTheDocument();
  });

  it("can collapse and expand when the preference cannot be saved", () => {
    renderFrame();
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("Storage full", "QuotaExceededError");
    });

    fireEvent.click(screen.getByRole("button", { name: "Collapse sidebar" }));
    fireEvent.click(screen.getByRole("button", { name: "Expand sidebar" }));
    expect(screen.getByRole("button", { name: "Collapse sidebar" })).toBeInTheDocument();
    expect(screen.getByTestId("child-content")).toBeInTheDocument();
  });
});
