import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Avatar, AvatarFallback } from "./avatar";

describe("Avatar", () => {
  it("renders avatar component", () => {
    render(<Avatar data-testid="avatar" />);
    expect(screen.getByTestId("avatar")).toBeInTheDocument();
  });

  it("accepts custom className", () => {
    render(<Avatar className="custom-class" data-testid="avatar" />);
    const avatar = screen.getByTestId("avatar");
    expect(avatar.className).toContain("custom-class");
  });
});

describe("AvatarFallback", () => {
  it("renders fallback content", () => {
    render(
      <Avatar>
        <AvatarFallback>AB</AvatarFallback>
      </Avatar>
    );
    expect(screen.getByText("AB")).toBeInTheDocument();
  });

  it("accepts custom className", () => {
    render(
      <Avatar>
        <AvatarFallback className="custom-class" data-testid="fallback">AB</AvatarFallback>
      </Avatar>
    );
    const fallback = screen.getByTestId("fallback");
    expect(fallback.className).toContain("custom-class");
  });
});
