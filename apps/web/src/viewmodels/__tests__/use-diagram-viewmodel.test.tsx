import { act, render, waitFor } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { emptyDiagram, type DiagramRecord } from "@steed/api/shared";
import { useDiagramViewModel } from "../use-diagram-viewmodel";

const client = vi.hoisted(() => ({ list: vi.fn(), get: vi.fn(), save: vi.fn(), delete: vi.fn() }));
vi.mock("@/lib/diagram-client", () => ({ diagramClient: client }));
const record = (): DiagramRecord => ({ id: "example", document: emptyDiagram("Original"), title: "Original", description: "", revision: 1,
  nodeCount: 0, edgeCount: 0, createdAt: "2026-09-12T00:00:00Z", updatedAt: "2026-09-12T00:00:00Z" });
let vm: ReturnType<typeof useDiagramViewModel>;
function Probe() { vm = useDiagramViewModel(); return <p>{vm.draft?.title ?? "List"}</p>; }
function setup(path = "/diagrams/example") {
  const router = createMemoryRouter([{ path: "/diagrams/:id?", element: <Probe /> }, { path: "/other", element: <p>Other</p> }], { initialEntries: [path] });
  const view = render(<RouterProvider router={router} />);
  return { ...view, router };
}
beforeEach(() => { vi.resetAllMocks(); client.list.mockResolvedValue({ data: [], nextCursor: null }); client.get.mockResolvedValue(record()); });
afterEach(() => vi.restoreAllMocks());

describe("diagram view model", () => {
  it("loads all list pages and the selected document", async () => {
    client.list.mockResolvedValueOnce({ data: [record()], nextCursor: "example" }).mockResolvedValueOnce({ data: [{ ...record(), id: "other" }], nextCursor: null });
    setup();
    await waitFor(() => expect(vm.loading).toBe(false));
    expect(vm.list).toHaveLength(2);
    expect(vm.record?.revision).toBe(1);
    expect(vm.dirty).toBe(false);
    expect(client.list).toHaveBeenLastCalledWith("example");
  });

  it("saves against the loaded revision and leaves an independent later draft intact", async () => {
    setup(); await waitFor(() => expect(vm.loading).toBe(false));
    await act(() => vm.setDraft(emptyDiagram("Edited")));
    expect(vm.dirty).toBe(true);
    const event = new Event("beforeunload", { cancelable: true }); window.dispatchEvent(event); expect(event.defaultPrevented).toBe(true);
    let finish!: (value: DiagramRecord) => void;
    client.save.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    let saving!: Promise<void>;
    await act(() => { saving = vm.save(); });
    await act(() => vm.setDraft(emptyDiagram("Later edit")));
    await act(async () => { finish({ ...record(), document: emptyDiagram("Edited"), title: "Edited", revision: 2 }); await saving; });
    expect(vm.draft?.title).toBe("Later edit"); expect(vm.record?.revision).toBe(2); expect(vm.dirty).toBe(true);
    client.save.mockResolvedValueOnce({ ...record(), document: emptyDiagram("Later edit"), revision: 3 });
    await act(() => vm.save());
    expect(vm.dirty).toBe(false); expect(vm.notice).toBe("Saved revision 3.");
    expect(client.save.mock.calls[0]?.[2]).toBe(1);
  });

  it("preserves the draft when the server rejects a stale revision", async () => {
    setup(); await waitFor(() => expect(vm.loading).toBe(false));
    await act(() => vm.setDraft(emptyDiagram("Unsaved")));
    client.save.mockRejectedValueOnce(new Error("Reload before editing."));
    await act(() => vm.save());
    expect(vm.error).toBe("Reload before editing."); expect(vm.draft?.title).toBe("Unsaved"); expect(vm.record?.revision).toBe(1);
  });

  it("blocks navigation away from an unsaved draft", async () => {
    const { router } = setup(); await waitFor(() => expect(vm.loading).toBe(false));
    await act(() => vm.setDraft(emptyDiagram("Unsaved")));
    await act(() => router.navigate("/other"));
    expect(vm.blocker.state).toBe("blocked");
    await act(() => vm.blocker.reset?.());
    expect(router.state.location.pathname).toBe("/diagrams/example");
  });

  it("keeps navigation protection active during a pending save", async () => {
    const { router } = setup(); await waitFor(() => expect(vm.loading).toBe(false));
    await act(() => vm.setDraft(emptyDiagram("Unsaved")));
    let reject!: (error: Error) => void;
    client.save.mockImplementationOnce(() => new Promise((_, fail) => { reject = fail; }));
    let saving!: Promise<void>;
    await act(() => { saving = vm.save(); });
    expect(vm.busy).toBe(true);
    await act(() => router.navigate("/other"));
    expect(vm.blocker.state).toBe("blocked");
    await act(() => vm.blocker.reset?.());
    await act(async () => { reject(new Error("Disconnected")); await saving; });
    expect(router.state.location.pathname).toBe("/diagrams/example");
    expect(vm.draft?.title).toBe("Unsaved");
  });

  it("creates and deletes documents, and treats the list as having no editable record", async () => {
    const { router } = setup("/diagrams"); await waitFor(() => expect(vm.loading).toBe(false));
    await act(() => vm.save()); await act(() => vm.remove()); expect(client.save).not.toHaveBeenCalled();
    client.save.mockResolvedValueOnce(record());
    await act(() => vm.create());
    await waitFor(() => expect(vm.record?.id).toBe("example"));
    expect(router.state.location.pathname).toBe("/diagrams/example");
    expect(client.save).toHaveBeenCalledWith(expect.any(String), emptyDiagram(), null);
    client.delete.mockResolvedValueOnce(undefined);
    await act(() => vm.remove());
    await waitFor(() => expect(vm.loading).toBe(false));
    expect(router.state.location.pathname).toBe("/diagrams");
  });

  it.each([new Error("Unavailable"), "Unavailable"])("reports loading failures", async (cause) => {
    client.list.mockRejectedValueOnce(cause); setup();
    await waitFor(() => expect(vm.error).toBe("Unavailable")); expect(vm.loading).toBe(false);
  });

  it("ignores a read that finishes after navigation", async () => {
    let finish!: (value: DiagramRecord) => void;
    client.get.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const { router } = setup(); await waitFor(() => expect(client.get).toHaveBeenCalled());
    await act(() => router.navigate("/diagrams")); await waitFor(() => expect(vm.loading).toBe(false));
    await act(() => finish(record())); expect(vm.draft).toBeNull();
  });
});
