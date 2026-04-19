import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { HostWithStatus } from "@steed/shared";
import { MapFilters } from "@/components/map/map-filters";
import { MapLegend } from "@/components/map/map-legend";
import { LANE_ORDER } from "@/lib/map-data";
import type { MapFilters as MapFiltersType } from "@/viewmodels/use-map-viewmodel";

const hosts: HostWithStatus[] = [
  {
    id: "h1",
    name: "host_a",
    api_key_hash: "x",
    created_at: "",
    last_seen_at: null,
    status: "online",
  },
];

const baseFilters: MapFiltersType = {
  lanes: [...LANE_ORDER],
  hostId: null,
  orphansOnly: false,
};

afterEach(() => cleanup());

describe("MapLegend", () => {
  it("renders one legend entry per lane", () => {
    render(<MapLegend />);
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(LANE_ORDER.length);
  });
});

describe("MapFilters", () => {
  it("toggling a lane chip emits the new lane list", () => {
    const onChange = vi.fn();
    render(
      <MapFilters filters={baseFilters} hosts={hosts} onChange={onChange} />
    );
    fireEvent.click(screen.getByLabelText("Work"));
    expect(onChange).toHaveBeenCalledWith({
      ...baseFilters,
      lanes: baseFilters.lanes.filter((l) => l !== "work"),
    });
  });

  it("changing the host select emits new hostId", () => {
    const onChange = vi.fn();
    render(
      <MapFilters filters={baseFilters} hosts={hosts} onChange={onChange} />
    );
    fireEvent.change(screen.getByLabelText("Host filter"), {
      target: { value: "h1" },
    });
    expect(onChange).toHaveBeenCalledWith({ ...baseFilters, hostId: "h1" });
  });

  it("toggling 'orphans only' emits the new flag", () => {
    const onChange = vi.fn();
    render(
      <MapFilters filters={baseFilters} hosts={hosts} onChange={onChange} />
    );
    fireEvent.click(screen.getByLabelText("Orphans only"));
    expect(onChange).toHaveBeenCalledWith({ ...baseFilters, orphansOnly: true });
  });

  it("re-clicking an inactive lane re-enables it", () => {
    const onChange = vi.fn();
    render(
      <MapFilters
        filters={{ ...baseFilters, lanes: ["life", "learning", "unassigned"] }}
        hosts={hosts}
        onChange={onChange}
      />
    );
    fireEvent.click(screen.getByLabelText("Work"));
    expect(onChange).toHaveBeenCalledWith({
      ...baseFilters,
      lanes: ["life", "learning", "unassigned", "work"],
    });
  });
});
