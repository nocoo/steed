import { lazy, Suspense, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Server, Bot, Database, Link2, AlertCircle } from "lucide-react";
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
      <div className="space-y-6">
        <PageHeader />
        <Card className="border-destructive">
          <CardContent className="flex items-center gap-3 pt-6">
            <AlertCircle className="h-5 w-5 text-destructive" />
            <p className="text-sm text-destructive">{error}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          title="Hosts"
          value={loading ? null : data?.hosts.length ?? 0}
          icon={Server}
          loading={loading}
        />
        <KpiCard
          title="Agents"
          value={loading ? null : data?.agents.length ?? 0}
          icon={Bot}
          loading={loading}
        />
        <KpiCard
          title="Data Sources"
          value={loading ? null : data?.data_sources.length ?? 0}
          icon={Database}
          loading={loading}
        />
        <KpiCard
          title="Bindings"
          value={loading ? null : data?.bindings.length ?? 0}
          icon={Link2}
          loading={loading}
        />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <MapFilters
          filters={filters}
          hosts={data?.hosts ?? []}
          onChange={setFilters}
        />
        <MapLegend />
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        {loading ? (
          <Skeleton className="h-[640px] w-full" />
        ) : (
          <Suspense fallback={<Skeleton className="h-[640px] w-full" />}>
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

function PageHeader() {
  return (
    <div>
      <h1 className="text-2xl font-semibold text-foreground">Map</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Relationship map of Hosts, Agents, and Data Sources
      </p>
    </div>
  );
}

interface KpiCardProps {
  title: string;
  value: number | null;
  icon: React.ComponentType<{ className?: string }>;
  loading?: boolean;
}

function KpiCard({ title, value, icon: Icon, loading }: KpiCardProps) {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 pt-6">
        <Icon className="h-5 w-5 text-muted-foreground" />
        <div>
          <p className="text-xs uppercase text-muted-foreground">{title}</p>
          {loading ? (
            <Skeleton className="mt-1 h-6 w-12" />
          ) : (
            <p className="text-2xl font-semibold">{value}</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
