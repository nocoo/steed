import { AlertCircle, Server } from "lucide-react";
import { Badge, LayerCard } from "@nocoo/basalt";
import { PageHeader } from "@nocoo/basalt/components/page-header";
import { useHostsViewModel } from "@/viewmodels/use-hosts-viewmodel";
import type { HostWithStatus } from "@steed/shared";

export function HostsPage() {
  const { hosts, loading, error } = useHostsViewModel();

  if (error) {
    return (
      <div className="space-y-8">
        <PageHeader
          title="Hosts"
          description="Connected machines running the host service"
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
        title="Hosts"
        description="Connected machines running the host service"
      />

      <LayerCard>
        <LayerCard.Header>
          <div>
            <p className="font-semibold text-basalt-foreground">All Hosts</p>
            <p className="text-sm text-basalt-muted-foreground">
              {loading
                ? "Loading hosts..."
                : `${hosts.length} host${hosts.length === 1 ? "" : "s"} registered`}
            </p>
          </div>
        </LayerCard.Header>
        {loading ? (
          <LayerCard.Loading label="Loading hosts" />
        ) : hosts.length === 0 ? (
          <LayerCard.Empty
            title="No hosts registered yet"
            description="Install the CLI on a machine to get started."
          />
        ) : (
          <LayerCard.Well>
            <div className="space-y-4">
              {hosts.map((host) => (
                <HostRow key={host.id} host={host} />
              ))}
            </div>
          </LayerCard.Well>
        )}
      </LayerCard>
    </div>
  );
}

function HostRow({ host }: { host: HostWithStatus }) {
  const lastSeen = host.last_seen_at
    ? new Date(host.last_seen_at).toLocaleString()
    : "Never";

  return (
    <div className="flex items-center justify-between rounded-lg ring-1 ring-basalt-border/40 p-4">
      <div className="flex items-center gap-4">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-basalt-muted">
          <Server className="h-5 w-5 text-basalt-muted-foreground" />
        </div>
        <div>
          <p className="font-medium">{host.name}</p>
          <p className="text-sm text-basalt-muted-foreground">
            Last seen: {lastSeen}
          </p>
        </div>
      </div>
      <Badge variant={host.status === "online" ? "success" : "secondary"}>
        {host.status}
      </Badge>
    </div>
  );
}
