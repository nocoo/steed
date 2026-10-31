import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Topology } from "@steed/api/shared";
import type { ComponentProps } from "react";
import type { TopologyCanvas } from "@/components/map/topology-canvas";
import { TopologyPage } from "../topology";

const client = vi.hoisted(() => ({ get: vi.fn(), clearCache: vi.fn() }));
const download = vi.hoisted(() => vi.fn());
vi.mock("@/lib/topology-client", () => ({ topologyClient: client, downloadTopology: download }));
vi.mock("@/components/map/topology-canvas", async (original) => {
  const actual = await original<typeof import("@/components/map/topology-canvas")>();
  return {
    ...actual,
    TopologyCanvas: (props: ComponentProps<typeof TopologyCanvas>) => (
      <div data-testid="canvas" data-visible-nodes={props.visibleNodes.length} data-visible-edges={props.visibleEdges.length}>
        {props.visibleNodes.map((node) => <button key={node.id} type="button" onClick={() => props.onSelect(node.id)}>Canvas {node.id}</button>)}
      </div>
    ),
  };
});

function sample(): Topology {
  return {
    schemaVersion: 2,
    title: "Fixture topology",
    description: "Read-only fixture",
    revision: 7,
    layers: [{ id: "cloud", label: "Cloud", provider: "Fixture", order: 0, description: "" }],
    types: [{
      id: "host",
      label: "Host",
      shape: "rect",
      description: "",
      attrs: [
        { key: "cpu", label: "CPU", valueType: "number", badge: true, order: 0, required: false, unit: "cores" },
        { key: "enabled", label: "Enabled", valueType: "boolean", badge: true, order: 1, required: false },
        { key: "region", label: "Region", valueType: "string", badge: true, order: 2, required: false },
      ],
    }],
    boundaries: [
      { id: "home", label: "Home", kind: "site", parentId: "site", description: "" },
      { id: "site", label: "Office", kind: "site", description: "" },
    ],
    nodes: [
      { id: "root", type: "host", label: "Root host", layerId: "cloud", boundaryIds: ["home"], lifecycle: "active", description: "Primary host", tags: ["production"], attrs: { cpu: 0, enabled: false, region: "west", command: "diagnostic" }, provenance: "manual" },
      { id: "service", type: "host", label: "API service", layerId: "cloud", parentId: "root", role: "service", boundaryIds: [], lifecycle: "planned", description: "Public API", tags: ["production"], attrs: { region: "west", aliases: ["api", "public"] } },
      { id: "port", type: "host", label: "HTTPS port", layerId: "cloud", parentId: "service", role: "subresource", boundaryIds: [], lifecycle: "active", description: "443", tags: ["network"], attrs: {} },
      { id: "peer", type: "host", label: "Peer host", layerId: "cloud", boundaryIds: [], lifecycle: "deprecated", description: "Peer", tags: ["network"], attrs: {} },
    ],
    edges: [{ id: "root-service", source: "root", target: "service", kind: "traffic", label: "HTTPS", direction: "uni", evidence: "documented", description: "Public route", tags: [] }],
    views: [{ id: "overview", label: "Overview", description: "", filter: { layerIds: ["cloud"], typeIds: ["host"], boundaryIds: [], tags: [] }, focusLayerId: "cloud", pins: { root: { x: 700, y: 180 } } }],
  };
}

function setup() {
  const router = createMemoryRouter([
    { path: "/topology", element: <TopologyPage /> },
    { path: "/connect", element: <h1>Connect</h1> },
  ], { initialEntries: ["/topology"] });
  render(<RouterProvider router={router} />);
  return router;
}

function changeSelect(label: string, text: string) {
  const control = screen.getByLabelText(label);
  fireEvent.keyDown(control, { key: "ArrowDown" });
  const option = screen.getAllByRole("option").find((item) => item.textContent?.toLowerCase().includes(text.toLowerCase()));
  if (!option) throw new Error(`Missing option for ${label}: ${text}`);
  fireEvent.click(option);
}

beforeEach(() => {
  vi.clearAllMocks();
  client.get.mockResolvedValue({ data: sample(), updatedAt: "2026-10-31T00:00:00.000Z" });
});

describe("read-only topology page", () => {
  it("loads the canonical snapshot, exports full topology, and has no edit controls", async () => {
    setup();
    await screen.findByRole("heading", { name: "Fixture topology" });
    expect(screen.getByText("Read-only fixture")).toBeInTheDocument();
    expect(screen.getByText("Revision 7")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Save|Delete|New|Import/i })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Export JSON" }));
    expect(download).toHaveBeenCalledWith(expect.objectContaining({ title: "Fixture topology", revision: 7 }));
  });

  it("selects nodes, displays inherited boundaries, badges, satellites, edges and provenance", async () => {
    setup();
    await screen.findByRole("heading", { name: "Fixture topology" });
    fireEvent.click(screen.getByRole("button", { name: "Canvas service" }));
    const inspector = screen.getByLabelText("Topology inspector");
    expect(within(inspector).getByRole("heading", { name: "API service" })).toBeInTheDocument();
    expect(within(inspector).getByText("Home")).toBeInTheDocument();
    expect(within(inspector).getByText("Office")).toBeInTheDocument();
    expect(within(inspector).getByText("Region: west")).toBeInTheDocument();
    expect(within(inspector).getByText("Not set")).toBeInTheDocument();
    expect(within(inspector).getByText("← Root host")).toBeInTheDocument();
    fireEvent.click(within(inspector).getByRole("button", { name: /HTTPS port/ }));
  });

  it("searches, selects, traces, clears filters and exposes filter controls", async () => {
    setup();
    await screen.findByRole("heading", { name: "Fixture topology" });
    fireEvent.change(screen.getByLabelText("Find a node"), { target: { value: "west" } });
    const results = screen.getByLabelText("Topology search results");
    fireEvent.click(within(results).getByRole("button", { name: /Root host/ }));
    const inspector = screen.getByLabelText("Topology inspector");
    expect(within(inspector).getByRole("heading", { name: "Root host" })).toBeInTheDocument();
    expect(within(inspector).getByText("CPU: 0 cores")).toBeInTheDocument();
    expect(within(inspector).getByText("Enabled: false")).toBeInTheDocument();
    fireEvent.click(within(inspector).getByRole("button", { name: "Upstream" }));
    fireEvent.click(screen.getByRole("button", { name: "Clear trace" }));

    expect(screen.getByLabelText("Layer filter")).toBeInTheDocument();
    expect(screen.getByLabelText("Type filter")).toBeInTheDocument();
    expect(screen.getByLabelText("Boundary filter")).toBeInTheDocument();
    expect(screen.getByLabelText("Tag filter")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Hide details" }));
    expect(screen.queryByLabelText("Topology inspector")).not.toBeInTheDocument();
  });

  it("shows an empty search result and links a selected node URL", async () => {
    const topology = sample();
    topology.nodes[0]!.url = "https://example.com";
    client.get.mockResolvedValue({ data: topology, updatedAt: "2026-10-31T00:00:00.000Z" });
    setup();
    await screen.findByRole("heading", { name: "Fixture topology" });
    fireEvent.change(screen.getByLabelText("Find a node"), { target: { value: "no-matching-node" } });
    expect(screen.getByText("No matching nodes.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Canvas root" }));
    expect(screen.getByRole("link", { name: "https://example.com" })).toHaveAttribute("href", "https://example.com");
  });

  it("shows a Connect empty state and never calls the canvas when topology has no nodes", async () => {
    client.get.mockResolvedValue({ data: { ...sample(), nodes: [], edges: [], views: [] }, updatedAt: "2026-10-31T00:00:00.000Z" });
    setup();
    expect(await screen.findByText("Your topology is empty")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open Connect" })).toHaveAttribute("href", "/connect");
    expect(screen.queryByTestId("canvas")).not.toBeInTheDocument();
  });

  it("applies view and dimension filters, then clears them", async () => {
    setup();
    await screen.findByRole("heading", { name: "Fixture topology" });
    changeSelect("Topology view", "Overview");
    changeSelect("Layer filter", "Cloud");
    changeSelect("Type filter", "Host");
    changeSelect("Boundary filter", "Home");
    changeSelect("Tag filter", "production");
    fireEvent.change(screen.getByLabelText("Find a node"), { target: { value: "west" } });
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(screen.getByLabelText("Find a node")).toHaveValue("");
    expect(screen.queryByRole("button", { name: "Clear filters" })).not.toBeInTheDocument();
  });

  it("shows bidirectional arrows for both endpoints and relative arrows for unidirectional edges", async () => {
    const topology = sample();
    topology.edges[0]!.direction = "bi";
    client.get.mockResolvedValue({ data: topology, updatedAt: "2026-10-31T00:00:00.000Z" });
    setup();
    await screen.findByRole("heading", { name: "Fixture topology" });
    fireEvent.click(screen.getByRole("button", { name: "Canvas root" }));
    const inspector = screen.getByLabelText("Topology inspector");
    expect(within(inspector).getByText("↔ API service")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Canvas service" }));
    expect(within(inspector).getByText("↔ Root host")).toBeInTheDocument();
  });

  it("shows root provenance and satellites, plus no-edge/no-satellite peer details", async () => {
    setup();
    await screen.findByRole("heading", { name: "Fixture topology" });
    fireEvent.click(screen.getByRole("button", { name: "Canvas root" }));
    const inspector = screen.getByLabelText("Topology inspector");
    expect(within(inspector).getByText("manual")).toBeInTheDocument();
    expect(within(inspector).getByText("→ API service")).toBeInTheDocument();
    expect(within(inspector).getAllByRole("button", { name: /API service/ }).length).toBeGreaterThan(0);
    expect(within(inspector).getByRole("button", { name: /HTTPS port/ })).toBeInTheDocument();
    expect(within(inspector).getByText("1 edges")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Canvas peer" }));
    expect(within(inspector).getByRole("heading", { name: "Peer host" })).toBeInTheDocument();
    expect(within(inspector).getAllByText("None", { exact: true }).length).toBeGreaterThan(0);
  });

  it("reports loading and request failures", async () => {
    let finish!: (value: { data: Topology; updatedAt: string }) => void;
    client.get.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    setup();
    expect(screen.getByRole("status")).toHaveTextContent("Loading topology");
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    await act(async () => { finish({ data: sample(), updatedAt: "2026-10-31T00:01:00.000Z" }); });

    client.get.mockRejectedValueOnce(new Error("Topology unavailable"));
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Topology unavailable");
  });

  it("can reload the snapshot and preserves non-string/null attr rendering", async () => {
    setup();
    await screen.findByRole("heading", { name: "Fixture topology" });
    fireEvent.click(screen.getByRole("button", { name: "Canvas root" }));
    const inspector = screen.getByLabelText("Topology inspector");
    expect(within(inspector).getByText("command")).toBeInTheDocument();
    expect(within(inspector).getByText("diagnostic")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    await waitFor(() => expect(client.get).toHaveBeenCalledTimes(2));
  });
});
