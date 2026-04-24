import { Handle, Position } from "reactflow";
import { Server, ServerOff } from "lucide-react";
import { cn } from "@/lib/utils";
import type { HostNodeData } from "@/lib/map-data";

interface Props {
  data: HostNodeData;
}

export function HostNode({ data }: Props) {
  const online = data.raw.status === "online";
  return (
    <div
      role="group"
      aria-label={`Host ${data.label}`}
      className={cn(
        "w-[220px] rounded-lg border bg-card p-3 shadow-sm transition-opacity",
        data.orphan && "opacity-60"
      )}
    >
      <Handle type="source" position={Position.Right} className="!bg-slate-400" />
      <div className="flex items-center gap-2">
        {online ? (
          <Server className="h-4 w-4 text-green-600" />
        ) : (
          <ServerOff className="h-4 w-4 text-slate-400" />
        )}
        <span className="truncate text-sm font-medium">{data.label}</span>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        {online ? "online" : "offline"}
        {data.orphan ? " · no agents" : ""}
      </p>
    </div>
  );
}
