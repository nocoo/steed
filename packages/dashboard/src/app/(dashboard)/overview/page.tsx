import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Server, Bot, Database, Activity } from "lucide-react";

export default function OverviewPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Overview</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          AI asset visibility at a glance
        </p>
      </div>

      {/* Stats cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Hosts"
          value="—"
          description="Connected machines"
          icon={Server}
        />
        <StatCard
          title="Agents"
          value="—"
          description="Running agents"
          icon={Bot}
        />
        <StatCard
          title="Data Sources"
          value="—"
          description="Discovered resources"
          icon={Database}
        />
        <StatCard
          title="Online"
          value="—"
          description="Active hosts"
          icon={Activity}
        />
      </div>

      {/* Placeholder for future content */}
      <Card>
        <CardHeader>
          <CardTitle>Recent Activity</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Activity feed will appear here once hosts are connected.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

interface StatCardProps {
  title: string;
  value: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
}

function StatCard({ title, value, description, icon: Icon }: StatCardProps) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{value}</div>
        <p className="text-xs text-muted-foreground">{description}</p>
      </CardContent>
    </Card>
  );
}
