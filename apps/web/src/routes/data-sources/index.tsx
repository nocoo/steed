import { Link } from "react-router";
import { AlertCircle, Database, Terminal, Plug } from "lucide-react";
import { Badge, Button, LayerCard } from "@nocoo/basalt";
import { PageHeader } from "@nocoo/basalt/components/page-header";
import { useDataSourcesViewModel } from "@/viewmodels/use-data-sources-viewmodel";
import type {
  DataSourceListItem,
  DataSourceType,
  DataSourceAuthStatus,
  DataSourceStatus,
} from "@steed/shared";

export function DataSourcesPage() {
  const { dataSources, loading, error, hasMore, loadMore } =
    useDataSourcesViewModel();

  if (error) {
    return (
      <div className="space-y-8">
        <PageHeader
          title="Data Sources"
          description="Discovered external resources (CLIs, MCP services, platforms)"
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
        title="Data Sources"
        description="Discovered external resources (CLIs, MCP services, platforms)"
      />

      <LayerCard>
        <LayerCard.Header>
          <div>
            <p className="font-semibold text-basalt-foreground">
              All Data Sources
            </p>
            <p className="text-sm text-basalt-muted-foreground">
              {loading && dataSources.length === 0
                ? "Loading data sources..."
                : `${dataSources.length} data source${dataSources.length === 1 ? "" : "s"} discovered`}
            </p>
          </div>
        </LayerCard.Header>
        {loading && dataSources.length === 0 ? (
          <LayerCard.Loading label="Loading data sources" />
        ) : dataSources.length === 0 ? (
          <LayerCard.Empty
            title="No data sources discovered yet"
            description="Make sure hosts are scanning for resources."
          />
        ) : (
          <LayerCard.Well>
            <div className="space-y-4">
              {dataSources.map((ds) => (
                <DataSourceRow key={ds.id} dataSource={ds} />
              ))}
              {hasMore ? (
                <div className="pt-4 text-center">
                  <Button
                    variant="outline"
                    onClick={loadMore}
                    disabled={loading}
                  >
                    {loading ? "Loading..." : "Load More"}
                  </Button>
                </div>
              ) : null}
            </div>
          </LayerCard.Well>
        )}
      </LayerCard>
    </div>
  );
}

function DataSourceRow({ dataSource }: { dataSource: DataSourceListItem }) {
  const lastSeen = dataSource.last_seen_at
    ? new Date(dataSource.last_seen_at).toLocaleString()
    : "Never";

  return (
    <Link
      to={`/data-sources/${dataSource.id}`}
      className="flex items-center justify-between rounded-lg p-4 ring-1 ring-basalt-border/40 transition-colors hover:bg-basalt-accent"
    >
      <div className="flex items-center gap-4">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-basalt-muted">
          <TypeIcon type={dataSource.type} />
        </div>
        <div>
          <p className="font-medium">{dataSource.name}</p>
          <p className="text-sm text-basalt-muted-foreground">
            {formatType(dataSource.type)}
            {dataSource.version ? ` v${dataSource.version}` : ""} &middot; Last
            seen: {lastSeen}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <AuthStatusBadge status={dataSource.auth_status} />
        <StatusBadge status={dataSource.status} />
      </div>
    </Link>
  );
}

function TypeIcon({ type }: { type: DataSourceType }) {
  switch (type) {
    case "personal_cli":
      return <Terminal className="h-5 w-5 text-basalt-muted-foreground" />;
    case "third_party_cli":
      return <Database className="h-5 w-5 text-basalt-muted-foreground" />;
    case "mcp":
      return <Plug className="h-5 w-5 text-basalt-muted-foreground" />;
    default:
      return <Database className="h-5 w-5 text-basalt-muted-foreground" />;
  }
}

function formatType(type: DataSourceType): string {
  const labels: Record<DataSourceType, string> = {
    personal_cli: "Personal CLI",
    third_party_cli: "Third-party CLI",
    mcp: "MCP Service",
  };
  return labels[type] ?? type;
}

function AuthStatusBadge({ status }: { status: DataSourceAuthStatus }) {
  const variants: Record<
    DataSourceAuthStatus,
    "success" | "secondary" | "outline"
  > = {
    authenticated: "success",
    unauthenticated: "secondary",
    unknown: "outline",
  };
  const labels: Record<DataSourceAuthStatus, string> = {
    authenticated: "Authed",
    unauthenticated: "No Auth",
    unknown: "Unknown",
  };
  return <Badge variant={variants[status]}>{labels[status]}</Badge>;
}

function StatusBadge({ status }: { status: DataSourceStatus }) {
  const variants: Record<DataSourceStatus, "success" | "warning"> = {
    active: "success",
    missing: "warning",
  };
  return <Badge variant={variants[status]}>{status}</Badge>;
}
