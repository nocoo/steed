import type { MapNode, LaneKey } from "@/lib/map-data";
import { LANE_ORDER } from "@/lib/map-data";

export interface PositionedNode {
  id: string;
  position: { x: number; y: number };
  data: MapNode["data"];
  type: MapNode["kind"];
}

export const COLUMN_X = {
  host: 40,
  agent: 360,
  data_source: 720,
} as const;

export const NODE_WIDTH = 220;
export const NODE_VERTICAL_GAP = 24;
export const NODE_HEIGHT = 84;
export const LANE_GROUP_GAP = 28;

/**
 * Three-column layout: hosts left / agents middle / data_sources right.
 * Within each column, nodes are grouped by lane (in LANE_ORDER) and
 * laid out vertically with consistent spacing.
 */
export function layoutThreeColumn(nodes: MapNode[]): PositionedNode[] {
  const byKind: Record<MapNode["kind"], MapNode[]> = {
    host: [],
    agent: [],
    data_source: [],
  };
  for (const n of nodes) byKind[n.kind].push(n);

  const result: PositionedNode[] = [];
  for (const kind of ["host", "agent", "data_source"] as const) {
    const grouped = groupByLane(byKind[kind]);
    let y = 40;
    for (const lane of LANE_ORDER) {
      const list = grouped[lane];
      if (list.length === 0) continue;
      for (const node of list) {
        result.push({
          id: node.id,
          type: node.kind,
          data: node.data,
          position: { x: COLUMN_X[kind], y },
        });
        y += NODE_HEIGHT + NODE_VERTICAL_GAP;
      }
      y += LANE_GROUP_GAP;
    }
  }
  return result;
}

function groupByLane(nodes: MapNode[]): Record<LaneKey, MapNode[]> {
  const out: Record<LaneKey, MapNode[]> = {
    work: [],
    life: [],
    learning: [],
    unassigned: [],
  };
  for (const node of nodes) {
    // host has no lane → unassigned bucket; others use first lane key
    const lane = node.data.laneKeys[0] ?? "unassigned";
    out[lane].push(node);
  }
  return out;
}
