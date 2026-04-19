"use client";

import Link from "next/link";
import { X } from "lucide-react";
import type { MapNode } from "@/lib/map-data";
import { Button } from "@/components/ui/button";

interface Props {
  node: MapNode;
  onClose: () => void;
}

const ROUTE: Record<MapNode["kind"], (id: string) => string | null> = {
  host: () => null, // no host detail page yet
  agent: (id) => `/agents/${id}`,
  data_source: (id) => `/data-sources/${id}`,
};

export function NodeDrawer({ node, onClose }: Props) {
  const detailHref = ROUTE[node.kind](node.id);
  return (
    <aside
      role="complementary"
      aria-label={`Details: ${node.data.label}`}
      className="rounded-lg border bg-card p-4 shadow-sm"
    >
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs uppercase text-muted-foreground">{node.kind}</p>
          <h3 className="mt-0.5 text-base font-semibold">{node.data.label}</h3>
        </div>
        <button
          type="button"
          aria-label="Close drawer"
          onClick={onClose}
          className="text-muted-foreground hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <dl className="mt-3 space-y-1 text-xs">
        {node.kind === "agent" && node.data.kind === "agent" ? (
          <>
            <Row k="match_key" v={node.data.raw.match_key} />
            <Row k="status" v={node.data.raw.status} />
            <Row k="runtime" v={node.data.raw.runtime_app ?? "—"} />
            <Row k="lane" v={node.data.raw.lane_id ?? "unassigned"} />
          </>
        ) : null}
        {node.kind === "data_source" && node.data.kind === "data_source" ? (
          <>
            <Row k="type" v={node.data.raw.type} />
            <Row k="auth" v={node.data.raw.auth_status} />
            <Row k="status" v={node.data.raw.status} />
            <Row k="lanes" v={node.data.raw.lane_ids.join(", ") || "—"} />
          </>
        ) : null}
        {node.kind === "host" && node.data.kind === "host" ? (
          <>
            <Row k="status" v={node.data.raw.status} />
            <Row k="last_seen" v={node.data.raw.last_seen_at ?? "—"} />
          </>
        ) : null}
      </dl>

      {detailHref ? (
        <div className="mt-4">
          <Button asChild variant="outline" size="sm">
            <Link href={detailHref}>Open detail →</Link>
          </Button>
        </div>
      ) : null}
    </aside>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex gap-2">
      <dt className="w-20 text-muted-foreground">{k}</dt>
      <dd className="truncate font-mono">{v}</dd>
    </div>
  );
}
