import { describe, it, expect } from "vitest";
import {
  LANE_IDS,
  type Lane,
  type Host,
  type Agent,
  type DataSource,
  type Binding,
  type SnapshotRequest,
  type Overview,
} from "./types";

describe("Shared Types", () => {
  it("should have correct LANE_IDS constants", () => {
    expect(LANE_IDS.work).toBe("lane_work");
    expect(LANE_IDS.life).toBe("lane_life");
    expect(LANE_IDS.learning).toBe("lane_learning");
  });

  it("should allow creating Lane type", () => {
    const lane: Lane = {
      id: "lane_work",
      name: "work",
    };
    expect(lane.id).toBe("lane_work");
  });

  it("should allow creating Host type", () => {
    const host: Host = {
      id: "host_123",
      name: "test-host",
      api_key_hash: "hash123",
      created_at: "2026-04-14T00:00:00Z",
      last_seen_at: null,
    };
    expect(host.id).toBe("host_123");
  });

  it("should allow creating Agent type", () => {
    const agent: Agent = {
      id: "agent_123",
      host_id: "host_123",
      match_key: "openclaw:/home/workspace",
      nickname: null,
      role: null,
      lane_id: null,
      metadata: {},
      extra: {},
      runtime_app: null,
      runtime_version: null,
      status: "stopped",
      created_at: "2026-04-14T00:00:00Z",
      last_seen_at: null,
    };
    expect(agent.status).toBe("stopped");
  });

  it("should allow creating DataSource type", () => {
    const ds: DataSource = {
      id: "ds_123",
      host_id: "host_123",
      type: "personal_cli",
      name: "nmem",
      version: "1.0.0",
      auth_status: "authenticated",
      status: "active",
      metadata: {},
      created_at: "2026-04-14T00:00:00Z",
      last_seen_at: null,
    };
    expect(ds.type).toBe("personal_cli");
  });

  it("should allow creating Binding type", () => {
    const binding: Binding = {
      agent_id: "agent_123",
      data_source_id: "ds_123",
      created_at: "2026-04-14T00:00:00Z",
    };
    expect(binding.agent_id).toBe("agent_123");
  });

  it("should allow creating SnapshotRequest type", () => {
    const snapshot: SnapshotRequest = {
      agents: [
        {
          match_key: "openclaw:/home/workspace",
          runtime_app: "openclaw",
          runtime_version: "0.3.2",
          status: "running",
        },
      ],
      data_sources: [
        {
          type: "personal_cli",
          name: "nmem",
          version: "1.2.0",
          auth_status: "authenticated",
        },
      ],
    };
    expect(snapshot.agents.length).toBe(1);
  });

  it("should allow creating Overview type", () => {
    const overview: Overview = {
      hosts: { total: 3, online: 2, offline: 1 },
      agents: {
        total: 5,
        running: 3,
        stopped: 1,
        missing: 1,
        by_lane: { work: 2, life: 1, learning: 1, unassigned: 1 },
      },
      data_sources: { total: 8, active: 7, missing: 1 },
    };
    expect(overview.hosts.total).toBe(3);
  });
});
