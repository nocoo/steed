import { describe, expect, it, vi } from "vitest";
import type { Topology } from "@steed/api/shared";
import type { LayoutWorkerRequest } from "./layout.worker";

function sample(): Topology {
  return {
    schemaVersion: 2,
    title: "Worker failure fixture",
    description: "Synthetic",
    revision: 1,
    layers: [{ id: "cloud", label: "Cloud", provider: "Fixture", order: 0, description: "" }],
    types: [{ id: "host", label: "Host", shape: "rect", description: "", attrs: [] }],
    boundaries: [],
    nodes: [{ id: "a", type: "host", label: "A", layerId: "cloud", boundaryIds: [], lifecycle: "active", description: "", tags: [], attrs: {} }],
    edges: [],
    views: [],
  };
}

describe("commit8 layout worker failure overlay", () => {
  it("serializes a non-Error compute failure into a safe worker response", async () => {
    const postMessage = vi.fn();
    const scope = { onmessage: null as null | ((event: MessageEvent<LayoutWorkerRequest>) => void), postMessage };
    vi.stubGlobal("self", scope);
    vi.doMock("./topology-layout-compute", () => ({
      computeTopologyLayout: () => { throw "synthetic non-error failure"; },
    }));

    try {
      await vi.resetModules();
      await import("./layout.worker");
      const request: LayoutWorkerRequest = {
        requestId: "layout-worker-non-error",
        layoutVersion: 1,
        topology: sample(),
      };
      scope.onmessage?.({ data: request } as MessageEvent<LayoutWorkerRequest>);

      expect(postMessage).toHaveBeenCalledWith({
        requestId: "layout-worker-non-error",
        layoutVersion: 1,
        ok: false,
        message: "Layout worker failed",
      });
    } finally {
      vi.doUnmock("./topology-layout-compute");
      vi.unstubAllGlobals();
      await vi.resetModules();
    }
  });
});
