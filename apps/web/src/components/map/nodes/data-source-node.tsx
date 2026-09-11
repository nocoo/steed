import { Handle, Position } from "reactflow";
import { Database } from "lucide-react";
import { LayerCard } from "@nocoo/basalt";
import { cn } from "@/lib/utils";
import type { DataSourceNodeData } from "@/lib/map-data";
import { LANE_COLORS } from "@/lib/map-data";

interface Props {
  data: DataSourceNodeData;
}

export function DataSourceNode({ data }: Props) {
  return (
    <LayerCard
      role="group"
      aria-label={`Data Source ${data.label}`}
      padding="sm"
      className={cn(
        "relative w-[220px] transition-opacity",
        data.orphan && "opacity-60"
      )}
    >
      <Handle type="target" position={Position.Left} className="!bg-slate-400" />
      <span aria-hidden className="absolute left-0 top-0 flex h-full w-1.5 flex-col">
        {data.laneKeys.map((lane) => (
          <span key={lane} className={cn("flex-1", LANE_COLORS[lane].bg)} />
        ))}
      </span>
      <div className="flex items-center gap-2 pl-1">
        <Database className="h-4 w-4 text-basalt-muted-foreground" />
        <span className="truncate text-sm font-medium">{data.label}</span>
      </div>
      <p className="mt-1 truncate pl-1 text-xs text-basalt-muted-foreground">
        {data.raw.type} · {data.raw.auth_status}
        {data.orphan ? " · unbound" : ""}
      </p>
    </LayerCard>
  );
}
