import { describe, expect, it } from "vitest";
import { topologyConnectScopeSchema, topologyTokenEtag, topologyTokenIdSchema, topologyTokenInputSchema } from "./topology-connect-token";

describe("topology Connect token contract", () => {
  it("accepts topology scopes and rejects diagram bindings and old scopes", () => {
    expect(topologyTokenInputSchema.parse({ name: "Fixture", scope: "topology:read" })).toEqual({ name: "Fixture", scope: "topology:read", expiresAt: null });
    expect(topologyTokenInputSchema.safeParse({ name: "Fixture", scope: "topology:write", expiresAt: "2030-01-01T00:00:00Z" }).success).toBe(true);
    expect(topologyTokenInputSchema.safeParse({ name: "Fixture", scope: "topology:write", diagramId: null }).success).toBe(false);
    expect(topologyConnectScopeSchema.safeParse("write").success).toBe(false);
    expect(topologyTokenInputSchema.safeParse({ name: "", scope: "topology:read" }).success).toBe(false);
  });
  it("keeps token version ETags and canonical URL IDs", () => {
    expect(topologyTokenEtag("a-b", 2)).toBe('"a-b:2"');
    expect(topologyTokenIdSchema.safeParse("a-b").success).toBe(true);
    expect(topologyTokenIdSchema.safeParse("../bad").success).toBe(false);
  });
});
