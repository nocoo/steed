import { Link } from "react-router";
import { X } from "lucide-react";
import { Button, DescriptionList, LayerCard } from "@nocoo/basalt";
import type { MapNode } from "@/lib/map-data";

interface Props {
  node: MapNode;
  onClose: () => void;
}

const ROUTE: Record<MapNode["kind"], (id: string) => string | null> = {
  host: () => null,
  agent: (id) => `/agents/${id}`,
  data_source: (id) => `/data-sources/${id}`,
};

export function NodeDrawer({ node, onClose }: Props) {
  const detailHref = ROUTE[node.kind](node.id);
  return (
    <LayerCard
      role="complementary"
      aria-label={`Details: ${node.data.label}`}
    >
      <LayerCard.Header>
        <div className="flex w-full items-start justify-between">
          <div>
            <p className="text-xs uppercase text-basalt-muted-foreground">
              {node.kind}
            </p>
            <h3 className="mt-0.5 text-base font-semibold">{node.data.label}</h3>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            aria-label="Close drawer"
            onClick={onClose}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      </LayerCard.Header>
      <LayerCard.Body>
        <DescriptionList columns={1}>
          {node.kind === "agent" && node.data.kind === "agent" ? (
            <>
              <DescriptionList.Item term="match_key">
                {node.data.raw.match_key}
              </DescriptionList.Item>
              <DescriptionList.Item term="status">
                {node.data.raw.status}
              </DescriptionList.Item>
              <DescriptionList.Item term="runtime">
                {node.data.raw.runtime_app ?? "—"}
              </DescriptionList.Item>
              <DescriptionList.Item term="lane">
                {node.data.raw.lane_id ?? "unassigned"}
              </DescriptionList.Item>
            </>
          ) : null}
          {node.kind === "data_source" && node.data.kind === "data_source" ? (
            <>
              <DescriptionList.Item term="type">
                {node.data.raw.type}
              </DescriptionList.Item>
              <DescriptionList.Item term="auth">
                {node.data.raw.auth_status}
              </DescriptionList.Item>
              <DescriptionList.Item term="status">
                {node.data.raw.status}
              </DescriptionList.Item>
              <DescriptionList.Item term="lanes">
                {node.data.raw.lane_ids.join(", ") || "—"}
              </DescriptionList.Item>
            </>
          ) : null}
          {node.kind === "host" && node.data.kind === "host" ? (
            <>
              <DescriptionList.Item term="status">
                {node.data.raw.status}
              </DescriptionList.Item>
              <DescriptionList.Item term="last_seen">
                {node.data.raw.last_seen_at ?? "—"}
              </DescriptionList.Item>
            </>
          ) : null}
        </DescriptionList>

        {detailHref ? (
          <div className="mt-4">
            <Button asChild variant="outline" size="sm">
              <Link to={detailHref}>Open detail →</Link>
            </Button>
          </div>
        ) : null}
      </LayerCard.Body>
    </LayerCard>
  );
}
