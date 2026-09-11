import { lazy, Suspense, useState } from "react";
import { AlertCircle, Server, Bot, Database, Link2 } from "lucide-react";
import { LayerCard } from "@nocoo/basalt";
import { PageHeader } from "@nocoo/basalt/components/page-header";
import { SkeletonLine } from "@nocoo/basalt/components/skeleton-line";
import { useMapViewModel } from "@/viewmodels/use-map-viewmodel";
import { MapFilters } from "@/components/map/map-filters";
import { MapLegend } from "@/components/map/map-legend";
import { NodeDrawer } from "@/components/map/node-drawer";
import type { MapNode } from "@/lib/map-data";

const LaneMap = lazy(() =>
  import("@/components/map/lane-map").then((m) => ({ default: m.LaneMap }))
);

export function MapPage() {
  const { data, loading, error, filters, setFilters, filteredGraph } =
    useMapViewModel();
  const [selected, setSelected] = useState<MapNode | null>(null);

  if (error) {
    return (
      <div className="space-y-8">
        <PageHeader
          title="Map"
          description="Relationship map of Hosts, Agents, and Data Sources"
        />
        <LayerCard>
          <div className="flex items-center gap-3">
            <AlertCircle className="h-5 w-5 text-basalt-destructive" />
            <p className="text-sm text-basalt-destructive">{error}</p>
          </div>
        </LayerCard>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <PageHeader
        title="Map"
        description="Relationship map of Hosts, Agents, and Data Sources"
        filters={
          <div className="flex w-full flex-wrap items-center justify-between gap-3">
            <MapFilters
              filters={filters}
              hosts={data?.hosts ?? []}
              onChange={setFilters}
            />
            <MapLegend />
          </div>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          title="Hosts"
          value={loading ? null : (data?.hosts.length ?? 0)}
          icon={Server}
          loading={loading}
        />
        <KpiCard
          title="Agents"
          value={loading ? null : (data?.agents.length ?? 0)}
          icon={Bot}
          loading={loading}
        />
        <KpiCard
          title="Data Sources"
          value={loading ? null : (data?.data_sources.length ?? 0)}
          icon={Database}
          loading={loading}
        />
        <KpiCard
          title="Bindings"
          value={loading ? null : (data?.bindings.length ?? 0)}
          icon={Link2}
          loading={loading}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        {loading ? (
          <LayerCard className="h-[640px]">
            <SkeletonLine className="h-full" minWidth={100} maxWidth={100} />
          </LayerCard>
        ) : (
          <Suspense
            fallback={
              <LayerCard className="h-[640px]">
                <SkeletonLine
                  className="h-full"
                  minWidth={100}
                  maxWidth={100}
                />
              </LayerCard>
            }
          >
            <LaneMap graph={filteredGraph} onNodeClick={setSelected} />
          </Suspense>
        )}
        {selected ? (
          <NodeDrawer node={selected} onClose={() => setSelected(null)} />
        ) : null}
      </div>
    </div>
  );
}

function KpiCard({
  title,
  value,
  icon: Icon,
  loading,
}: {
  title: string;
  value: number | null;
  icon: React.ComponentType<{ className?: string }>;
  loading?: boolean;
}) {
  return (
    <LayerCard>
      <div className="flex items-center gap-3">
        <Icon className="h-5 w-5 text-basalt-muted-foreground" />
        <div>
          <p className="text-xs uppercase text-basalt-muted-foreground">{title}</p>
          {loading ? (
            <SkeletonLine className="mt-1 h-6" minWidth={20} maxWidth={30} />
          ) : (
            <p className="text-2xl font-semibold">{value}</p>
          )}
        </div>
      </div>
    </LayerCard>
  );
}
