"use client";

import { Handle, Position } from "reactflow";
import { Bot } from "lucide-react";
import { cn } from "@/lib/utils";
import type { AgentNodeData } from "@/lib/map-data";
import { LANE_COLORS } from "@/lib/map-data";

interface Props {
  data: AgentNodeData;
}

const STATUS_DOT: Record<string, string> = {
  running: "bg-green-500",
  stopped: "bg-slate-400",
  missing: "bg-red-500",
};

export function AgentNode({ data }: Props) {
  const lane = data.laneKeys[0] ?? "unassigned";
  const colors = LANE_COLORS[lane];
  return (
    <div
      role="group"
      aria-label={`Agent ${data.label}`}
      className={cn(
        "relative w-[220px] overflow-hidden rounded-lg border bg-card pl-3 pr-3 py-3 shadow-sm transition-opacity",
        data.orphan && "opacity-60"
      )}
    >
      <Handle type="target" position={Position.Left} className="!bg-slate-400" />
      <Handle type="source" position={Position.Right} className="!bg-slate-400" />
      <span
        aria-hidden
        className={cn("absolute left-0 top-0 h-full w-1.5", colors.bg)}
      />
      <div className="flex items-center gap-2 pl-1">
        <Bot className={cn("h-4 w-4", colors.text)} />
        <span className="truncate text-sm font-medium">{data.label}</span>
        <span
          aria-hidden
          className={cn(
            "ml-auto h-2 w-2 rounded-full",
            STATUS_DOT[data.raw.status] ?? "bg-slate-400"
          )}
        />
      </div>
      <p className="mt-1 truncate pl-1 text-xs text-muted-foreground">
        {data.raw.runtime_app ?? "—"}
        {data.orphan ? " · unbound" : ""}
      </p>
    </div>
  );
}
