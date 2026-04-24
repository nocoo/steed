import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MapLegend } from "../map-legend";

describe("MapLegend", () => {
  it("renders all lane labels", () => {
    render(<MapLegend />);

    expect(screen.getByText("Work")).toBeInTheDocument();
    expect(screen.getByText("Life")).toBeInTheDocument();
    expect(screen.getByText("Learning")).toBeInTheDocument();
    expect(screen.getByText("Unassigned")).toBeInTheDocument();
  });

  it("renders with correct aria roles", () => {
    render(<MapLegend />);

    expect(screen.getByRole("list", { name: "Lane color legend" })).toBeInTheDocument();
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(4);
  });
});
