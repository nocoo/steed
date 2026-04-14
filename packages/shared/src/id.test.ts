import { describe, it, expect } from "vitest";
import { generateId } from "./id";

describe("generateId", () => {
  it("should generate ID with correct prefix", () => {
    const id = generateId("host");
    expect(id).toMatch(/^host_[a-f0-9]{12}$/);
  });

  it("should generate unique IDs", () => {
    const id1 = generateId("agent");
    const id2 = generateId("agent");
    expect(id1).not.toBe(id2);
  });

  it("should work with different prefixes", () => {
    const hostId = generateId("host");
    const agentId = generateId("agent");
    const dsId = generateId("ds");

    expect(hostId).toMatch(/^host_/);
    expect(agentId).toMatch(/^agent_/);
    expect(dsId).toMatch(/^ds_/);
  });
});
