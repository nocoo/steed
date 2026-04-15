"use client";

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
import { AlertCircle, Bot } from "lucide-react";
import { useAgentsViewModel } from "@/viewmodels/use-agents-viewmodel";
import type { AgentListItem, AgentStatus } from "@steed/shared";

export default function AgentsPage() {
  const { agents, loading, error, hasMore, loadMore } = useAgentsViewModel();

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
          <CardTitle>All Agents</CardTitle>
          <CardDescription>
            {loading && agents.length === 0
              ? "Loading agents..."
              : `${agents.length} agent${agents.length === 1 ? "" : "s"} registered`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading && agents.length === 0 ? (
            <div className="space-y-4">
              {[1, 2, 3].map((i) => (
                <AgentRowSkeleton key={i} />
              ))}
            </div>
          ) : agents.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">
              No agents discovered yet. Make sure hosts are reporting snapshots.
            </p>
          ) : (
            <div className="space-y-4">
              {agents.map((agent) => (
                <AgentRow key={agent.id} agent={agent} />
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
      <h1 className="text-2xl font-semibold text-foreground">Agents</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Autonomous agent entities across all hosts
      </p>
    </div>
  );
}

interface AgentRowProps {
  agent: AgentListItem;
}

function AgentRow({ agent }: AgentRowProps) {
  const lastSeen = agent.last_seen_at
    ? new Date(agent.last_seen_at).toLocaleString()
    : "Never";

  return (
    <div className="flex items-center justify-between rounded-lg border p-4">
      <div className="flex items-center gap-4">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
          <Bot className="h-5 w-5 text-muted-foreground" />
        </div>
        <div>
          <p className="font-medium">{agent.nickname ?? agent.match_key}</p>
          <p className="text-sm text-muted-foreground">
            {agent.runtime_app && agent.runtime_version
              ? `${agent.runtime_app} v${agent.runtime_version}`
              : "Unknown runtime"}{" "}
            &middot; Last seen: {lastSeen}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        {agent.lane_id && (
          <Badge variant="outline">{formatLaneId(agent.lane_id)}</Badge>
        )}
        <StatusBadge status={agent.status} />
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: AgentStatus }) {
  const variants: Record<AgentStatus, "success" | "secondary" | "warning"> = {
    running: "success",
    stopped: "secondary",
    missing: "warning",
  };
  return <Badge variant={variants[status]}>{status}</Badge>;
}

function formatLaneId(laneId: string): string {
  // Convert "lane_work" -> "Work"
  return laneId.replace("lane_", "").replace(/^\w/, (c) => c.toUpperCase());
}

function AgentRowSkeleton() {
  return (
    <div className="flex items-center justify-between rounded-lg border p-4">
      <div className="flex items-center gap-4">
        <Skeleton className="h-10 w-10 rounded-lg" />
        <div className="space-y-2">
          <Skeleton className="h-4 w-40" />
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
