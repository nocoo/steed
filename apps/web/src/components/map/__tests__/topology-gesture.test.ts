import { describe, expect, it } from "vitest";
import { topologyGestureMove } from "../topology-canvas";

function touch(type: string, xs: number[]): TouchEvent {
  const event = new Event(type) as TouchEvent;
  Object.defineProperty(event, "touches", { value: xs.map((clientX) => ({ clientX, clientY: 100 })) });
  return event;
}

describe("sidebar refit gesture classification", () => {
  const previous = { x: 0, y: 0, zoom: 1 };

  it("does not mistake repeated symmetric or clamped pinch callbacks for pan", () => {
    const first = topologyGestureMove(touch("touchmove", [75, 125]), { x: -100, y: -100, zoom: 1.2 }, previous, null);
    expect(first.manualPan).toBe(false);
    const repeated = topologyGestureMove(touch("touchmove", [75, 125]), { x: -100, y: -100, zoom: 1.2 }, previous, first.touchCentroid);
    expect(repeated.manualPan).toBe(false);
    expect(topologyGestureMove(touch("touchmove", [50, 150]), { x: -100, y: -100, zoom: 2 }, { x: -100, y: -100, zoom: 2 }, repeated.touchCentroid).manualPan).toBe(false);
    expect(topologyGestureMove(touch("touchmove", [95, 145]), { x: -100, y: -100, zoom: 1.2 }, previous, first.touchCentroid).manualPan).toBe(true);
    expect(topologyGestureMove(touch("touchmove", [75, 125]), previous, previous, { x: 120, y: 100, count: 1 }).manualPan).toBe(false);
  });

  it("detects a first single-finger pan after touch transitions", () => {
    const single = touch("touchmove", [120]);
    expect(topologyGestureMove(single, { x: 10, y: 0, zoom: 1 }, previous, null).manualPan).toBe(true);
    expect(topologyGestureMove(single, { x: 10, y: 0, zoom: 1 }, previous, { x: 100, y: 100, count: 2 }).manualPan).toBe(true);
    expect(topologyGestureMove(single, previous, previous, { x: 120, y: 100, count: 1 }).manualPan).toBe(false);
    expect(topologyGestureMove(touch("touchmove", []), previous, previous, null)).toEqual({ manualPan: false, touchCentroid: null });
  });

  it("distinguishes pointer pan from zoom and programmatic movement", () => {
    const moved = { x: 10, y: 20, zoom: 1 };
    expect(topologyGestureMove(new MouseEvent("mousemove"), moved, previous, null).manualPan).toBe(true);
    expect(topologyGestureMove(new MouseEvent("mousemove"), previous, previous, null).manualPan).toBe(false);
    expect(topologyGestureMove(new MouseEvent("mousemove"), { ...moved, zoom: 1.2 }, previous, null).manualPan).toBe(false);
    expect(topologyGestureMove(new WheelEvent("wheel"), moved, previous, null).manualPan).toBe(false);
    expect(topologyGestureMove(new MouseEvent("dblclick"), moved, previous, null).manualPan).toBe(false);
    expect(topologyGestureMove(null, moved, previous, null).manualPan).toBe(false);
  });

  it("tracks the start centroid and clears it on touch end", () => {
    expect(topologyGestureMove(touch("touchstart", [60, 140]), previous, previous, null))
      .toEqual({ manualPan: false, touchCentroid: { x: 100, y: 100, count: 2 } });
    expect(topologyGestureMove(touch("touchend", [60]), previous, previous, { x: 100, y: 100, count: 2 }))
      .toEqual({ manualPan: false, touchCentroid: null });
  });
});
