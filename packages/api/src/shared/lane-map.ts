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

export function buildGraph(input: MapInput): MapGraph {
  const { hosts, agents, data_sources, bindings } = input;

  const agentById = new Map(agents.map((a) => [a.id, a]));

  const hostsWithAgents = new Set<string>();
  const agentsBound = new Set<string>();
  const dsBound = new Set<string>();

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
