import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Server, Bot, Database, Activity, AlertCircle } from "lucide-react";
import { useOverviewViewModel } from "@/viewmodels/use-overview-viewmodel";

export function OverviewPage() {
  const { data, loading, error } = useOverviewViewModel();

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

      <Card>
        <CardHeader>
          <CardTitle>Agents by Lane</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-2">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-4 w-28" />
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
        </CardContent>
      </Card>
    </div>
  );
}

function PageHeader() {
  return (
    <div>
      <h1 className="text-2xl font-semibold text-foreground">Overview</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        AI asset visibility at a glance
      </p>
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
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        {loading ? (
          <>
            <Skeleton className="h-8 w-16 mb-1" />
            <Skeleton className="h-3 w-24" />
          </>
        ) : (
          <>
            <div className="text-2xl font-bold">{value}</div>
            <p className="text-xs text-muted-foreground">{description}</p>
          </>
        )}
      </CardContent>
    </Card>
  );
}

interface LaneStatProps {
  label: string;
  count: number;
}

function LaneStat({ label, count }: LaneStatProps) {
  return (
    <div>
      <p className="text-sm font-medium">{label}</p>
      <p className="text-2xl font-bold">{count}</p>
    </div>
  );
}
