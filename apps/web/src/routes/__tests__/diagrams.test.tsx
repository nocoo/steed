import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { diagramSchema, emptyDiagram, type DiagramRecord } from "@steed/api/shared";
import example from "../../../../../examples/service-platform.json";
import { diagramClient, downloadDiagram } from "@/lib/diagram-client";
import { DiagramsPage } from "../diagrams";
import type { DiagramCanvas } from "@/components/map/diagram-canvas";
import type { ComponentProps } from "react";

vi.mock("@/lib/diagram-client", () => ({ diagramClient: { list: vi.fn(), get: vi.fn(), save: vi.fn(), delete: vi.fn() }, downloadDiagram: vi.fn() }));
vi.mock("@/components/map/diagram-canvas", () => ({
  DiagramCanvas: (props: ComponentProps<typeof DiagramCanvas>) => <div data-testid="canvas" data-filter={JSON.stringify(props.filter)}>
    {props.document.nodes.map((node) => <button key={node.id} onClick={() => props.onSelect(node.id)}>Select {node.id}</button>)}
    <button onClick={() => props.onMove("api", { x: 80, y: 50 })}>Drag API</button>
    <button onClick={() => props.onConnect("api", "jobs")}>Draw connection</button>
    <button onClick={() => props.onExpand("compute")}>Expand compute</button>
    <button onClick={() => props.onEdgeSelect(props.document.edges.slice(0, 1))}>Select edge</button>
  </div>,
}));
const record = (document = diagramSchema.parse(example)): DiagramRecord => ({
  id: "example", document, title: document.title, description: document.description,
  revision: 1, nodeCount: document.nodes.length, edgeCount: document.edges.length, createdAt: "2026-09-12", updatedAt: "2026-09-12",
});
const button = (name: string) => screen.getByRole("button", { name, exact: true });
const click = (name: string) => fireEvent.click(button(name));
const change = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label, { exact: true }), { target: { value } });
async function open(path = "/diagrams/example") {
  const router = createMemoryRouter([{ path: "/diagrams/:id?", element: <DiagramsPage /> }, { path: "/away", element: <p>Another page</p> }], { initialEntries: [path] });
  render(<RouterProvider router={router} />);
  await screen.findByRole("heading", { name: path === "/diagrams" ? "Diagrams" : "Service platform", exact: true });
  await waitFor(() => expect(screen.queryByText("Loading diagrams…")).not.toBeInTheDocument());
  return router;
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(diagramClient.list).mockResolvedValue({ data: [record()], nextCursor: null });
  vi.mocked(diagramClient.get).mockResolvedValue(record());
  vi.mocked(diagramClient.save).mockImplementation(async (id, document, revision) => ({ ...record(document), id, revision: (revision ?? 0) + 1 }));
  vi.mocked(diagramClient.delete).mockResolvedValue(undefined);
});

describe("diagram workspace", () => {
  it("searches and traces authored relationships and expands collapsed boundaries", async () => {
    await open();
    click("Find / inspect");
    change("Find a component", "no match");
    expect(screen.getByText("No matching components.")).toBeInTheDocument();
    change("Find a component", "api.example.com");
    fireEvent.click(within(screen.getByLabelText("Search results")).getByRole("button"));
    expect(screen.getByRole("link", { name: "https://api.example.com" })).toHaveAttribute("rel", "noopener noreferrer");
    expect(screen.getByTestId("canvas")).toHaveAttribute("data-filter", expect.stringContaining('"neighbors"'));
    click("Upstream"); click("Downstream"); click("Clear trace");
    fireEvent.click(screen.getByLabelText("Collapse Application services"));
    expect(screen.getByTestId("canvas")).toHaveAttribute("data-filter", expect.stringContaining('"compute"'));
    click("Expand compute");
    fireEvent.click(screen.getByLabelText("Collapse Cloud"));
    fireEvent.click(screen.getByLabelText("Collapse Cloud"));
    change("Diagram view", "storage");
    fireEvent.click(screen.getByLabelText("Boundaries", { selector: "input" }));
    expect(screen.getByTestId("canvas")).toHaveAttribute("data-filter", expect.stringContaining('"showBoundaries":false'));
    click("Hide details");
  });

  it("edits a component, saves view coordinates, exports, then cascades a removal", async () => {
    await open();
    click("Drag API");
    click("Select api"); click("Edit component");
    change("Name", "Renamed API"); change("Kind", "service"); change("Boundary", "data");
    change("URL", "https://new.example.com"); change("Description and evidence", "Documented service");
    click("Apply to draft");
    expect(screen.getByText("Unsaved changes")).toBeInTheDocument();
    expect(button("Import JSON")).toBeDisabled();
    click("Save changes");
    await screen.findByText("Saved revision 2.");
    const saved = vi.mocked(diagramClient.save).mock.calls[0]?.[1];
    expect(saved?.nodes.find((node) => node.id === "api")).toMatchObject({ label: "Renamed API", groupId: "data", url: "https://new.example.com" });
    expect(saved?.views[0]?.positions.api).toEqual({ x: 80, y: 50 });
    click("Export JSON"); expect(downloadDiagram).toHaveBeenCalledWith(saved);
    click("Delete component"); click("Cancel");
    click("Delete component"); click("Remove component");
    click("Save changes"); await screen.findByText("Saved revision 3.");
    const removed = vi.mocked(diagramClient.save).mock.calls[1]?.[1];
    expect(removed?.nodes.some((node) => node.id === "api")).toBe(false);
    expect(removed?.edges.some((edge) => edge.source === "api" || edge.target === "api")).toBe(false);
    expect(diagramSchema.safeParse(removed).success).toBe(true);
  });

  it("creates and edits connections, preserving evidence and pruning saved routes on removal", async () => {
    const routed = record(); routed.document.views[0]!.routes.request = { waypoints: [] };
    vi.mocked(diagramClient.get).mockResolvedValue(routed);
    await open();
    click("Connection"); change("From", "api"); change("To", "jobs");
    change("Connection label", "Dispatch"); change("Kind", "dependency"); change("Evidence", "inferred"); change("Evidence and notes", "Unverified");
    click("Apply to draft");
    click("Select edge"); click("Edit connection"); change("Connection label", "TLS"); click("Apply to draft");
    click("Edit connection"); click("Remove connection");
    click("Save changes"); await screen.findByText("Saved revision 2.");
    const saved = vi.mocked(diagramClient.save).mock.calls[0]?.[1];
    expect(saved?.edges.some((edge) => edge.id === "request")).toBe(false);
    expect(saved?.views[0]?.routes.request).toBeUndefined();
    expect(saved?.edges.find((edge) => edge.label === "Dispatch")).toMatchObject({ evidence: "inferred", description: "Unverified" });
    expect(diagramSchema.safeParse(saved).success).toBe(true);
    click("Draw connection"); click("Cancel");
    click("Select api"); fireEvent.click(screen.getByRole("button", { name: /Application database.*SQL/ }));
    expect(screen.getByRole("heading", { name: "Connection details" })).toBeInTheDocument();
  });

  it("keeps the valid graph after an invalid source and resets stale filters on replacement", async () => {
    await open();
    click("Select api"); click("Downstream");
    click("Edit source"); change("Diagram JSON", "{bad"); click("Apply to draft");
    expect(screen.getByRole("alert")).toBeInTheDocument();
    change("Diagram JSON", JSON.stringify(emptyDiagram("Replacement"))); click("Apply to draft");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByTestId("canvas")).not.toHaveAttribute("data-filter", expect.stringContaining('"focus"'));
    expect(button("Connection")).toBeDisabled();
    expect(screen.getByText("Add boundaries and named views in Edit source.")).toBeInTheDocument();
    click("Component"); change("Name", "First service"); change("Boundary", ""); change("URL", ""); click("Apply to draft");
    expect(screen.getByRole("heading", { name: "First service" })).toBeInTheDocument();
  });

  it("handles loading, empty lists, creation, import failures and an imported document", async () => {
    vi.mocked(diagramClient.list).mockResolvedValue({ data: [], nextCursor: null });
    await open("/diagrams");
    expect(screen.getByText("Your architecture starts here")).toBeInTheDocument();
    const input = screen.getByLabelText("Import diagram file");
    fireEvent.change(input, { target: { files: [] } });
    click("Import JSON");
    fireEvent.change(input, { target: { files: [{ size: 1_048_577 }] } });
    await screen.findByText("The diagram file exceeds 1 MiB.");
    fireEvent.change(input, { target: { files: [{ size: 5, text: async () => "{bad" }] } });
    await waitFor(() => expect(screen.getByRole("alert")).not.toHaveTextContent("1 MiB"));
    fireEvent.change(input, { target: { files: [{ size: 5000, text: async () => JSON.stringify(example) }] } });
    await waitFor(() => expect(diagramClient.save).toHaveBeenCalledWith(expect.any(String), diagramSchema.parse(example), null));
  });

  it("lists diagrams, creates a blank document, and confirms deletion", async () => {
    await open("/diagrams");
    expect(screen.getByRole("link", { name: /Service platform/ })).toHaveAttribute("href", "/diagrams/example");
    click("New diagram");
    await waitFor(() => expect(diagramClient.save).toHaveBeenCalledWith(expect.any(String), emptyDiagram(), null));
    await screen.findByRole("button", { name: "Delete diagram", exact: true });
    click("Delete diagram");
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Delete diagram", exact: true }));
    await waitFor(() => expect(diagramClient.delete).toHaveBeenCalledWith("example", 1));
  });

  it("guards unsaved navigation and preserves an edit after a conflicting save", async () => {
    const router = await open();
    click("Drag API");
    vi.mocked(diagramClient.save).mockRejectedValueOnce(new Error("The diagram changed. Reload before editing."));
    click("Save changes"); await screen.findByRole("alert");
    expect(screen.getByText("Unsaved changes")).toBeInTheDocument();
    await act(async () => { await router.navigate("/away"); });
    await screen.findByRole("dialog"); click("Keep editing");
    expect(screen.queryByText("Another page")).not.toBeInTheDocument();
    await act(async () => { await router.navigate("/away"); });
    await screen.findByRole("dialog"); click("Discard and leave");
    await screen.findByText("Another page");
  });
});
