import type { HostWithStatus } from "@steed/shared";
import { Checkbox } from "@nocoo/basalt";
import { FilterBar } from "@nocoo/basalt/components/filter-bar";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@nocoo/basalt/components/select";
import { ToggleGroup, ToggleGroupItem } from "@nocoo/basalt/components/toggle-group";
import { LANE_ORDER, type LaneKey } from "@/lib/map-data";
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
  return (
    <FilterBar label="Map filters">
      <ToggleGroup
        type="multiple"
        value={filters.lanes}
        onValueChange={(next) =>
          onChange({ ...filters, lanes: next as LaneKey[] })
        }
        aria-label="Lane filter"
      >
        {LANE_ORDER.map((lane) => (
          <ToggleGroupItem key={lane} value={lane} aria-label={LANE_LABEL[lane]}>
            {LANE_LABEL[lane]}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>

      <Select
        value={filters.hostId ?? "all"}
        onValueChange={(value) =>
          onChange({ ...filters, hostId: value === "all" ? null : value })
        }
      >
        <SelectTrigger size="sm" aria-label="Host filter" className="w-40">
          <SelectValue placeholder="All hosts" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All hosts</SelectItem>
          {hosts.map((h) => (
            <SelectItem key={h.id} value={h.id}>
              {h.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <label className="flex items-center gap-2 text-xs">
        <Checkbox
          size="sm"
          checked={filters.orphansOnly}
          onCheckedChange={(checked) =>
            onChange({ ...filters, orphansOnly: checked === true })
          }
          aria-label="Orphans only"
        />
        <span>Orphans only</span>
      </label>
    </FilterBar>
  );
}
