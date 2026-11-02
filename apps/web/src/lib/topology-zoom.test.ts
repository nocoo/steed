import { describe, expect, it } from "vitest";
import { TOPOLOGY_ZOOM_FAR, TOPOLOGY_ZOOM_NEAR, topologyZoomTier } from "./topology-zoom";

describe("topology zoom tiers", () => {
  it("shares exact far, mid and near boundaries", () => {
    expect(TOPOLOGY_ZOOM_FAR).toBe(0.4);
    expect(TOPOLOGY_ZOOM_NEAR).toBe(0.75);
    expect(topologyZoomTier(0.399)).toBe("far");
    expect(topologyZoomTier(0.4)).toBe("mid");
    expect(topologyZoomTier(0.749)).toBe("mid");
    expect(topologyZoomTier(0.75)).toBe("near");
  });
});
