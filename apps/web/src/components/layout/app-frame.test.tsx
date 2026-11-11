import { StrictMode } from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { AppFrame } from "./app-frame";
import { ShellProviders } from "./shell-providers";
import { useTopologyNavigation } from "./topology-navigation-context";

function TopologyNavigationHarness() {
  const navigation = useTopologyNavigation();
  return (
    <>
      <div data-testid="child-content">Page content</div>
      <input aria-label="Sidebar test input" />
      <button type="button" aria-label="Enter test fullscreen" onClick={() => navigation.setFullscreenActive(true)}>Enter test fullscreen</button>
      <button type="button" aria-label="Exit test fullscreen" onClick={() => navigation.setFullscreenActive(false)}>Exit test fullscreen</button>
      <button type="button" aria-label="Toggle navigation hidden" onClick={() => navigation.toggleHidden(true)}>Toggle navigation hidden</button>
      <button type="button" aria-label="Toggle navigation expanded" onClick={() => navigation.toggleExpanded()}>Toggle navigation expanded</button>
    </>
  );
}

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

function renderFrame(path = "/topology", isMobile = false, strict = false) {
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
          { path: "topology", element: <TopologyNavigationHarness /> },
          { path: "topology/:id", element: <div data-testid="child-content">Diagram</div> },
          { path: "connect", element: <div data-testid="child-content">Connect page</div> },
        ],
      },
    ],
    { initialEntries: [path] }
  );

  const rendered = render(strict ? <StrictMode><RouterProvider router={router} /></StrictMode> : <RouterProvider router={router} />);
  return { ...rendered, viewport, router };
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
    renderFrame("/connect");
    expect(screen.getAllByText("Steed").length).toBeGreaterThan(0);
  });

  it("renders current page title for connect", () => {
    renderFrame("/connect");
    expect(screen.getAllByText("Connect").length).toBeGreaterThan(0);
  });

  it("exposes the breadcrumb landmark", () => {
    renderFrame("/connect");
    expect(screen.getByRole("navigation", { name: "Breadcrumb" })).toBeInTheDocument();
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

  it("uses the global sidebar on topology diagram routes", () => {
    renderFrame("/topology/example");
    expect(screen.getByRole("button", { name: "Collapse sidebar" })).toBeInTheDocument();
  });

  it("renders theme toggle", () => {
    renderFrame();
    expect(
      screen.getByRole("button", { name: /toggle theme/i })
    ).toBeInTheDocument();
  });

  it("renders GitHub link to nocoo/steed", () => {
    renderFrame();
    const github = screen.getByRole("link", {
      name: /GitHub repository.*opens in a new tab/i,
    });
    expect(github).toHaveAttribute("href", "https://github.com/nocoo/steed");
  });

  it("renders the hexly project link", () => {
    renderFrame();
    const hexly = screen.getByRole("link", {
      name: /Steed on hexly\.ai.*opens in a new tab/i,
    });
    expect(hexly).toHaveAttribute("href", "https://hexly.ai/projects/steed");
  });

  it("shows mobile menu button on mobile viewport", () => {
    renderFrame("/topology", true);
    const menu = screen.getByRole("button", { name: "Open navigation" });
    expect(menu).toBeInTheDocument();
    expect(menu).not.toHaveAttribute("aria-controls");
    act(() => {
      fireEvent.click(menu);
    });
    expect(menu).toHaveAttribute("aria-controls", "steed-mobile-navigation-sheet");
  });

  it("hides mobile menu button on desktop viewport", () => {
    renderFrame("/topology", false);
    expect(
      screen.queryByRole("button", { name: "Open navigation" })
    ).not.toBeInTheDocument();
  });

  it("closes the mobile drawer after in-drawer navigation", async () => {
    renderFrame("/topology", true);
    fireEvent.click(screen.getByRole("button", { name: "Open navigation" }));
    await screen.findByRole("dialog");
    fireEvent.click(screen.getByRole("link", { name: /connect/i }));
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
  });

  it("closes the mobile drawer from the sidebar dismiss control", async () => {
    renderFrame("/topology", true);
    fireEvent.click(screen.getByRole("button", { name: "Open navigation" }));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Close navigation" }));
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
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
    renderFrame("/connect");
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Collapse sidebar" }));
    });
    expect(localStorage.getItem("sidebar-expanded")).toBe("false");
  });

  it("restores collapsed rail from localStorage", async () => {
    localStorage.setItem("sidebar-expanded", "false");
    renderFrame("/connect");
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Expand sidebar" })
      ).toBeInTheDocument();
    });
  });

  it("defaults the topology sidebar to a rail independently of the global preference", () => {
    localStorage.setItem("sidebar-expanded", "true");
    renderFrame("/topology");
    expect(screen.getByRole("button", { name: "Expand sidebar" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Collapse sidebar" })).not.toBeInTheDocument();
  });

  it("reveals the rail when the hidden edge tab is clicked", async () => {
    renderFrame("/topology");
    fireEvent.keyDown(window, { key: "\\" });
    fireEvent.click(screen.getByRole("button", { name: "Reveal navigation" }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Expand sidebar" })).toBeInTheDocument();
    });
  });

  it("hides and reveals topology navigation with keyboard and persistence", async () => {
    renderFrame("/topology");
    fireEvent.keyDown(window, { key: "\\" });

    expect(localStorage.getItem("steed-topology-nav")).toBe("hidden");
    expect(screen.queryByRole("button", { name: "Expand sidebar" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reveal navigation" })).toBeInTheDocument();

    fireEvent.mouseEnter(screen.getByRole("button", { name: "Reveal navigation" }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Expand sidebar" })).toBeInTheDocument();
    });
    expect(localStorage.getItem("steed-topology-nav")).toBe("rail");
  });

  it("reveals the rail by keyboard focus and restores rail after hiding a rail state", async () => {
    renderFrame("/topology");
    fireEvent.keyDown(window, { key: "\\" });

    const reveal = screen.getByRole("button", { name: "Reveal navigation" });
    fireEvent.focus(reveal);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Expand sidebar" })).toBeInTheDocument();
    });
    expect(localStorage.getItem("steed-topology-nav")).toBe("rail");

    fireEvent.keyDown(window, { key: "\\" });
    expect(localStorage.getItem("steed-topology-nav")).toBe("hidden");
    fireEvent.keyDown(window, { key: "\\" });
    expect(localStorage.getItem("steed-topology-nav")).toBe("rail");
  });

  it("preserves keyboard focus when the hidden edge tab reveals the rail in StrictMode", async () => {
    localStorage.setItem("steed-topology-nav", "hidden");
    renderFrame("/topology", false, true);

    const reveal = screen.getByRole("button", { name: "Reveal navigation" });
    reveal.focus();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Expand sidebar" })).toHaveFocus();
    });
    expect(document.activeElement).not.toBe(document.body);
  });

  it("clears shared fullscreen state after leaving and revisiting topology", async () => {
    const { router } = renderFrame("/topology");
    fireEvent.click(screen.getByRole("button", { name: "Enter test fullscreen" }));

    await act(async () => {
      await router.navigate("/connect");
    });
    await act(async () => {
      await router.navigate("/topology");
    });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Expand sidebar" })).toBeInTheDocument();
    });
  });

  it("moves keyboard focus to the reveal control when hiding and back when showing with the shortcut", async () => {
    renderFrame("/topology");
    const expand = screen.getByRole("button", { name: "Expand sidebar" });
    expand.focus();

    fireEvent.keyDown(expand, { key: "\\" });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Reveal navigation" })).toHaveFocus();
    });

    const reveal = screen.getByRole("button", { name: "Reveal navigation" });
    fireEvent.keyDown(reveal, { key: "\\" });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Expand sidebar" })).toHaveFocus();
    });
  });

  it("moves keyboard focus to the collapse control when an expanded sidebar is shown again", async () => {
    renderFrame("/topology");
    fireEvent.click(screen.getByRole("button", { name: "Expand sidebar" }));
    const collapse = screen.getByRole("button", { name: "Collapse sidebar" });
    collapse.focus();

    fireEvent.keyDown(collapse, { key: "\\" });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Reveal navigation" })).toHaveFocus();
    });

    fireEvent.keyDown(screen.getByRole("button", { name: "Reveal navigation" }), { key: "\\" });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Collapse sidebar" })).toHaveFocus();
    });
  });

  it("does not handle the topology shortcut outside the topology page", () => {
    renderFrame("/connect");
    fireEvent.keyDown(window, { key: "\\" });

    expect(localStorage.getItem("steed-topology-nav")).not.toBe("hidden");
    expect(screen.getByRole("button", { name: "Collapse sidebar" })).toBeInTheDocument();
  });

  it("keeps navigation controls safe when called from hidden or fullscreen states", async () => {
    renderFrame("/topology");
    fireEvent.keyDown(window, { key: "\\" });
    expect(screen.getByRole("button", { name: "Reveal navigation" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Toggle navigation expanded" }));
    expect(screen.getByRole("button", { name: "Expand sidebar" })).toBeInTheDocument();
    expect(localStorage.getItem("steed-topology-nav")).toBe("rail");

    fireEvent.click(screen.getByRole("button", { name: "Enter test fullscreen" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Collapse sidebar" })).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Toggle navigation hidden" }));
    expect(localStorage.getItem("steed-topology-nav")).toBe("rail");
  });

  it("ignores topology sidebar shortcuts in edited fields and with modifiers", () => {
    renderFrame("/topology");

    fireEvent.keyDown(window, { key: "\\", ctrlKey: true });
    fireEvent.keyDown(window, { key: "\\", metaKey: true });
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Sidebar test input" }), { key: "\\" });

    expect(localStorage.getItem("steed-topology-nav")).not.toBe("hidden");
    expect(screen.getByRole("button", { name: "Expand sidebar" })).toBeInTheDocument();
  });

  it("falls back to rail for invalid topology navigation persistence", () => {
    localStorage.setItem("steed-topology-nav", "invalid-state");
    renderFrame("/topology");
    expect(screen.getByRole("button", { name: "Expand sidebar" })).toBeInTheDocument();
  });

  it("keeps topology navigation usable when topology storage reads and writes fail", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation((key: string) => {
      if (key === "steed-topology-nav") throw new DOMException("Storage denied", "SecurityError");
      return null;
    });

    renderFrame("/topology");
    expect(screen.getByRole("button", { name: "Expand sidebar" })).toBeInTheDocument();

    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("Storage full", "QuotaExceededError");
    });
    fireEvent.keyDown(window, { key: "\\" });
    expect(screen.getByRole("button", { name: "Reveal navigation" })).toBeInTheDocument();
    fireEvent.mouseEnter(screen.getByRole("button", { name: "Reveal navigation" }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Expand sidebar" })).toBeInTheDocument();
    });
  });

  it("restores hidden and expanded topology states and keeps mobile navigation as a sheet", async () => {
    localStorage.setItem("steed-topology-nav", "expanded");
    const { viewport } = renderFrame("/topology", false);
    expect(screen.getByRole("button", { name: "Collapse sidebar" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Collapse sidebar" }));
    expect(localStorage.getItem("steed-topology-nav")).toBe("rail");
    fireEvent.click(screen.getByRole("button", { name: "Expand sidebar" }));
    expect(localStorage.getItem("steed-topology-nav")).toBe("expanded");

    fireEvent.keyDown(window, { key: "\\" });
    expect(localStorage.getItem("steed-topology-nav")).toBe("hidden");
    fireEvent.keyDown(window, { key: "\\" });
    expect(localStorage.getItem("steed-topology-nav")).toBe("expanded");

    viewport.setMobile(true);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Open navigation" })).toBeInTheDocument();
    });
  });

  it("hides topology navigation in fullscreen and restores the previous state", async () => {
    localStorage.setItem("steed-topology-nav", "expanded");
    renderFrame("/topology");
    expect(screen.getByRole("button", { name: "Collapse sidebar" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Enter test fullscreen" }));
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "Collapse sidebar" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Reveal navigation" })).not.toBeInTheDocument();
    });

    fireEvent.keyDown(window, { key: "\\" });
    expect(localStorage.getItem("steed-topology-nav")).toBe("expanded");

    fireEvent.click(screen.getByRole("button", { name: "Exit test fullscreen" }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Collapse sidebar" })).toBeInTheDocument();
    });
  });

  it("closes the mobile sheet and menu when fullscreen starts", async () => {
    const { container } = renderFrame("/topology", true);

    fireEvent.click(screen.getByRole("button", { name: "Open navigation" }));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();

    const enterFullscreen = container.querySelector('[aria-label="Enter test fullscreen"]');
    expect(enterFullscreen).not.toBeNull();
    fireEvent.click(enterFullscreen!);
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Open navigation" })).not.toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Exit test fullscreen" }));
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Open navigation" })).toBeInTheDocument();
    });
  });

  it("keeps the page and sidebar usable when storage reads fail", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("Storage denied", "SecurityError");
    });

    renderFrame("/connect");
    expect(screen.getByTestId("child-content")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Collapse sidebar" }));
    expect(screen.getByRole("button", { name: "Expand sidebar" })).toBeInTheDocument();
  });

  it("can collapse and expand when the preference cannot be saved", () => {
    renderFrame("/connect");
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("Storage full", "QuotaExceededError");
    });

    fireEvent.click(screen.getByRole("button", { name: "Collapse sidebar" }));
    fireEvent.click(screen.getByRole("button", { name: "Expand sidebar" }));
    expect(screen.getByRole("button", { name: "Collapse sidebar" })).toBeInTheDocument();
    expect(screen.getByTestId("child-content")).toBeInTheDocument();
  });
});
