import { StrictMode, useLayoutEffect, type ReactNode } from "react";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ReactFlowProvider, useStoreApi } from "@xyflow/react";
import { createTopologyFallbackRectIndex } from "@/lib/topology-route-edge-safety";
import { TopologyRouteMeasuredLabel } from "./topology-route-edge";

let captureStore: ReturnType<typeof useStoreApi> | null = null;
let portalHost: HTMLDivElement | null = null;
let detachTransform: (() => void) | undefined;
let measurements: Array<{ zoom: number; width: number; height: number; text: string; transform: string }> = [];
let invalidSize = false;

function StoreCapture() {
  const store = useStoreApi();
  useLayoutEffect(() => {
    captureStore = store;
  }, [store]);
  return null;
}

function labelIndex() {
  const result = createTopologyFallbackRectIndex({ lanes: [], frames: [], positions: {} }, new Map(), 8);
  result.add({ kind: "frame-title", x: 10000, y: 10000, width: 20, height: 20 });
  return result;
}

function labelProps(overrides: Partial<{
  text: string;
  detail: string;
  segments: Array<{ a: { x: number; y: number }; b: { x: number; y: number } }>;
}> = {}, fallbackIndex = labelIndex()) {
  return {
    edgeId: "edge-a-b",
    segments: overrides.segments ?? [{ a: { x: 0, y: 120 }, b: { x: 500, y: 120 } }],
    fallbackIndex,
    sourceId: "a",
    targetId: "b",
    text: overrides.text ?? "HTTPS · HTTPS :443",
    detail: overrides.detail ?? "HTTPS :443",
  };
}

function harness(children: ReactNode, initialZoom = 0.39, strict = false) {
  portalHost = document.createElement("div");
  portalHost.innerHTML = '<div class="react-flow__viewport"><div class="react-flow__edgelabel-renderer"></div></div>';
  document.body.append(portalHost);

  const tree = (content?: ReactNode) => {
    const provider = (
      <ReactFlowProvider>
        <StoreCapture />
        {content}
      </ReactFlowProvider>
    );
    return strict ? <StrictMode>{provider}</StrictMode> : provider;
  };

  const result = render(tree());
  awaitStore(result, initialZoom, children, strict);
  return {
    update: (content: ReactNode) => result.rerender(tree(content)),
  };
}

function awaitStore(result: ReturnType<typeof render>, initialZoom: number, children: ReactNode, strict: boolean) {
  if (!captureStore) throw new Error("React Flow store was not captured");
  const updateTransform = () => {
    const [x, y, zoom] = captureStore!.getState().transform;
    portalHost?.querySelector<HTMLElement>(".react-flow__viewport")?.style.setProperty("transform", `translate(${x}px,${y}px) scale(${zoom})`);
  };
  detachTransform = captureStore.subscribe(updateTransform);
  act(() => {
    captureStore!.setState({ domNode: portalHost, transform: [0, 0, initialZoom] });
  });
  const tree = () => {
    const provider = (
      <ReactFlowProvider>
        <StoreCapture />
        {children}
      </ReactFlowProvider>
    );
    return strict ? <StrictMode>{provider}</StrictMode> : provider;
  };
  result.rerender(tree());
}

function setZoom(zoom: number, x = 0, y = 0) {
  act(() => {
    captureStore?.setState({ transform: [x, y, zoom] });
  });
}

describe("TopologyRouteMeasuredLabel real React Flow store and portal", () => {
  beforeEach(() => {
    captureStore = null;
    portalHost = null;
    detachTransform = undefined;
    measurements = [];
    invalidSize = false;
  });

  afterEach(() => {
    cleanup();
    detachTransform?.();
    portalHost?.remove();
    captureStore = null;
    portalHost = null;
    vi.restoreAllMocks();
  });

  it("remeasures 0.75 to 1.1 without rerender, preserves the DOM button, and ignores pan", async () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function getBoundingClientRect(): DOMRect {
      const zoom = captureStore?.getState().transform[2] ?? 1;
      const viewportTransform = this.closest<HTMLElement>(".react-flow__viewport")?.style.transform ?? "";
      const width = invalidSize ? 0 : 100 * zoom;
      const height = invalidSize ? 0 : 22 * zoom;
      measurements.push({ zoom, width, height, text: this.textContent ?? "", transform: viewportTransform });
      return { x: 0, y: 0, left: 0, top: 0, right: width, bottom: height, width, height, toJSON: () => ({}) } as DOMRect;
    });

    const initialProps = labelProps();
    const stableIndex = initialProps.fallbackIndex;
    const fixture = harness(<TopologyRouteMeasuredLabel {...initialProps} />, 0.39);
    setZoom(0.75);

    const first = await waitFor(() => {
      const button = screen.getByRole("button", { name: "HTTPS · HTTPS :443" });
      expect(button.style.visibility).toBe("visible");
      expect(button.style.transform).toContain("translate(50px, 120px)");
      return button;
    });
    expect(measurements).toHaveLength(1);
    expect(measurements[0]?.width).toBeCloseTo(75, 5);
    expect(measurements[0]?.height).toBeCloseTo(16.5, 5);

    setZoom(1.1);
    await waitFor(() => {
      expect(measurements).toHaveLength(2);
      expect(screen.getByRole("button", { name: "HTTPS · HTTPS :443" }).style.visibility).toBe("visible");
      expect(screen.getByRole("button", { name: "HTTPS · HTTPS :443" }).style.transform).toContain("translate(50px, 120px)");
    });
    expect(screen.getByRole("button", { name: "HTTPS · HTTPS :443" })).toBe(first);
    expect(measurements[1]?.width).toBeCloseTo(110, 5);
    expect(measurements[1]?.transform).toContain("scale(1.1)");

    const measurementCount = measurements.length;
    setZoom(1.1, 120, 50);
    await act(async () => { await Promise.resolve(); });
    expect(measurements).toHaveLength(measurementCount);

    const textProps = labelProps({ text: "TCP · TCP :8080", detail: "TCP :8080" }, stableIndex);
    fixture.update(<TopologyRouteMeasuredLabel {...textProps} />);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "TCP · TCP :8080" }).style.visibility).toBe("visible");
      expect(measurements.length).toBeGreaterThan(measurementCount);
    });

    const beforeRoute = measurements.length;
    const routeProps = {
      ...textProps,
      segments: [{ a: { x: 200, y: 250 }, b: { x: 800, y: 250 } }],
    };
    fixture.update(<TopologyRouteMeasuredLabel {...routeProps} />);
    await waitFor(() => {
      const button = screen.getByRole("button", { name: "TCP · TCP :8080" });
      expect(button.style.visibility).toBe("visible");
      expect(button.style.transform).toContain("translate(250px, 250px)");
      expect(measurements.length).toBeGreaterThan(beforeRoute);
    });
  });

  it("remounts after hidden tiers and StrictMode ends with one current label", async () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function getBoundingClientRect(): DOMRect {
      const zoom = captureStore?.getState().transform[2] ?? 1;
      const width = 100 * zoom;
      const height = 22 * zoom;
      measurements.push({ zoom, width, height, text: this.textContent ?? "", transform: "" });
      return { x: 0, y: 0, left: 0, top: 0, right: width, bottom: height, width, height, toJSON: () => ({}) } as DOMRect;
    });

    const initialProps = labelProps();
    const stableIndex = initialProps.fallbackIndex;
    const fixture = harness(<TopologyRouteMeasuredLabel {...initialProps} />, 0.39, true);
    setZoom(0.74);
    expect(document.querySelector(".topology-route-edge-label")).toBeNull();
    expect(measurements).toHaveLength(0);

    setZoom(0.75);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "HTTPS · HTTPS :443" }).style.visibility).toBe("visible");
    });

    setZoom(0.74);
    expect(document.querySelector(".topology-route-edge-label")).toBeNull();
    const countHidden = measurements.length;

    fixture.update(<TopologyRouteMeasuredLabel {...labelProps({ text: "Updated", detail: "" }, stableIndex)} />);
    setZoom(1);
    await waitFor(() => {
      const button = screen.getByRole("button", { name: "Updated" });
      expect(button.style.visibility).toBe("visible");
      expect(document.querySelectorAll('[aria-label="Updated"]')).toHaveLength(1);
    });
    expect(measurements.length).toBeGreaterThan(countHidden);
  });

  it("fails closed on a zero-size near measurement and recovers on another near zoom", async () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function getBoundingClientRect(): DOMRect {
      const zoom = captureStore?.getState().transform[2] ?? 1;
      const width = invalidSize ? 0 : 100 * zoom;
      const height = invalidSize ? 0 : 22 * zoom;
      measurements.push({ zoom, width, height, text: this.textContent ?? "", transform: "" });
      return { x: 0, y: 0, left: 0, top: 0, right: width, bottom: height, width, height, toJSON: () => ({}) } as DOMRect;
    });

    const initialProps = labelProps();
    invalidSize = true;
    harness(<TopologyRouteMeasuredLabel {...initialProps} />, 0.75, true);
    await waitFor(() => {
      expect(document.querySelector(".topology-route-edge-label")?.getAttribute("aria-label")).toBe("HTTPS · HTTPS :443");
    });
    expect((document.querySelector(".topology-route-edge-label") as HTMLElement).style.visibility).toBe("hidden");

    invalidSize = false;
    setZoom(1);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "HTTPS · HTTPS :443" }).style.visibility).toBe("visible");
    });
  });
});
