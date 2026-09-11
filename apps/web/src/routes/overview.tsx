import { AlertCircle, Server, Bot, Database, Activity } from "lucide-react";
import { LayerCard } from "@nocoo/basalt";
import { PageHeader } from "@nocoo/basalt/components/page-header";
import { SectionRule } from "@nocoo/basalt/components/section-rule";
import { SkeletonLine } from "@nocoo/basalt/components/skeleton-line";
import { useOverviewViewModel } from "@/viewmodels/use-overview-viewmodel";

export function OverviewPage() {
  const { data, loading, error } = useOverviewViewModel();

  if (error) {
    return (
      <div className="space-y-8">
        <PageHeader
          title="Overview"
          description="AI asset visibility at a glance"
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
        title="Overview"
        description="AI asset visibility at a glance"
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Hosts"
          value={loading ? null : (data?.hosts.total ?? 0)}
          description="Connected machines"
          icon={Server}
          loading={loading}
        />
        <StatCard
          title="Agents"
          value={loading ? null : (data?.agents.total ?? 0)}
          description={
            loading ? "Running agents" : `${data?.agents.running ?? 0} running`
          }
          icon={Bot}
          loading={loading}
        />
        <StatCard
          title="Data Sources"
          value={loading ? null : (data?.data_sources.total ?? 0)}
          description={
            loading
              ? "Discovered resources"
              : `${data?.data_sources.active ?? 0} active`
          }
          icon={Database}
          loading={loading}
        />
        <StatCard
          title="Online"
          value={loading ? null : (data?.hosts.online ?? 0)}
          description={
            loading ? "Active hosts" : `${data?.hosts.offline ?? 0} offline`
          }
          icon={Activity}
          loading={loading}
        />
      </div>

      <SectionRule title="Agents by Lane">
        <LayerCard>
          {loading ? (
            <div className="space-y-2">
              <SkeletonLine />
              <SkeletonLine minWidth={40} maxWidth={60} />
              <SkeletonLine minWidth={50} maxWidth={70} />
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <LaneStat label="Work" count={data?.agents.by_lane.work ?? 0} />
              <LaneStat label="Life" count={data?.agents.by_lane.life ?? 0} />
              <LaneStat
                label="Learning"
                count={data?.agents.by_lane.learning ?? 0}
              />
              <LaneStat
                label="Unassigned"
                count={data?.agents.by_lane.unassigned ?? 0}
              />
            </div>
          )}
        </LayerCard>
      </SectionRule>
    </div>
  );
}

interface StatCardProps {
  title: string;
  value: number | null;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  loading?: boolean;
}

function StatCard({
  title,
  value,
  description,
  icon: Icon,
  loading,
}: StatCardProps) {
  return (
    <LayerCard>
      <div className="flex flex-row items-center justify-between pb-2">
        <p className="text-sm font-medium">{title}</p>
        <Icon className="h-4 w-4 text-basalt-muted-foreground" />
      </div>
      {loading ? (
        <>
          <SkeletonLine className="mb-1 h-8" minWidth={20} maxWidth={30} />
          <SkeletonLine minWidth={30} maxWidth={40} />
        </>
      ) : (
        <>
          <div className="text-2xl font-bold">{value}</div>
          <p className="text-xs text-basalt-muted-foreground">{description}</p>
        </>
      )}
    </LayerCard>
  );
}

function LaneStat({ label, count }: { label: string; count: number }) {
  return (
    <div>
      <p className="text-sm font-medium">{label}</p>
      <p className="text-2xl font-bold">{count}</p>
    </div>
  );
}
