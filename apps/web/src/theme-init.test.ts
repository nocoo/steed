import { runInNewContext } from "node:vm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import html from "../index.html?raw";

const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
if (!script) throw new Error("Missing theme initialization script");

describe("theme initialization before React loads", () => {
  beforeEach(() => {
    document.documentElement.classList.remove("light", "dark");
    delete document.documentElement.dataset.mode;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each([
    { stored: "light", prefersDark: true, expected: "light" },
    { stored: "dark", prefersDark: false, expected: "dark" },
    { stored: "system", prefersDark: true, expected: "dark" },
    { stored: null, prefersDark: false, expected: "light" },
  ])("resolves $stored with system dark=$prefersDark", ({ stored, prefersDark, expected }) => {
    if (stored !== null) localStorage.setItem("theme", stored);
    runInNewContext(script, {
      localStorage,
      document,
      window: { matchMedia: () => ({ matches: prefersDark }) },
    });
    expect(document.documentElement.dataset.mode).toBe(expected);
    expect(document.documentElement).toHaveClass(expected);
    expect(document.documentElement).not.toHaveClass(expected === "dark" ? "light" : "dark");
  });

  it.each([false, true])("uses system dark=%s when storage is denied", (prefersDark) => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("Storage denied", "SecurityError");
    });
    runInNewContext(script, {
      localStorage,
      document,
      window: { matchMedia: () => ({ matches: prefersDark }) },
    });
    const expected = prefersDark ? "dark" : "light";
    expect(document.documentElement.dataset.mode).toBe(expected);
    expect(document.documentElement).toHaveClass(expected);
  });
});
