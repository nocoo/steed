import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { SidebarProvider, useSidebar } from "./sidebar-context";

function TestConsumer() {
  const { isExpanded, isMobileOpen, toggle, toggleMobile, closeMobile } =
    useSidebar();
  return (
    <div>
      <span data-testid="expanded">{String(isExpanded)}</span>
      <span data-testid="mobile-open">{String(isMobileOpen)}</span>
      <button onClick={toggle}>Toggle</button>
      <button onClick={toggleMobile}>Toggle Mobile</button>
      <button onClick={closeMobile}>Close Mobile</button>
    </div>
  );
}

describe("SidebarProvider", () => {
  let localStorageData: Record<string, string> = {};

  beforeEach(() => {
    localStorageData = {};
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(
      (key) => localStorageData[key] ?? null
    );
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(
      (key, value) => {
        localStorageData[key] = value;
      }
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("provides default expanded state", () => {
    render(
      <SidebarProvider>
        <TestConsumer />
      </SidebarProvider>
    );
    expect(screen.getByTestId("expanded").textContent).toBe("true");
  });

  it("provides default mobile closed state", () => {
    render(
      <SidebarProvider>
        <TestConsumer />
      </SidebarProvider>
    );
    expect(screen.getByTestId("mobile-open").textContent).toBe("false");
  });

  it("loads initial state from localStorage", () => {
    localStorageData["sidebar-expanded"] = "false";
    render(
      <SidebarProvider>
        <TestConsumer />
      </SidebarProvider>
    );
    expect(screen.getByTestId("expanded").textContent).toBe("false");
  });

  it("toggle updates expanded state and localStorage", () => {
    render(
      <SidebarProvider>
        <TestConsumer />
      </SidebarProvider>
    );

    act(() => {
      fireEvent.click(screen.getByText("Toggle"));
    });

    expect(screen.getByTestId("expanded").textContent).toBe("false");
    expect(localStorageData["sidebar-expanded"]).toBe("false");
  });

  it("toggleMobile updates mobile state", () => {
    render(
      <SidebarProvider>
        <TestConsumer />
      </SidebarProvider>
    );

    act(() => {
      fireEvent.click(screen.getByText("Toggle Mobile"));
    });

    expect(screen.getByTestId("mobile-open").textContent).toBe("true");
  });

  it("closeMobile closes mobile sidebar", () => {
    render(
      <SidebarProvider>
        <TestConsumer />
      </SidebarProvider>
    );

    act(() => {
      fireEvent.click(screen.getByText("Toggle Mobile"));
    });
    expect(screen.getByTestId("mobile-open").textContent).toBe("true");

    act(() => {
      fireEvent.click(screen.getByText("Close Mobile"));
    });
    expect(screen.getByTestId("mobile-open").textContent).toBe("false");
  });
});

describe("useSidebar", () => {
  it("throws when used outside provider", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<TestConsumer />)).toThrow(
      "useSidebar must be used within a SidebarProvider"
    );
    spy.mockRestore();
  });
});
