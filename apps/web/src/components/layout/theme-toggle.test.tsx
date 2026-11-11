import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ThemeProvider } from "@nocoo/basalt";
import { ThemeToggle } from "@nocoo/basalt/components/theme-toggle";

describe("theme toggle", () => {
  it.each([
    ["system", "Switch to light theme"],
    ["light", "Switch to dark theme"],
    ["dark", "Use system theme"],
  ] as const)("from %s shows %s", (theme, label) => {
    const view = render(
      <ThemeProvider defaultTheme={theme}>
        <ThemeToggle />
      </ThemeProvider>,
    );
    expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: label }));
    view.unmount();
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
