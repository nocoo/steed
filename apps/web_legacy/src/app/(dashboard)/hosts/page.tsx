"use client";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertCircle, Server } from "lucide-react";
import { useHostsViewModel } from "@/viewmodels/use-hosts-viewmodel";
import type { HostWithStatus } from "@steed/shared";

export default function HostsPage() {
  const { hosts, loading, error } = useHostsViewModel();

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
          <CardTitle>All Hosts</CardTitle>
          <CardDescription>
            {loading
              ? "Loading hosts..."
              : `${hosts.length} host${hosts.length === 1 ? "" : "s"} registered`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-4">
              {[1, 2, 3].map((i) => (
                <HostRowSkeleton key={i} />
              ))}
            </div>
          ) : hosts.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">
              No hosts registered yet. Install the CLI on a machine to get
              started.
            </p>
          ) : (
            <div className="space-y-4">
              {hosts.map((host) => (
                <HostRow key={host.id} host={host} />
              ))}
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
      <h1 className="text-2xl font-semibold text-foreground">Hosts</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Connected machines running the host service
      </p>
    </div>
  );
}

interface HostRowProps {
  host: HostWithStatus;
}

function HostRow({ host }: HostRowProps) {
  const lastSeen = host.last_seen_at
    ? new Date(host.last_seen_at).toLocaleString()
    : "Never";

  return (
    <div className="flex items-center justify-between rounded-lg border p-4">
      <div className="flex items-center gap-4">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
          <Server className="h-5 w-5 text-muted-foreground" />
        </div>
        <div>
          <p className="font-medium">{host.name}</p>
          <p className="text-sm text-muted-foreground">Last seen: {lastSeen}</p>
        </div>
      </div>
      <Badge variant={host.status === "online" ? "success" : "secondary"}>
        {host.status}
      </Badge>
    </div>
  );
}

function HostRowSkeleton() {
  return (
    <div className="flex items-center justify-between rounded-lg border p-4">
      <div className="flex items-center gap-4">
        <Skeleton className="h-10 w-10 rounded-lg" />
        <div className="space-y-2">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-3 w-48" />
        </div>
      </div>
      <Skeleton className="h-6 w-16" />
    </div>
  );
}
