import { describe, expect, it, vi } from "vitest";
import {
  ROUTING_GRID_BYTE_LIMIT,
  RoutingGrid,
  RoutingGridTimeout,
  RoutingGridLimit,
  estimateRoutingGridBytes,
  type RoutingPoint,
  type RoutingRect,
} from "./topology-routing-grid";

const options = (deadline = 1000, clock = () => 0) => ({
  forbidden: new Uint32Array(),
  required: new Uint32Array(),
  deadline,
  clock,
});

function strictSegmentHitsRect(a: RoutingPoint, b: RoutingPoint, rect: RoutingRect): boolean {
  if (a.x === b.x) {
    const yMin = Math.min(a.y, b.y);
    const yMax = Math.max(a.y, b.y);
    return a.x > rect.x && a.x < rect.x + rect.width
      && yMax > rect.y && yMin < rect.y + rect.height;
  }
  if (a.y === b.y) {
    const xMin = Math.min(a.x, b.x);
    const xMax = Math.max(a.x, b.x);
    return a.y > rect.y && a.y < rect.y + rect.height
      && xMax > rect.x && xMin < rect.x + rect.width;
  }
  return true;
}

describe("RoutingGrid", () => {
  it("returns infinity for invalid or overflowing memory estimates", () => {
    expect(estimateRoutingGridBytes(-1, 0)).toBe(Number.POSITIVE_INFINITY);
    expect(estimateRoutingGridBytes(0, -1)).toBe(Number.POSITIVE_INFINITY);
    expect(estimateRoutingGridBytes(1.5, 0)).toBe(Number.POSITIVE_INFINITY);
    expect(estimateRoutingGridBytes(0, 1.5)).toBe(Number.POSITIVE_INFINITY);
    expect(estimateRoutingGridBytes(Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER)).toBe(Number.POSITIVE_INFINITY);
  });

  it("bounds typed-array memory exactly at the allocation boundary", () => {
    const largestAllowedSize = Math.floor(ROUTING_GRID_BYTE_LIMIT / 38);

    expect(estimateRoutingGridBytes(largestAllowedSize, 0)).toBe(largestAllowedSize * 38);
    expect(estimateRoutingGridBytes(largestAllowedSize, 0)).toBeLessThanOrEqual(ROUTING_GRID_BYTE_LIMIT);
    expect(estimateRoutingGridBytes(largestAllowedSize + 1, 0)).toBeGreaterThan(ROUTING_GRID_BYTE_LIMIT);
  });

  it("throws RoutingGridTimeout before allocation when constructor time is exhausted", () => {
    expect(() => new RoutingGrid([], [], [{ x: 0, y: 0 }, { x: 10, y: 10 }], {
      clock: () => 100,
      deadline: 100,
      maxBytes: ROUTING_GRID_BYTE_LIMIT,
    })).toThrow(RoutingGridTimeout);
  });

  it("throws RoutingGridTimeout while marking a large obstacle region", () => {
    let clockCalls = 0;
    const clock = () => {
      clockCalls++;
      return clockCalls > 4 ? 100 : 0;
    };

    expect(() => new RoutingGrid(
      [{ x: -1000, y: -1000, width: 2000, height: 2000 }, { x: 3000, y: 3000, width: 2000, height: 2000 }],
      [],
      Array.from({ length: 40401 }, (_, index) => ({ x: (index % 201) - 100, y: Math.floor(index / 201) - 100 })),
      { clock, deadline: 50, maxBytes: ROUTING_GRID_BYTE_LIMIT },
    )).toThrow(RoutingGridTimeout);
  });

  it("throws RoutingGridLimit before allocating typed arrays above the limit", () => {
    const points = Array.from({ length: 1331 }, (_, index) => ({ x: index, y: index }));

    expect(() => new RoutingGrid([], [], points)).toThrow(RoutingGridLimit);
  });

  it("clamps maxBytes for finite, negative, NaN and infinite budgets", () => {
    const points = [{ x: 0, y: 0 }, { x: 10, y: 10 }];

    expect(() => new RoutingGrid([], [], points, { clock: () => 0, deadline: 1000, maxBytes: Number.NaN })).toThrow(RoutingGridLimit);
    expect(() => new RoutingGrid([], [], points, { clock: () => 0, deadline: 1000, maxBytes: -100 })).toThrow(RoutingGridLimit);
    expect(() => new RoutingGrid([], [], points, { clock: () => 0, deadline: 1000, maxBytes: Number.NEGATIVE_INFINITY })).toThrow(RoutingGridLimit);

    const infinite = new RoutingGrid([], [], [{ x: 0, y: 0 }], {
      clock: () => 0,
      deadline: 1000,
      maxBytes: Number.POSITIVE_INFINITY,
    });
    expect(infinite.estimatedBytes).toBe(38);
  });

  it("uses the remaining maxBytes exactly at its boundary", () => {
    const points = [{ x: 0, y: 0 }, { x: 10, y: 10 }];

    expect(() => new RoutingGrid([], [], points, { clock: () => 0, deadline: 1000, maxBytes: 151 })).toThrow(RoutingGridLimit);

    const grid = new RoutingGrid([], [], points, { clock: () => 0, deadline: 1000, maxBytes: 152 });
    expect(grid.estimatedBytes).toBe(152);

    const abovePerGridLimit = new RoutingGrid([], [], [{ x: 0, y: 0 }], {
      clock: () => 0,
      deadline: 1000,
      maxBytes: ROUTING_GRID_BYTE_LIMIT * 2,
    });
    expect(abovePerGridLimit.estimatedBytes).toBe(38);
  });

  it("builds unique integer coordinate sweeps and returns the exact point for a zero-length search", () => {
    const grid = new RoutingGrid(
      [{ x: 10, y: 10, width: 10, height: 10 }],
      [{ id: "zone", x: 20, y: 20, width: 10, height: 10 }],
      [{ x: 15, y: 15 }, { x: 15, y: 15 }, { x: -5, y: 30 }],
    );

    expect(grid.xs).toEqual([-5, 10, 15, 20, 30]);
    expect(grid.ys).toEqual([10, 15, 20, 30]);
    expect(grid.words).toBe(1);
    expect(grid.estimatedBytes).toBe(20 * (38 + 8));

    const point = { x: 15, y: 15 };
    expect(grid.search(point, point, options())).toEqual({ points: [point], timeout: false });
  });

  it("rejects starts or goals that are not exactly in the coordinate sweep", () => {
    const grid = new RoutingGrid([], [], [{ x: 0, y: 0 }, { x: 20, y: 20 }]);

    expect(grid.search({ x: 5, y: 5 }, { x: 20, y: 20 }, options())).toEqual({ points: null, timeout: false });
    expect(grid.search({ x: 0, y: 0 }, { x: 25, y: 20 }, options())).toEqual({ points: null, timeout: false });
  });

  it("returns no path when a rectangular obstacle encloses the grid", () => {
    const grid = new RoutingGrid(
      [{ x: 0, y: 0, width: 20, height: 20 }],
      [],
      [{ x: 10, y: 10 }, { x: 30, y: 30 }],
    );

    expect(grid.search({ x: 10, y: 10 }, { x: 30, y: 30 }, options())).toEqual({ points: null, timeout: false });
  });

  it("finds an orthogonal route around an obstacle without crossing its interior", () => {
    const obstacle: RoutingRect = { x: 10, y: 10, width: 10, height: 10 };
    const grid = new RoutingGrid(
      [obstacle],
      [],
      [{ x: 0, y: 15 }, { x: 30, y: 15 }, { x: 15, y: 0 }, { x: 15, y: 30 }],
    );

    const result = grid.search({ x: 0, y: 15 }, { x: 30, y: 15 }, options());
    expect(result.timeout).toBe(false);
    expect(result.points).not.toBeNull();

    const points = result.points!;
    for (let index = 1; index < points.length; index++) {
      const a = points[index - 1]!;
      const b = points[index]!;
      expect(a.x === b.x || a.y === b.y).toBe(true);
      expect(strictSegmentHitsRect(a, b, obstacle)).toBe(false);
    }
  });

  it("honors forbidden region masks and keeps routes outside the forbidden interior", () => {
    const region: RoutingRect & { id: string } = { id: "forbidden", x: 10, y: 10, width: 10, height: 10 };
    const grid = new RoutingGrid(
      [],
      [region],
      [{ x: 0, y: 15 }, { x: 30, y: 15 }, { x: 15, y: 0 }, { x: 15, y: 30 }],
    );

    const forbidden = new Uint32Array([1]);
    const required = new Uint32Array([0]);
    const result = grid.search(
      { x: 0, y: 15 },
      { x: 30, y: 15 },
      { ...options(), forbidden, required },
    );

    expect(result.timeout).toBe(false);
    expect(result.points).not.toBeNull();
    for (let index = 1; index < result.points!.length; index++) {
      expect(strictSegmentHitsRect(result.points![index - 1]!, result.points![index]!, region)).toBe(false);
    }
  });

  it("returns no path when every route would leave a required region", () => {
    const region: RoutingRect & { id: string } = { id: "required", x: 10, y: 10, width: 10, height: 10 };
    const grid = new RoutingGrid(
      [],
      [region],
      [{ x: 0, y: 15 }, { x: 30, y: 15 }, { x: 15, y: 15 }],
    );

    const result = grid.search(
      { x: 0, y: 15 },
      { x: 30, y: 15 },
      { ...options(), forbidden: new Uint32Array([0]), required: new Uint32Array([1]) },
    );

    expect(result.timeout).toBe(false);
    expect(result.points).toBeNull();
  });

  it("supports sparse and three-word region masks without out-of-range words", () => {
    const regions = Array.from({ length: 97 }, (_, index) => ({
      id: `sparse-${index}`,
      x: index % 2 === 0 ? 0 : 60,
      y: index % 3 === 0 ? 0 : 60,
      width: 40,
      height: 40,
    }));
    const start = { x: 20, y: 20 };
    const goal = { x: 80, y: 80 };
    const grid = new RoutingGrid([], regions, [start, goal]);

    expect(grid.words).toBe(4);

    const forbidden = new Uint32Array(1);
    const required = new Uint32Array(4);
    required[3] = 1 << 0;
    const exact = grid.search(start, start, { ...options(), forbidden, required });
    expect(exact).toEqual({ points: [start], timeout: false });

    const result = grid.search(start, goal, { ...options(), forbidden, required });

    expect(result.timeout).toBe(false);
    expect(result.points === null || result.points.length >= 2).toBe(true);
  });

  it("rejects a search safely when sparse mask arrays omit later region words", () => {
    const regions = Array.from({ length: 65 }, (_, index) => ({
      id: `missing-word-${index}`,
      x: 0,
      y: 0,
      width: 100,
      height: 100,
    }));
    const grid = new RoutingGrid([], regions, [{ x: 0, y: 0 }, { x: 100, y: 100 }]);

    expect(grid.words).toBe(3);
    expect(grid.search({ x: 0, y: 0 }, { x: 100, y: 100 }, {
      ...options(),
      forbidden: new Uint32Array([1]),
      required: new Uint32Array([0]),
    })).toEqual({ points: null, timeout: false });
  });

  it("honors the high bit of each required region word", () => {
    const regions = Array.from({ length: 64 }, (_, index) => ({ id: `region-${index}`, x: 0, y: 0, width: 100, height: 100 }));
    const start = { x: 20, y: 20 }; const goal = { x: 80, y: 80 };
    const grid = new RoutingGrid([], regions, [start, goal]);
    const result = grid.search(start, goal, {
      ...options(), forbidden: new Uint32Array(2), required: new Uint32Array([0x80000000, 0x80000000]),
    });
    expect(result.timeout).toBe(false);
    expect(result.points?.[0]).toEqual(start);
    expect(result.points?.at(-1)).toEqual(goal);
  });

  it("reports timeout in the middle of a synthetic search after the clock advances", () => {
    const points = Array.from({ length: 101 }, (_, y) =>
      Array.from({ length: 101 }, (_, x) => ({ x: x * 10, y: y * 10 })),
    ).flat();
    const grid = new RoutingGrid(
      [{ x: 500, y: 100, width: 20, height: 800 }],
      [],
      points,
    );
    let calls = 0;

    const result = grid.search(
      { x: 0, y: 0 },
      { x: 1000, y: 1000 },
      {
        forbidden: new Uint32Array(),
        required: new Uint32Array(),
        deadline: 50,
        clock: () => ++calls >= 2 ? 100 : calls,
      },
    );

    expect(result.timeout).toBe(true);
    expect(result.points).toBeNull();
  });

  it("reports timeout before the first search expansion from an exhausted fake clock", () => {
    const grid = new RoutingGrid([], [], [{ x: 0, y: 0 }, { x: 10, y: 10 }]);
    const result = grid.search(
      { x: 0, y: 0 },
      { x: 10, y: 10 },
      options(50, () => 50),
    );

    expect(result).toEqual({ points: null, timeout: true });
  });

  it("preserves duplicate and negative coordinates in a deterministic sweep", () => {
    const grid = new RoutingGrid(
      [{ x: -20, y: -10, width: 10, height: 10 }],
      [],
      [{ x: -30, y: -5 }, { x: -20, y: -5 }, { x: -20, y: -5 }, { x: 10, y: 10 }],
    );

    expect(grid.xs).toEqual([-30, -20, -10, 10]);
    expect(grid.ys).toEqual([-10, -5, 0, 10]);

    const result = grid.search({ x: -30, y: -5 }, { x: 10, y: 10 }, options());
    expect(result.timeout).toBe(false);
    expect(result.points).not.toBeNull();
  });

  it("records saturated horizontal and vertical traffic and ignores sparse or diagonal paths", () => {
    const grid = new RoutingGrid([], [], [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 0, y: 10 },
      { x: 10, y: 10 },
      { x: -100, y: -100 },
    ]);
    grid.record([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
      { x: 1, y: 1 },
      { x: -100, y: -100 },
    ]);

    for (let index = 0; index < 70000; index++) {
      grid.record([{ x: 0, y: 0 }, { x: 10, y: 0 }]);
    }

    const internals = grid as unknown as { horizontalTraffic: Uint16Array; verticalTraffic: Uint16Array };
    expect(internals.horizontalTraffic.some((value) => value === 0xffff)).toBe(true);

    const result = grid.search({ x: 0, y: 0 }, { x: 10, y: 10 }, options());
    expect(result.timeout).toBe(false);
    expect(result.points).not.toBeNull();
  });

  it("treats exact obstacle borders and zero-size regions as valid boundary cases", () => {
    const grid = new RoutingGrid(
      [{ x: 10, y: 10, width: 20, height: 20 }],
      [{ id: "zero", x: 50, y: 50, width: 0, height: 0 }],
      [{ x: 0, y: 20 }, { x: 40, y: 20 }, { x: 20, y: 0 }, { x: 20, y: 40 }],
    );

    const horizontal = grid.search({ x: 0, y: 20 }, { x: 40, y: 20 }, options());
    expect(horizontal.timeout).toBe(false);
    expect(horizontal.points === null || horizontal.points.length >= 2).toBe(true);

    const vertical = grid.search({ x: 20, y: 0 }, { x: 20, y: 40 }, options());
    expect(vertical).toEqual({ points: null, timeout: false });
  });

  it("resets search stamps after generation wraps deterministically", () => {
    const grid = new RoutingGrid([], [], [{ x: 0, y: 0 }, { x: 10, y: 10 }]);
    const internals = grid as unknown as { generation: number };
    internals.generation = 0xfffffffe;

    const forward = grid.search({ x: 0, y: 0 }, { x: 10, y: 10 }, options());
    expect(forward.timeout).toBe(false);
    expect(forward.points?.[0]).toEqual({ x: 0, y: 0 });
    expect(forward.points?.at(-1)).toEqual({ x: 10, y: 10 });

    const reverse = grid.search({ x: 10, y: 10 }, { x: 0, y: 0 }, options());
    expect(reverse.timeout).toBe(false);
    expect(reverse.points?.[0]).toEqual({ x: 10, y: 10 });
    expect(reverse.points?.at(-1)).toEqual({ x: 0, y: 0 });
  });

  it("does not call the search clock or timeout after an exact same-point route", () => {
    const grid = new RoutingGrid([], [], [{ x: 7, y: 9 }]);
    const clock = vi.fn(() => 1000);

    expect(grid.search({ x: 7, y: 9 }, { x: 7, y: 9 }, options(0, clock))).toEqual({ points: [{ x: 7, y: 9 }], timeout: false });
    expect(clock).not.toHaveBeenCalled();
  });
});
