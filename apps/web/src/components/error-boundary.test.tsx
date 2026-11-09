import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ErrorBoundary } from "./error-boundary";

const flags = { fail: true, message: "boom" };
function Flaky() {
  if (flags.fail) throw new Error(flags.message);
  return <p>healthy</p>;
}

let consoleError: ReturnType<typeof vi.spyOn>;
beforeEach(() => { flags.fail = true; flags.message = "boom"; consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined); });
afterEach(() => consoleError.mockRestore());

describe("ErrorBoundary", () => {
  it("renders children when nothing fails", () => {
    flags.fail = false;
    render(<ErrorBoundary label="Canvas"><Flaky /></ErrorBoundary>);
    expect(screen.getByText("healthy")).toBeInTheDocument();
  });

  it("shows a local fallback and retries", () => {
    render(<div><p>outside</p><ErrorBoundary label="Canvas" className="h-full"><Flaky /></ErrorBoundary></div>);
    expect(screen.getByText("outside")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Canvas hit an error");
    expect(screen.getByRole("alert")).toHaveClass("h-full");
    expect(screen.getByText("boom")).toBeInTheDocument();
    expect(consoleError).toHaveBeenCalledWith("Canvas failed to render", expect.any(Error), expect.anything());
    flags.fail = false;
    fireEvent.click(screen.getByRole("button", { name: /try again/i }));
    expect(screen.getByText("healthy")).toBeInTheDocument();
  });

  it("falls back to the error string and resets when keys change", () => {
    flags.message = "";
    const { rerender } = render(<ErrorBoundary label="Panel" resetKeys={[1]}><Flaky /></ErrorBoundary>);
    expect(screen.getByRole("alert")).toHaveTextContent("Error");
    rerender(<ErrorBoundary label="Panel" resetKeys={[1]}><Flaky /></ErrorBoundary>);
    expect(screen.getByRole("alert")).toBeInTheDocument();
    flags.fail = false;
    rerender(<ErrorBoundary label="Panel" resetKeys={[2]}><Flaky /></ErrorBoundary>);
    expect(screen.getByText("healthy")).toBeInTheDocument();
    rerender(<ErrorBoundary label="Panel"><Flaky /></ErrorBoundary>);
    expect(screen.getByText("healthy")).toBeInTheDocument();
  });
});
