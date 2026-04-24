import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MapFilters } from "../map-filters";
import type { MapFilters as MapFiltersType } from "@/viewmodels/use-map-viewmodel";
import type { HostWithStatus } from "@steed/shared";

const mockHosts: HostWithStatus[] = [
  {
    id: "h1",
    name: "Host 1",
    os: "darwin",
    arch: "arm64",
    hostname: "test-host-1",
    status: "online",
    created_at: "2024-01-01T00:00:00Z",
    last_seen_at: "2024-01-01T00:00:00Z",
  },
  {
    id: "h2",
    name: "Host 2",
    os: "linux",
    arch: "x64",
    hostname: "test-host-2",
    status: "offline",
    created_at: "2024-01-01T00:00:00Z",
    last_seen_at: null,
  },
];

const defaultFilters: MapFiltersType = {
  lanes: ["work", "life", "learning", "unassigned"],
  hostId: null,
  orphansOnly: false,
};

describe("MapFilters", () => {
  it("renders all lane checkboxes", () => {
    const onChange = vi.fn();
    render(
      <MapFilters filters={defaultFilters} hosts={[]} onChange={onChange} />
    );

    expect(screen.getByRole("checkbox", { name: "Work" })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Life" })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Learning" })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Unassigned" })).toBeInTheDocument();
  });

  it("toggles lane off when clicked", () => {
    const onChange = vi.fn();
    render(
      <MapFilters filters={defaultFilters} hosts={[]} onChange={onChange} />
    );

    fireEvent.click(screen.getByRole("checkbox", { name: "Work" }));
    expect(onChange).toHaveBeenCalledWith({
      ...defaultFilters,
      lanes: ["life", "learning", "unassigned"],
    });
  });

  it("toggles lane on when clicked", () => {
    const onChange = vi.fn();
    const filtersWithoutWork = { ...defaultFilters, lanes: ["life", "learning", "unassigned"] };
    render(
      <MapFilters filters={filtersWithoutWork} hosts={[]} onChange={onChange} />
    );

    fireEvent.click(screen.getByRole("checkbox", { name: "Work" }));
    expect(onChange).toHaveBeenCalledWith({
      ...filtersWithoutWork,
      lanes: ["life", "learning", "unassigned", "work"],
    });
  });

  it("renders host select with options", () => {
    const onChange = vi.fn();
    render(
      <MapFilters filters={defaultFilters} hosts={mockHosts} onChange={onChange} />
    );

    const select = screen.getByRole("combobox", { name: "Host filter" });
    expect(select).toBeInTheDocument();
    expect(screen.getByText("All hosts")).toBeInTheDocument();
    expect(screen.getByText("Host 1")).toBeInTheDocument();
    expect(screen.getByText("Host 2")).toBeInTheDocument();
  });

  it("calls onChange when host is selected", () => {
    const onChange = vi.fn();
    render(
      <MapFilters filters={defaultFilters} hosts={mockHosts} onChange={onChange} />
    );

    fireEvent.change(screen.getByRole("combobox", { name: "Host filter" }), {
      target: { value: "h1" },
    });
    expect(onChange).toHaveBeenCalledWith({
      ...defaultFilters,
      hostId: "h1",
    });
  });

  it("calls onChange when host is cleared", () => {
    const onChange = vi.fn();
    const filtersWithHost = { ...defaultFilters, hostId: "h1" };
    render(
      <MapFilters filters={filtersWithHost} hosts={mockHosts} onChange={onChange} />
    );

    fireEvent.change(screen.getByRole("combobox", { name: "Host filter" }), {
      target: { value: "" },
    });
    expect(onChange).toHaveBeenCalledWith({
      ...filtersWithHost,
      hostId: null,
    });
  });

  it("renders orphans only checkbox", () => {
    const onChange = vi.fn();
    render(
      <MapFilters filters={defaultFilters} hosts={[]} onChange={onChange} />
    );

    expect(screen.getByRole("checkbox", { name: "Orphans only" })).toBeInTheDocument();
  });

  it("toggles orphans only", () => {
    const onChange = vi.fn();
    render(
      <MapFilters filters={defaultFilters} hosts={[]} onChange={onChange} />
    );

    fireEvent.click(screen.getByRole("checkbox", { name: "Orphans only" }));
    expect(onChange).toHaveBeenCalledWith({
      ...defaultFilters,
      orphansOnly: true,
    });
  });
});
