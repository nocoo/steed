import { LANE_COLORS, LANE_ORDER, type LaneKey } from "@/lib/map-data";
import { cn } from "@/lib/utils";

const LABEL: Record<LaneKey, string> = {
  work: "Work",
  life: "Life",
  learning: "Learning",
  unassigned: "Unassigned",
};

export function MapLegend() {
  return (
    <div
      role="list"
      aria-label="Lane color legend"
      className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground"
    >
      {LANE_ORDER.map((lane) => (
        <span key={lane} role="listitem" className="flex items-center gap-1.5">
          <span
            aria-hidden
            className={cn("inline-block h-3 w-3 rounded-sm", LANE_COLORS[lane].bg)}
          />
          {LABEL[lane]}
        </span>
      ))}
    </div>
  );
}
