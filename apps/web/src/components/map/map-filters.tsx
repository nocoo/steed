import type { HostWithStatus } from "@steed/shared";
import { cn } from "@/lib/utils";
import { LANE_COLORS, LANE_ORDER, type LaneKey } from "@/lib/map-data";
import type { MapFilters } from "@/viewmodels/use-map-viewmodel";

const LANE_LABEL: Record<LaneKey, string> = {
  work: "Work",
  life: "Life",
  learning: "Learning",
  unassigned: "Unassigned",
};

interface Props {
  filters: MapFilters;
  hosts: HostWithStatus[];
  onChange: (next: MapFilters) => void;
}

export function MapFilters({ filters, hosts, onChange }: Props) {
  const toggleLane = (lane: LaneKey) => {
    const next = filters.lanes.includes(lane)
      ? filters.lanes.filter((l) => l !== lane)
      : [...filters.lanes, lane];
    onChange({ ...filters, lanes: next });
  };

  return (
    <div className="flex flex-wrap items-center gap-3" aria-label="Map filters">
      <div role="group" aria-label="Lane filter" className="flex flex-wrap gap-2">
        {LANE_ORDER.map((lane) => {
          const active = filters.lanes.includes(lane);
          return (
            <button
              key={lane}
              type="button"
              role="checkbox"
              aria-checked={active}
              aria-label={LANE_LABEL[lane]}
              onClick={() => toggleLane(lane)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                active
                  ? "border-foreground/30 bg-card text-foreground"
                  : "border-input bg-background text-muted-foreground opacity-60"
              )}
            >
              <span
                aria-hidden
                className={cn("h-2 w-2 rounded-full", LANE_COLORS[lane].bg)}
              />
              {LANE_LABEL[lane]}
            </button>
          );
        })}
      </div>

      <label className="flex items-center gap-2 text-xs">
        <span className="text-muted-foreground">Host</span>
        <select
          aria-label="Host filter"
          value={filters.hostId ?? ""}
          onChange={(e) =>
            onChange({ ...filters, hostId: e.target.value || null })
          }
          className="rounded-md border border-input bg-background px-2 py-1 text-xs"
        >
          <option value="">All hosts</option>
          {hosts.map((h) => (
            <option key={h.id} value={h.id}>
              {h.name}
            </option>
          ))}
        </select>
      </label>

      <label className="flex items-center gap-2 text-xs">
        <input
          type="checkbox"
          aria-label="Orphans only"
          checked={filters.orphansOnly}
          onChange={(e) =>
            onChange({ ...filters, orphansOnly: e.target.checked })
          }
          className="h-3.5 w-3.5"
        />
        <span>Orphans only</span>
      </label>
    </div>
  );
}
