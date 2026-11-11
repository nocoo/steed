import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ThemeProvider } from "@nocoo/basalt";
import { ThemeToggle } from "@nocoo/basalt/components/theme-toggle";

const originalMatchMedia = window.matchMedia;

describe("theme toggle", () => {
  beforeEach(() => {
    document.documentElement.classList.remove("light", "dark");
    delete document.documentElement.dataset.mode;
    localStorage.clear();
    window.matchMedia = vi.fn(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
  });

  afterEach(() => {
    window.matchMedia = originalMatchMedia;
    vi.restoreAllMocks();
  });

  it.each([
    ["system", "Switch to light theme", "Switch to dark theme", "light", "light"],
    ["light", "Switch to dark theme", "Use system theme", "dark", "dark"],
    ["dark", "Use system theme", "Switch to light theme", "system", "light"],
  ] as const)("from %s cycles to the next theme", (theme, label, nextLabel, nextTheme, resolvedMode) => {
    render(
      <ThemeProvider defaultTheme={theme}>
        <ThemeToggle />
      </ThemeProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: label }));
    expect(screen.getByRole("button", { name: nextLabel })).toBeInTheDocument();
    expect(document.documentElement).toHaveClass(resolvedMode);
    expect(document.documentElement).not.toHaveClass(resolvedMode === "dark" ? "light" : "dark");
    expect(document.documentElement.dataset.mode).toBe(resolvedMode);
    expect(localStorage.getItem("theme")).toBe(nextTheme);
  });

  it("honors a fixed accessible label", () => {
    render(
      <ThemeProvider defaultTheme="system">
        <ThemeToggle aria-label="Toggle theme" />
      </ThemeProvider>,
    );
    expect(screen.getByRole("button", { name: "Toggle theme" })).toBeInTheDocument();
  });
});
