"use client";

import Link from "next/link";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertCircle, Database, Terminal, Plug } from "lucide-react";
import { useDataSourcesViewModel } from "@/viewmodels/use-data-sources-viewmodel";
import type {
  DataSourceListItem,
  DataSourceType,
  DataSourceAuthStatus,
  DataSourceStatus,
} from "@steed/shared";

export default function DataSourcesPage() {
  const { dataSources, loading, error, hasMore, loadMore } =
    useDataSourcesViewModel();

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

      <Card>
        <CardHeader>
          <CardTitle>All Data Sources</CardTitle>
          <CardDescription>
            {loading && dataSources.length === 0
              ? "Loading data sources..."
              : `${dataSources.length} data source${dataSources.length === 1 ? "" : "s"} discovered`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading && dataSources.length === 0 ? (
            <div className="space-y-4">
              {[1, 2, 3].map((i) => (
                <DataSourceRowSkeleton key={i} />
              ))}
            </div>
          ) : dataSources.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">
              No data sources discovered yet. Make sure hosts are scanning for
              resources.
            </p>
          ) : (
            <div className="space-y-4">
              {dataSources.map((ds) => (
                <DataSourceRow key={ds.id} dataSource={ds} />
              ))}
              {hasMore && (
                <div className="pt-4 text-center">
                  <Button
                    variant="outline"
                    onClick={loadMore}
                    disabled={loading}
                  >
                    {loading ? "Loading..." : "Load More"}
                  </Button>
                </div>
              )}
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
      <h1 className="text-2xl font-semibold text-foreground">Data Sources</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Discovered external resources (CLIs, MCP services, platforms)
      </p>
    </div>
  );
}

interface DataSourceRowProps {
  dataSource: DataSourceListItem;
}

function DataSourceRow({ dataSource }: DataSourceRowProps) {
  const lastSeen = dataSource.last_seen_at
    ? new Date(dataSource.last_seen_at).toLocaleString()
    : "Never";

  return (
    <Link
      href={`/data-sources/${dataSource.id}`}
      className="flex items-center justify-between rounded-lg border p-4 transition-colors hover:bg-accent"
    >
      <div className="flex items-center gap-4">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
          <TypeIcon type={dataSource.type} />
        </div>
        <div>
          <p className="font-medium">{dataSource.name}</p>
          <p className="text-sm text-muted-foreground">
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
      return <Terminal className="h-5 w-5 text-muted-foreground" />;
    case "third_party_cli":
      return <Database className="h-5 w-5 text-muted-foreground" />;
    case "mcp":
      return <Plug className="h-5 w-5 text-muted-foreground" />;
    default:
      return <Database className="h-5 w-5 text-muted-foreground" />;
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
  const variants: Record<DataSourceAuthStatus, "success" | "secondary" | "outline"> = {
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

function DataSourceRowSkeleton() {
  return (
    <div className="flex items-center justify-between rounded-lg border p-4">
      <div className="flex items-center gap-4">
        <Skeleton className="h-10 w-10 rounded-lg" />
        <div className="space-y-2">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-3 w-56" />
        </div>
      </div>
      <div className="flex gap-2">
        <Skeleton className="h-6 w-16" />
        <Skeleton className="h-6 w-16" />
      </div>
    </div>
  );
}
