import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { ThemeToggle } from "./theme-toggle";

describe("ThemeToggle", () => {
  const originalMatchMedia = window.matchMedia;
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
    document.documentElement.classList.remove("dark");
    window.matchMedia = vi.fn().mockReturnValue({ matches: false });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.documentElement.classList.remove("dark");
    window.matchMedia = originalMatchMedia;
  });

  it("renders toggle button", () => {
    render(<ThemeToggle />);
    expect(screen.getByRole("button")).toBeInTheDocument();
  });

  it("defaults to light theme with correct label", () => {
    render(<ThemeToggle />);
    expect(screen.getByRole("button", { name: /switch to dark mode/i })).toBeInTheDocument();
  });

  it("loads dark theme from localStorage", () => {
    localStorageData["theme"] = "dark";
    render(<ThemeToggle />);
    expect(screen.getByRole("button", { name: /switch to light mode/i })).toBeInTheDocument();
  });

  it("uses system preference when no localStorage value", () => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: true });
    render(<ThemeToggle />);
    expect(screen.getByRole("button", { name: /switch to light mode/i })).toBeInTheDocument();
  });

  it("toggles theme on click and updates localStorage", () => {
    render(<ThemeToggle />);

    expect(screen.getByRole("button", { name: /switch to dark mode/i })).toBeInTheDocument();

    act(() => {
      fireEvent.click(screen.getByRole("button"));
    });

    expect(screen.getByRole("button", { name: /switch to light mode/i })).toBeInTheDocument();
    expect(localStorageData["theme"]).toBe("dark");
  });
});
