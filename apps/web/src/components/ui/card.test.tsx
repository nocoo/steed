import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from "./card";

describe("Card", () => {
  it("renders card with children", () => {
    render(<Card>Card content</Card>);
    expect(screen.getByText("Card content")).toBeInTheDocument();
  });

  it("renders with base card classes", () => {
    render(<Card data-testid="card">Test</Card>);
    expect(screen.getByTestId("card")).toBeInTheDocument();
  });

  it("accepts custom className", () => {
    render(<Card className="custom-class" data-testid="card">Test</Card>);
    const card = screen.getByTestId("card");
    expect(card.className).toContain("custom-class");
  });
});

describe("CardHeader", () => {
  it("renders header with children", () => {
    render(<CardHeader>Header</CardHeader>);
    expect(screen.getByText("Header")).toBeInTheDocument();
  });

  it("accepts custom className", () => {
    render(<CardHeader className="test-class" data-testid="header">Test</CardHeader>);
    expect(screen.getByTestId("header").className).toContain("test-class");
  });
});

describe("CardTitle", () => {
  it("renders title with children", () => {
    render(<CardTitle>Title</CardTitle>);
    expect(screen.getByText("Title")).toBeInTheDocument();
  });

  it("accepts custom className", () => {
    render(<CardTitle className="test-class" data-testid="title">Test</CardTitle>);
    expect(screen.getByTestId("title").className).toContain("test-class");
  });
});

describe("CardDescription", () => {
  it("renders description with children", () => {
    render(<CardDescription>Description</CardDescription>);
    expect(screen.getByText("Description")).toBeInTheDocument();
  });

  it("accepts custom className", () => {
    render(<CardDescription className="test-class" data-testid="desc">Test</CardDescription>);
    expect(screen.getByTestId("desc").className).toContain("test-class");
  });
});

describe("CardContent", () => {
  it("renders content with children", () => {
    render(<CardContent>Content</CardContent>);
    expect(screen.getByText("Content")).toBeInTheDocument();
  });

  it("accepts custom className", () => {
    render(<CardContent className="test-class" data-testid="content">Test</CardContent>);
    expect(screen.getByTestId("content").className).toContain("test-class");
  });
});

describe("CardFooter", () => {
  it("renders footer with children", () => {
    render(<CardFooter>Footer</CardFooter>);
    expect(screen.getByText("Footer")).toBeInTheDocument();
  });

  it("accepts custom className", () => {
    render(<CardFooter className="test-class" data-testid="footer">Test</CardFooter>);
    expect(screen.getByTestId("footer").className).toContain("test-class");
  });
});
