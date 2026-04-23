import type {
  AgentListItem,
  Binding,
  DataSourceWithLanes,
  HostWithStatus,
  Lane,
} from "@steed/shared";

export type LaneKey = "work" | "life" | "learning" | "unassigned";

export const LANE_ORDER: LaneKey[] = ["work", "life", "learning", "unassigned"];

const LANE_ID_TO_KEY: Record<string, LaneKey> = {
  lane_work: "work",
  lane_life: "life",
  lane_learning: "learning",
};

export function laneIdToKey(laneId: string | null | undefined): LaneKey {
  if (!laneId) return "unassigned";
  return LANE_ID_TO_KEY[laneId] ?? "unassigned";
}

export type MapNodeKind = "host" | "agent" | "data_source";

export interface HostNodeData {
  kind: "host";
  label: string;
  laneKeys: LaneKey[];
  orphan: boolean;
  raw: HostWithStatus;
}

export interface AgentNodeData {
  kind: "agent";
  label: string;
  laneKeys: LaneKey[];
  orphan: boolean;
  raw: AgentListItem;
}

export interface DataSourceNodeData {
  kind: "data_source";
  label: string;
  laneKeys: LaneKey[];
  orphan: boolean;
  raw: DataSourceWithLanes;
}

export type MapNodeData = HostNodeData | AgentNodeData | DataSourceNodeData;

export interface MapNode {
  id: string;
  kind: MapNodeKind;
  data: MapNodeData;
}

export interface MapEdge {
  id: string;
  source: string;
  target: string;
  kind: "host_agent" | "agent_ds";
  laneKey: LaneKey;
}

export interface MapGraph {
  nodes: MapNode[];
  edges: MapEdge[];
}

export interface MapInput {
  hosts: HostWithStatus[];
  agents: AgentListItem[];
  data_sources: DataSourceWithLanes[];
  bindings: Binding[];
  lanes?: Lane[];
}

/**
 * Pure transform: payload from /api/map → topological graph.
 *
 * - host_agent edges: implicit from agent.host_id (every agent → one host)
 * - agent_ds edges: from bindings[]; colored by agent's lane
 * - orphan flags:
 *    host:   no agent attached
 *    agent:  no binding to any DS
 *    ds:     no binding from any agent
 */
export function buildGraph(input: MapInput): MapGraph {
  const { hosts, agents, data_sources, bindings } = input;

  const agentById = new Map(agents.map((a) => [a.id, a]));

  // Track which hosts/agents/ds participate in at least one edge
  const hostsWithAgents = new Set<string>();
  const agentsBound = new Set<string>();
  const dsBound = new Set<string>();

  // host_agent edges
  const hostAgentEdges: MapEdge[] = [];
  for (const agent of agents) {
    hostsWithAgents.add(agent.host_id);
    hostAgentEdges.push({
      id: `e:host_agent:${agent.host_id}->${agent.id}`,
      source: agent.host_id,
      target: agent.id,
      kind: "host_agent",
      laneKey: laneIdToKey(agent.lane_id),
    });
  }

  // agent_ds edges (skip dangling bindings whose agent is missing from list)
  const agentDsEdges: MapEdge[] = [];
  for (const b of bindings) {
    const agent = agentById.get(b.agent_id);
    if (!agent) continue;
    agentsBound.add(b.agent_id);
    dsBound.add(b.data_source_id);
    agentDsEdges.push({
      id: `e:agent_ds:${b.agent_id}->${b.data_source_id}`,
      source: b.agent_id,
      target: b.data_source_id,
      kind: "agent_ds",
      laneKey: laneIdToKey(agent.lane_id),
    });
  }

  const nodes: MapNode[] = [
    ...hosts.map<MapNode>((h) => ({
      id: h.id,
      kind: "host",
      data: {
        kind: "host",
        label: h.name,
        laneKeys: [],
        orphan: !hostsWithAgents.has(h.id),
        raw: h,
      },
    })),
    ...agents.map<MapNode>((a) => ({
      id: a.id,
      kind: "agent",
      data: {
        kind: "agent",
        label: a.nickname ?? a.match_key,
        laneKeys: [laneIdToKey(a.lane_id)],
        orphan: !agentsBound.has(a.id),
        raw: a,
      },
    })),
    ...data_sources.map<MapNode>((d) => {
      const laneKeys =
        d.lane_ids.length > 0
          ? d.lane_ids.map(laneIdToKey)
          : (["unassigned"] as LaneKey[]);
      return {
        id: d.id,
        kind: "data_source",
        data: {
          kind: "data_source",
          label: d.name,
          laneKeys,
          orphan: !dsBound.has(d.id),
          raw: d,
        },
      };
    }),
  ];

  return {
    nodes,
    edges: [...hostAgentEdges, ...agentDsEdges],
  };
}

/** Lane Tailwind color map — matches LaneChips palette. */
export const LANE_COLORS: Record<LaneKey, { bg: string; border: string; stroke: string; text: string }> = {
  work: {
    bg: "bg-blue-100",
    border: "border-blue-500",
    stroke: "#3b82f6",
    text: "text-blue-700",
  },
  life: {
    bg: "bg-green-100",
    border: "border-green-500",
    stroke: "#22c55e",
    text: "text-green-700",
  },
  learning: {
    bg: "bg-amber-100",
    border: "border-amber-500",
    stroke: "#f59e0b",
    text: "text-amber-700",
  },
  unassigned: {
    bg: "bg-slate-100",
    border: "border-slate-400",
    stroke: "#94a3b8",
    text: "text-slate-700",
  },
};
