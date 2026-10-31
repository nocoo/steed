import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ThemeToggle } from "./theme-toggle";

const state = vi.hoisted(() => ({ theme: "system", setTheme: vi.fn() }));
vi.mock("@nocoo/basalt/providers/theme", () => ({ useTheme: () => state }));

describe("theme toggle", () => {
  it.each([["system", "light"], ["light", "dark"], ["dark", "system"]])("cycles %s to %s", (theme, next) => {
    state.theme = theme!;
    state.setTheme.mockClear();
    const view = render(<ThemeToggle aria-label="Theme" />);
    fireEvent.click(screen.getByRole("button", { name: "Theme" }));
    expect(state.setTheme).toHaveBeenCalledWith(next);
    view.unmount();
  });
  it("provides a default accessible label", () => {
    state.theme = "system";
    render(<ThemeToggle />);
    expect(screen.getByRole("button", { name: "Toggle theme" })).toBeInTheDocument();
  });
});
