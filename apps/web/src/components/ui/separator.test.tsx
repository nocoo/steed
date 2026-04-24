import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Separator } from "./separator";

describe("Separator", () => {
  it("renders separator element", () => {
    render(<Separator data-testid="separator" />);
    expect(screen.getByTestId("separator")).toBeInTheDocument();
  });

  it("renders with horizontal orientation by default", () => {
    render(<Separator data-testid="separator" />);
    const separator = screen.getByTestId("separator");
    expect(separator.getAttribute("data-orientation")).toBe("horizontal");
  });

  it("renders with vertical orientation", () => {
    render(<Separator orientation="vertical" data-testid="separator" />);
    const separator = screen.getByTestId("separator");
    expect(separator.getAttribute("data-orientation")).toBe("vertical");
  });

  it("accepts custom className", () => {
    render(<Separator className="custom-class" data-testid="separator" />);
    const separator = screen.getByTestId("separator");
    expect(separator.className).toContain("custom-class");
  });
});
