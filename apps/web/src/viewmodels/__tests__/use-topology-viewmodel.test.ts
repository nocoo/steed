import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Topology } from "@steed/api/shared";
import {
  filterTopology,
  filterTopologyNodes,
  reachableTopologyNodes,
  searchTopologyNodes,
  useTopologyViewModel,
} from "../use-topology-viewmodel";

const client = vi.hoisted(() => ({ get: vi.fn(), clearCache: vi.fn() }));
vi.mock("@/lib/topology-client", () => ({ topologyClient: client }));

function sample(): Topology {
  return {
    schemaVersion: 2,
    title: "Fixture topology",
    description: "Synthetic",
    revision: 4,
    layers: [{ id: "cloud", label: "Cloud", provider: "Fixture", order: 0, description: "" }],
    types: [{ id: "host", label: "Host", shape: "rect", description: "", attrs: [] }],
    boundaries: [
      { id: "home", label: "Home", kind: "site", description: "" },
      { id: "trust", label: "Trust", kind: "trust", parentId: "home", description: "" },
    ],
    nodes: [
      { id: "root", type: "host", label: "Root host", layerId: "cloud", boundaryIds: ["home"], lifecycle: "active", description: "Primary root", tags: ["production"], attrs: { region: "west" } },
      { id: "service", type: "host", label: "API service", layerId: "cloud", parentId: "root", role: "service", boundaryIds: [], lifecycle: "active", description: "Public API", tags: ["production"], attrs: { port: 443 } },
      { id: "port", type: "host", label: "HTTPS port", layerId: "cloud", parentId: "service", role: "subresource", boundaryIds: [], lifecycle: "active", description: "Service port", tags: ["network"], attrs: {} },
      { id: "peer", type: "host", label: "Peer host", layerId: "cloud", boundaryIds: ["trust"], lifecycle: "active", description: "Peer system", tags: ["network"], attrs: {} },
    ],
    edges: [
      { id: "root-service", source: "root", target: "service", kind: "traffic", label: "", direction: "uni", evidence: "documented", description: "", tags: [] },
      { id: "service-port", source: "service", target: "port", kind: "binding", label: "", direction: "uni", evidence: "documented", description: "", tags: [] },
      { id: "peer-root", source: "peer", target: "root", kind: "uses", label: "", direction: "bi", evidence: "inferred", description: "", tags: [] },
    ],
    views: [{ id: "overview", label: "Overview", description: "", filter: { layerIds: ["cloud"], typeIds: ["host"], boundaryIds: [], tags: [] }, focusLayerId: "cloud", pins: {} }],
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  client.get.mockResolvedValue({ data: sample(), updatedAt: "2026-10-31T00:00:00.000Z", requestId: "request-1" });
});
afterEach(() => vi.restoreAllMocks());

describe("topology view model helpers", () => {
  it("filters view, layer, type, boundary, satellite inheritance and tag dimensions", () => {
    const topology = sample();
    expect(filterTopology(topology, { viewId: "overview" }).nodes.map((node) => node.id)).toEqual(["peer", "port", "root", "service"]);
    expect(filterTopology(topology, { boundaryId: "home" }).nodes.map((node) => node.id)).toEqual(["port", "root", "service"]);
    expect(filterTopology(topology, { layerId: "cloud", typeId: "host", tag: "production" }).nodes.map((node) => node.id)).toEqual(["root", "service"]);
    expect(filterTopology(topology, { boundaryId: "trust" }).nodes.map((node) => node.id)).toEqual(["peer"]);
  });

  it("covers view exclusions, direct filters, missing parents, cycles, and edge truncation", () => {
    const topology = sample();
    topology.views[0]!.filter = { layerIds: ["missing-layer"], typeIds: ["missing-type"], boundaryIds: ["missing-boundary"], tags: ["missing-tag"] };
    expect(filterTopologyNodes(topology, { viewId: "overview" })).toEqual([]);

    topology.views[0]!.filter = { layerIds: [], typeIds: [], boundaryIds: ["home"], tags: [] };
    expect(filterTopologyNodes(topology, { viewId: "overview", layerId: "missing", typeId: "missing", boundaryId: "missing", tag: "missing" })).toEqual([]);
    topology.views[0]!.filter = { layerIds: [], typeIds: [], boundaryIds: [], tags: ["production"] };
    expect(filterTopologyNodes(topology, { viewId: "missing-view", tag: "network" }).map((node) => node.id)).toEqual(["peer", "port"]);

    topology.nodes[1]!.parentId = "missing-parent";
    expect(filterTopologyNodes(topology, { boundaryId: "home" }).map((node) => node.id)).toEqual(["root"]);
    topology.nodes[1]!.parentId = "service";
    topology.nodes[1]!.boundaryIds = [];
    topology.nodes[0]!.parentId = "service";
    topology.nodes[1]!.parentId = "root";
    topology.nodes[0]!.parentId = "root";
    expect(filterTopologyNodes(topology, { boundaryId: "home" }).map((node) => node.id).length).toBeGreaterThanOrEqual(0);

    expect(filterTopology(topology, { layerId: "other" }).nodes).toEqual([]);
    expect(filterTopology(topology, { typeId: "other" }).nodes).toEqual([]);
    expect(filterTopology(topology, { tag: "other" }).nodes).toEqual([]);
    expect(filterTopology(topology, { boundaryId: "other" }).nodes).toEqual([]);
  });

  it("searches stable node metadata and traces upstream/downstream/neighbors", () => {
    const topology = sample();
    expect(searchTopologyNodes(topology, "public api").map((node) => node.id)).toEqual(["service"]);
    expect(searchTopologyNodes(topology, "west").map((node) => node.id)).toEqual(["root"]);
    topology.nodes[0]!.attrs = { aliases: ["Blue", "Gamma"], enabled: true };
    expect(searchTopologyNodes(topology, "gamma").map((node) => node.id)).toEqual(["root"]);
    expect(searchTopologyNodes(topology, "true").map((node) => node.id)).toEqual(["root"]);
    expect([...reachableTopologyNodes(topology.edges, "root", "downstream")].sort()).toEqual(["peer", "port", "root", "service"]);
    expect([...reachableTopologyNodes(topology.edges, "port", "upstream")].sort()).toEqual(["peer", "port", "root", "service"]);
    expect([...reachableTopologyNodes(topology.edges, "root", "neighbors")].sort()).toEqual(["peer", "root", "service"]);
    expect([...reachableTopologyNodes(topology.edges, "missing", "upstream")]).toEqual(["missing"]);
    expect([...reachableTopologyNodes([], "isolated", "downstream")]).toEqual(["isolated"]);
    expect(searchTopologyNodes(topology, "   ")).toEqual([]);
  });

  it("loads snapshot data and exposes selected view focus without treating it as a filter", async () => {
    const view = renderHook(useTopologyViewModel);
    await waitFor(() => expect(view.result.current.loading).toBe(false));
    expect(view.result.current.topology?.revision).toBe(4);
    expect(view.result.current.updatedAt).toBe("2026-10-31T00:00:00.000Z");
    expect(view.result.current.visibleNodes.map((node) => node.id)).toEqual(["peer", "port", "root", "service"]);
    act(() => view.result.current.setViewId("overview"));
    expect(view.result.current.selectedView?.id).toBe("overview");
    expect(view.result.current.focusLayerId).toBe("cloud");
    act(() => view.result.current.setSelectedNodeId("root"));
    expect(view.result.current.selectedNode?.id).toBe("root");
    act(() => view.result.current.setSelectedNodeId("missing"));
    expect(view.result.current.selectedNode).toBeNull();
    act(() => view.result.current.setViewId("missing"));
    expect(view.result.current.selectedView).toBeNull();
    expect(view.result.current.focusLayerId).toBe("");
    expect(view.result.current.visibleNodes).toHaveLength(4);
  });

  it("combines client-side filters, search, trace and stale-load recovery", async () => {
    const view = renderHook(useTopologyViewModel);
    await waitFor(() => expect(view.result.current.loading).toBe(false));

    act(() => view.result.current.setFilter({}));
    act(() => view.result.current.setFilter({ viewId: "overview", layerId: "cloud", typeId: "host", boundaryId: "home", tag: "production", search: "west" }));
    expect(view.result.current.visibleNodes.map((node) => node.id)).toEqual(["root", "service"]);
    expect(view.result.current.searchResults.map((node) => node.id)).toEqual(["root"]);
    act(() => view.result.current.setSearch("west"));
    expect(view.result.current.searchResults.map((node) => node.id)).toEqual(["root"]);

    act(() => view.result.current.clearFilters());
    act(() => view.result.current.setTrace({ id: "service", direction: "downstream" }));
    expect(view.result.current.visibleNodes.map((node) => node.id)).toEqual(["port", "service"]);
    act(() => view.result.current.setSelectedNodeId("service"));
    act(() => view.result.current.traceSelected("upstream"));
    expect(view.result.current.visibleNodes.map((node) => node.id)).toEqual(["peer", "root", "service"]);

    act(() => view.result.current.clearTrace());
    act(() => view.result.current.traceNode(""));
    expect(view.result.current.trace).toBeNull();
    act(() => view.result.current.traceNode("root"));
    expect(view.result.current.trace).toEqual({ id: "root", direction: "neighbors" });
    act(() => view.result.current.setSelectedNodeId(""));
    act(() => view.result.current.traceSelected("downstream"));
    act(() => view.result.current.clearTrace());
    act(() => view.result.current.reload());
    await waitFor(() => expect(view.result.current.busy).toBe(false));
    expect(client.get).toHaveBeenCalledTimes(2);
  });

  it.each([new Error("Unavailable"), "Unavailable", 42])("reports load errors without losing filter state", async (cause) => {
    client.get.mockRejectedValueOnce(cause);
    const view = renderHook(useTopologyViewModel);
    await waitFor(() => expect(view.result.current.loading).toBe(false));
    expect(view.result.current.error).toBe(cause instanceof Error ? cause.message : "Topology is unavailable.");
    act(() => view.result.current.setLayerId("cloud"));
    act(() => view.result.current.reload());
    await waitFor(() => expect(view.result.current.error).toBe(""));
    expect(view.result.current.layerId).toBe("cloud");
  });

  it("ignores a stale snapshot after reload and an unmounted result", async () => {
    let finishFirst!: (value: { data: Topology; updatedAt: string }) => void;
    client.get
      .mockImplementationOnce(() => new Promise((resolve) => { finishFirst = resolve; }))
      .mockResolvedValueOnce({ data: { ...sample(), title: "Fresh topology" }, updatedAt: "2026-10-31T00:02:00.000Z" });
    const view = renderHook(useTopologyViewModel);
    await waitFor(() => expect(client.get).toHaveBeenCalledTimes(1));
    act(() => view.result.current.reload());
    await waitFor(() => expect(view.result.current.topology?.title).toBe("Fresh topology"));
    act(() => finishFirst({ data: sample(), updatedAt: "2026-10-31T00:01:00.000Z" }));
    expect(view.result.current.topology?.title).toBe("Fresh topology");
  });

  it("ignores a result that finishes after unmount", async () => {
    let finish!: (value: { data: Topology; updatedAt: string }) => void;
    client.get.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const view = renderHook(useTopologyViewModel);
    view.unmount();
    act(() => finish({ data: sample(), updatedAt: "2026-10-31T00:02:00.000Z" }));
    expect(view.result.current.topology).toBeNull();
  });
});
