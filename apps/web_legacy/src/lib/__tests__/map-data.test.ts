import { describe, it, expect } from "vitest";
import type {
  AgentListItem,
  Binding,
  DataSourceWithLanes,
  HostWithStatus,
} from "@steed/shared";
import { buildGraph, laneIdToKey } from "@/lib/map-data";

const host = (id: string, name = id): HostWithStatus => ({
  id,
  name,
  api_key_hash: "x",
  created_at: "",
  last_seen_at: null,
  status: "online",
});

const agent = (
  id: string,
  host_id: string,
  lane_id: string | null = null,
  nickname: string | null = null
): AgentListItem => ({
  id,
  host_id,
  match_key: `mk_${id}`,
  nickname,
  role: null,
  lane_id: lane_id as AgentListItem["lane_id"],
  runtime_app: null,
  runtime_version: null,
  status: "running",
  created_at: "",
  last_seen_at: null,
});

const ds = (
  id: string,
  host_id: string,
  lane_ids: string[] = []
): DataSourceWithLanes => ({
  id,
  host_id,
  type: "personal_cli",
  name: id,
  version: null,
  auth_status: "authenticated",
  status: "active",
  metadata: {},
  created_at: "",
  last_seen_at: null,
  lane_ids,
});

const bind = (a: string, d: string): Binding => ({
  agent_id: a,
  data_source_id: d,
  created_at: "",
});

describe("laneIdToKey", () => {
  it("maps known lane ids", () => {
    expect(laneIdToKey("lane_work")).toBe("work");
    expect(laneIdToKey("lane_life")).toBe("life");
    expect(laneIdToKey("lane_learning")).toBe("learning");
  });
  it("falls back to unassigned", () => {
    expect(laneIdToKey(null)).toBe("unassigned");
    expect(laneIdToKey(undefined)).toBe("unassigned");
    expect(laneIdToKey("lane_other")).toBe("unassigned");
  });
});

describe("buildGraph", () => {
  it("returns empty graph for empty input", () => {
    const g = buildGraph({
      hosts: [],
      agents: [],
      data_sources: [],
      bindings: [],
    });
    expect(g.nodes).toEqual([]);
    expect(g.edges).toEqual([]);
  });

  it("marks all-orphan nodes when no edges exist", () => {
    const g = buildGraph({
      hosts: [host("h1")],
      agents: [],
      data_sources: [ds("d1", "h1")],
      bindings: [],
    });
    expect(g.nodes.find((n) => n.id === "h1")?.data.orphan).toBe(true);
    expect(g.nodes.find((n) => n.id === "d1")?.data.orphan).toBe(true);
    expect(g.edges).toEqual([]);
  });

  it("creates host_agent edges from agent.host_id", () => {
    const g = buildGraph({
      hosts: [host("h1")],
      agents: [agent("a1", "h1", "lane_work")],
      data_sources: [],
      bindings: [],
    });
    const e = g.edges.find((e) => e.kind === "host_agent");
    expect(e).toMatchObject({
      source: "h1",
      target: "a1",
      laneKey: "work",
    });
    // host with at least one agent is not orphan
    expect(g.nodes.find((n) => n.id === "h1")?.data.orphan).toBe(false);
    // unbound agent is orphan
    expect(g.nodes.find((n) => n.id === "a1")?.data.orphan).toBe(true);
  });

  it("creates agent_ds edges colored by agent lane", () => {
    const g = buildGraph({
      hosts: [host("h1")],
      agents: [agent("a1", "h1", "lane_life")],
      data_sources: [ds("d1", "h1", ["lane_life"])],
      bindings: [bind("a1", "d1")],
    });
    const e = g.edges.find((e) => e.kind === "agent_ds");
    expect(e).toMatchObject({
      source: "a1",
      target: "d1",
      laneKey: "life",
    });
    expect(g.nodes.find((n) => n.id === "a1")?.data.orphan).toBe(false);
    expect(g.nodes.find((n) => n.id === "d1")?.data.orphan).toBe(false);
  });

  it("skips bindings whose agent is missing from list", () => {
    const g = buildGraph({
      hosts: [host("h1")],
      agents: [],
      data_sources: [ds("d1", "h1")],
      bindings: [bind("ghost", "d1")],
    });
    expect(g.edges).toEqual([]);
    expect(g.nodes.find((n) => n.id === "d1")?.data.orphan).toBe(true);
  });

  it("multi-lane data source carries all lane keys", () => {
    const g = buildGraph({
      hosts: [host("h1")],
      agents: [],
      data_sources: [ds("d1", "h1", ["lane_work", "lane_life"])],
      bindings: [],
    });
    const node = g.nodes.find((n) => n.id === "d1");
    expect(node?.data.laneKeys).toEqual(["work", "life"]);
  });

  it("data source with no lanes defaults to unassigned", () => {
    const g = buildGraph({
      hosts: [host("h1")],
      agents: [],
      data_sources: [ds("d1", "h1", [])],
      bindings: [],
    });
    expect(g.nodes.find((n) => n.id === "d1")?.data.laneKeys).toEqual([
      "unassigned",
    ]);
  });

  it("uses agent nickname when present, falls back to match_key", () => {
    const g = buildGraph({
      hosts: [host("h1")],
      agents: [agent("a1", "h1", null, "hermes:main"), agent("a2", "h1")],
      data_sources: [],
      bindings: [],
    });
    expect(g.nodes.find((n) => n.id === "a1")?.data.label).toBe("hermes:main");
    expect(g.nodes.find((n) => n.id === "a2")?.data.label).toBe("mk_a2");
  });

  it("host with multiple agents creates multiple edges", () => {
    const g = buildGraph({
      hosts: [host("h1")],
      agents: [
        agent("a1", "h1", "lane_work"),
        agent("a2", "h1", "lane_life"),
      ],
      data_sources: [],
      bindings: [],
    });
    expect(g.edges.filter((e) => e.kind === "host_agent")).toHaveLength(2);
  });
});
