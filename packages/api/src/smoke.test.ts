import { describe, it, expect } from "vitest";
import { TOPOLOGY_CONNECT_OPERATIONS, topologySchema, userProfileSchema } from "./shared/index";
import sample from "../../../examples/topology-sample.json";

describe("@steed/api", () => {
  it("exports the shared topology, Connect and profile contracts", () => {
    expect(topologySchema.safeParse(sample).success).toBe(true);
    expect(TOPOLOGY_CONNECT_OPERATIONS.length).toBeGreaterThan(0);
    expect(userProfileSchema).toBeDefined();
  });
});
