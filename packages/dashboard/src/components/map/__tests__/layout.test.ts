import { describe, it, expect } from "vitest";
import type { MapNode } from "@/lib/map-data";
import {
  COLUMN_X,
  layoutThreeColumn,
  NODE_HEIGHT,
  NODE_VERTICAL_GAP,
  LANE_GROUP_GAP,
} from "@/components/map/layout";

const node = (
  id: string,
  kind: MapNode["kind"],
  laneKey: "work" | "life" | "learning" | "unassigned"
): MapNode =>
  ({
    id,
    kind,
    data: {
      kind,
      label: id,
      laneKeys: [laneKey],
      orphan: false,
      // raw is required by union but unused by layout
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      raw: { id } as any,
    },
  }) as MapNode;

describe("layoutThreeColumn", () => {
  it("returns empty array for empty input", () => {
    expect(layoutThreeColumn([])).toEqual([]);
  });

  it("places hosts/agents/data_sources in distinct columns", () => {
    const nodes: MapNode[] = [
      node("h1", "host", "unassigned"),
      node("a1", "agent", "work"),
      node("d1", "data_source", "work"),
    ];
    const out = layoutThreeColumn(nodes);
    const byId = Object.fromEntries(out.map((n) => [n.id, n]));
    expect(byId.h1.position.x).toBe(COLUMN_X.host);
    expect(byId.a1.position.x).toBe(COLUMN_X.agent);
    expect(byId.d1.position.x).toBe(COLUMN_X.data_source);
  });

  it("groups same-column nodes by lane order (work before life)", () => {
    const nodes: MapNode[] = [
      node("a_life", "agent", "life"),
      node("a_work", "agent", "work"),
    ];
    const out = layoutThreeColumn(nodes);
    const work = out.find((n) => n.id === "a_work");
    const life = out.find((n) => n.id === "a_life");
    expect(work?.position.y).toBeLessThan(life?.position.y ?? Infinity);
  });

  it("vertical spacing between same-lane nodes equals NODE_HEIGHT + gap", () => {
    const nodes: MapNode[] = [
      node("a1", "agent", "work"),
      node("a2", "agent", "work"),
    ];
    const out = layoutThreeColumn(nodes);
    const a1 = out.find((n) => n.id === "a1");
    const a2 = out.find((n) => n.id === "a2");
    expect((a2?.position.y ?? 0) - (a1?.position.y ?? 0)).toBe(
      NODE_HEIGHT + NODE_VERTICAL_GAP
    );
  });

  it("inserts LANE_GROUP_GAP between lane groups", () => {
    const nodes: MapNode[] = [
      node("a_w", "agent", "work"),
      node("a_l", "agent", "life"),
    ];
    const out = layoutThreeColumn(nodes);
    const work = out.find((n) => n.id === "a_w");
    const life = out.find((n) => n.id === "a_l");
    expect((life?.position.y ?? 0) - (work?.position.y ?? 0)).toBe(
      NODE_HEIGHT + NODE_VERTICAL_GAP + LANE_GROUP_GAP
    );
  });

  it("preserves node data on positioned output", () => {
    const nodes: MapNode[] = [node("h1", "host", "unassigned")];
    const [out] = layoutThreeColumn(nodes);
    expect(out.type).toBe("host");
    expect(out.data.label).toBe("h1");
  });
});
