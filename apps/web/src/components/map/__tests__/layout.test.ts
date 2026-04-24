import { describe, it, expect } from "vitest";
import { layoutThreeColumn, COLUMN_X } from "../layout";
import type { MapNode } from "@/lib/map-data";

const mockHost: MapNode = {
  id: "h1",
  kind: "host",
  data: {
    kind: "host",
    label: "Host 1",
    laneKeys: [],
    orphan: false,
    raw: {
      id: "h1",
      name: "Host 1",
      os: "darwin",
      arch: "arm64",
      hostname: "test-host",
      status: "online",
      created_at: "2024-01-01T00:00:00Z",
      last_seen_at: "2024-01-01T00:00:00Z",
    },
  },
};

const mockAgent: MapNode = {
  id: "a1",
  kind: "agent",
  data: {
    kind: "agent",
    label: "Agent 1",
    laneKeys: ["work"],
    orphan: false,
    raw: {
      id: "a1",
      host_id: "h1",
      match_key: "agent-1",
      nickname: "Agent 1",
      role: null,
      lane_id: "lane_work",
      runtime_app: "node",
      runtime_version: "20.0.0",
      status: "running",
      created_at: "2024-01-01T00:00:00Z",
      last_seen_at: null,
      metadata: {},
    },
  },
};

const mockDataSource: MapNode = {
  id: "ds1",
  kind: "data_source",
  data: {
    kind: "data_source",
    label: "Data Source 1",
    laneKeys: ["work"],
    orphan: false,
    raw: {
      id: "ds1",
      host_id: "h1",
      type: "personal_cli",
      name: "Data Source 1",
      version: "1.0.0",
      auth_status: "authenticated",
      status: "active",
      metadata: {},
      created_at: "2024-01-01T00:00:00Z",
      last_seen_at: null,
      lane_ids: ["lane_work"],
    },
  },
};

describe("layoutThreeColumn", () => {
  it("places hosts in first column", () => {
    const result = layoutThreeColumn([mockHost]);
    expect(result).toHaveLength(1);
    expect(result[0]?.position.x).toBe(COLUMN_X.host);
  });

  it("places agents in second column", () => {
    const result = layoutThreeColumn([mockAgent]);
    expect(result).toHaveLength(1);
    expect(result[0]?.position.x).toBe(COLUMN_X.agent);
  });

  it("places data sources in third column", () => {
    const result = layoutThreeColumn([mockDataSource]);
    expect(result).toHaveLength(1);
    expect(result[0]?.position.x).toBe(COLUMN_X.data_source);
  });

  it("groups nodes by lane", () => {
    const workAgent = mockAgent;
    const lifeAgent: MapNode = {
      ...mockAgent,
      id: "a2",
      data: {
        ...mockAgent.data,
        kind: "agent",
        laneKeys: ["life"],
        raw: { ...mockAgent.data.raw, id: "a2", lane_id: "lane_life" },
      },
    };
    const result = layoutThreeColumn([lifeAgent, workAgent]);
    expect(result).toHaveLength(2);
    const workPos = result.find((n) => n.id === "a1");
    const lifePos = result.find((n) => n.id === "a2");
    expect(workPos?.position.y).toBeLessThan(lifePos?.position.y ?? 0);
  });

  it("handles unassigned lane", () => {
    const unassignedAgent: MapNode = {
      ...mockAgent,
      id: "a3",
      data: {
        ...mockAgent.data,
        kind: "agent",
        laneKeys: [],
        raw: { ...mockAgent.data.raw, id: "a3", lane_id: null },
      },
    };
    const result = layoutThreeColumn([unassignedAgent]);
    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe("a3");
  });

  it("handles empty nodes array", () => {
    const result = layoutThreeColumn([]);
    expect(result).toHaveLength(0);
  });

  it("handles all three types together", () => {
    const result = layoutThreeColumn([mockHost, mockAgent, mockDataSource]);
    expect(result).toHaveLength(3);
    const hostNode = result.find((n) => n.id === "h1");
    const agentNode = result.find((n) => n.id === "a1");
    const dsNode = result.find((n) => n.id === "ds1");
    expect(hostNode?.position.x).toBe(COLUMN_X.host);
    expect(agentNode?.position.x).toBe(COLUMN_X.agent);
    expect(dsNode?.position.x).toBe(COLUMN_X.data_source);
  });
});
