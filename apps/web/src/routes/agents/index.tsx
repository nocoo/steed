import { Link } from "react-router";
import { AlertCircle, Bot } from "lucide-react";
import { Badge, Button, LayerCard } from "@nocoo/basalt";
import { PageHeader } from "@nocoo/basalt/components/page-header";
import { useAgentsViewModel } from "@/viewmodels/use-agents-viewmodel";
import type { AgentListItem, AgentStatus } from "@steed/shared";

export function AgentsPage() {
  const { agents, loading, error, hasMore, loadMore } = useAgentsViewModel();

  if (error) {
    return (
      <div className="space-y-8">
        <PageHeader
          title="Agents"
          description="Autonomous agent entities across all hosts"
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
        title="Agents"
        description="Autonomous agent entities across all hosts"
      />

      <LayerCard>
        <LayerCard.Header>
          <div>
            <p className="font-semibold text-basalt-foreground">All Agents</p>
            <p className="text-sm text-basalt-muted-foreground">
              {loading && agents.length === 0
                ? "Loading agents..."
                : `${agents.length} agent${agents.length === 1 ? "" : "s"} registered`}
            </p>
          </div>
        </LayerCard.Header>
        {loading && agents.length === 0 ? (
          <LayerCard.Loading label="Loading agents" />
        ) : agents.length === 0 ? (
          <LayerCard.Empty
            title="No agents discovered yet"
            description="Make sure hosts are reporting snapshots."
          />
        ) : (
          <LayerCard.Well>
            <div className="space-y-4">
              {agents.map((agent) => (
                <AgentRow key={agent.id} agent={agent} />
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

function AgentRow({ agent }: { agent: AgentListItem }) {
  const lastSeen = agent.last_seen_at
    ? new Date(agent.last_seen_at).toLocaleString()
    : "Never";

  return (
    <Link
      to={`/agents/${agent.id}`}
      className="flex items-center justify-between rounded-lg p-4 ring-1 ring-basalt-border/40 transition-colors hover:bg-basalt-accent"
    >
      <div className="flex items-center gap-4">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-basalt-muted">
          <Bot className="h-5 w-5 text-basalt-muted-foreground" />
        </div>
        <div>
          <p className="font-medium">{agent.nickname ?? agent.match_key}</p>
          <p className="text-sm text-basalt-muted-foreground">
            {agent.runtime_app && agent.runtime_version
              ? `${agent.runtime_app} v${agent.runtime_version}`
              : "Unknown runtime"}{" "}
            &middot; Last seen: {lastSeen}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        {agent.lane_id ? (
          <Badge variant="outline">{formatLaneId(agent.lane_id)}</Badge>
        ) : null}
        <StatusBadge status={agent.status} />
      </div>
    </Link>
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
  return laneId.replace("lane_", "").replace(/^\w/, (c) => c.toUpperCase());
}
