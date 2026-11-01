export interface RoutingPoint { x: number; y: number }
export interface RoutingRect extends RoutingPoint { width: number; height: number }

export interface RoutingRegion extends RoutingRect {
  id: string;
}

interface SearchOptions {
  forbidden: Uint32Array;
  required: Uint32Array;
  deadline: number;
  clock: () => number;
}

interface HeapItem { state: number; distance: number; estimate: number }
export const ROUTING_GRID_BYTE_LIMIT = 64 * 1024 * 1024;
export class RoutingGridTimeout extends Error {}
export class RoutingGridLimit extends Error {}

export function estimateRoutingGridBytes(size: number, words: number): number {
  if (!Number.isSafeInteger(size) || size < 0 || !Number.isSafeInteger(words) || words < 0) return Number.POSITIVE_INFINITY;
  const bytes = size * (38 + words * 8);
  return Number.isSafeInteger(bytes) ? bytes : Number.POSITIVE_INFINITY;
}

function lowerBound(values: number[], value: number): number {
  let low = 0;
  let high = values.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    const midValue = values[mid];
    if (midValue === undefined) break;
    if (midValue < value) low = mid + 1;
    else high = mid;
  }
  return low;
}

function upperBound(values: number[], value: number): number {
  let low = 0;
  let high = values.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    const midValue = values[mid];
    if (midValue === undefined) break;
    if (midValue <= value) low = mid + 1;
    else high = mid;
  }
  return low;
}

function rectCoordinates(rects: RoutingRect[], points: RoutingPoint[], axis: "x" | "y"): number[] {
  const coordinates = points.map((point) => point[axis]);
  for (const rect of rects) coordinates.push(rect[axis], rect[axis] + (axis === "x" ? rect.width : rect.height));
  return [...new Set(coordinates)].sort((a, b) => a - b);
}

function heapPush(heap: HeapItem[], item: HeapItem): void {
  let index = heap.length;
  heap.push(item);
  while (index) {
    const parent = (index - 1) >>> 1;
    const parentItem = heap[parent];
    if (parentItem === undefined || compareHeap(parentItem, item) <= 0) break;
    heap[index] = parentItem;
    index = parent;
  }
  heap[index] = item;
}

function heapPop(heap: HeapItem[]): HeapItem | undefined {
  const first = heap[0];
  const last = heap.pop();
  if (!first || !last || heap.length === 0) return first;
  let index = 0;
  while (index * 2 + 1 < heap.length) {
    let child = index * 2 + 1;
    const left = heap[child];
    if (left === undefined) break;
    let selected = left;
    const right = heap[child + 1];
    if (right !== undefined && compareHeap(right, left) < 0) {
      child++;
      selected = right;
    }
    if (compareHeap(last, selected) <= 0) break;
    heap[index] = selected;
    index = child;
  }
  heap[index] = last;
  return first;
}

function compareHeap(a: HeapItem, b: HeapItem): number {
  return a.estimate - b.estimate || b.distance - a.distance || a.state - b.state;
}

export class RoutingGrid {
  readonly xs: number[];
  readonly ys: number[];
  readonly words: number;
  readonly estimatedBytes: number;
  private readonly width: number;
  private readonly size: number;
  private readonly blockedH: Uint8Array;
  private readonly blockedV: Uint8Array;
  private readonly regionsH: Uint32Array;
  private readonly regionsV: Uint32Array;
  private readonly horizontalTraffic: Uint16Array;
  private readonly verticalTraffic: Uint16Array;
  private readonly scores: Float64Array;
  private readonly stamps: Uint32Array;
  private readonly previous: Int32Array;
  private generation = 0;

  constructor(obstacles: RoutingRect[], regions: RoutingRegion[], points: RoutingPoint[], budget?: { clock: () => number; deadline: number; maxBytes?: number }) {
    let work = 0;
    const check = () => {
      if (budget && (work++ & 255) === 0 && budget.clock() >= budget.deadline) throw new RoutingGridTimeout();
    };
    check();
    const rects = [...obstacles, ...regions];
    this.xs = rectCoordinates(rects, points, "x");
    this.ys = rectCoordinates(rects, points, "y");
    this.width = this.xs.length;
    this.size = this.width * this.ys.length;
    this.words = Math.ceil(regions.length / 32);
    this.estimatedBytes = estimateRoutingGridBytes(this.size, this.words);
    const requestedMaxBytes = budget?.maxBytes;
    const effectiveMaxBytes = requestedMaxBytes === undefined
      ? ROUTING_GRID_BYTE_LIMIT
      : Number.isFinite(requestedMaxBytes)
        ? Math.min(ROUTING_GRID_BYTE_LIMIT, Math.max(0, requestedMaxBytes))
        : requestedMaxBytes === Number.POSITIVE_INFINITY
          ? ROUTING_GRID_BYTE_LIMIT
          : 0;
    if (this.estimatedBytes > effectiveMaxBytes) throw new RoutingGridLimit();
    this.blockedH = new Uint8Array(this.size);
    this.blockedV = new Uint8Array(this.size);
    this.regionsH = new Uint32Array(this.size * this.words);
    this.regionsV = new Uint32Array(this.size * this.words);
    this.horizontalTraffic = new Uint16Array(this.size);
    this.verticalTraffic = new Uint16Array(this.size);
    this.scores = new Float64Array(this.size * 2);
    this.stamps = new Uint32Array(this.size * 2);
    this.previous = new Int32Array(this.size * 2);

    const mark = (rect: RoutingRect, region: number | null) => {
      check();
      const x0 = lowerBound(this.xs, rect.x);
      const x1 = lowerBound(this.xs, rect.x + rect.width);
      const y0 = lowerBound(this.ys, rect.y);
      const y1 = lowerBound(this.ys, rect.y + rect.height);
      const innerX = upperBound(this.xs, rect.x);
      const innerY = upperBound(this.ys, rect.y);
      const word = region === null ? 0 : (region >>> 5) * this.size;
      const bit = region === null ? 0 : 1 << (region & 31);
      for (let y = innerY; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          check();
          const index = y * this.width + x;
          if (region === null) this.blockedH[index] = 1;
          else {
            const offset = word + index;
            const value = this.regionsH[offset];
            if (value !== undefined) this.regionsH[offset] = value | bit;
          }
        }
      }
      for (let y = y0; y < y1; y++) {
        for (let x = innerX; x < x1; x++) {
          check();
          const index = y * this.width + x;
          if (region === null) this.blockedV[index] = 1;
          else {
            const offset = word + index;
            const value = this.regionsV[offset];
            if (value !== undefined) this.regionsV[offset] = value | bit;
          }
        }
      }
    };
    for (const rect of obstacles) mark(rect, null);
    regions.forEach((rect, index) => mark(rect, index));
  }

  record(points: RoutingPoint[]): void {
    for (let i = 0; i + 1 < points.length; i++) {
      const a = points[i];
      const b = points[i + 1];
      if (a === undefined || b === undefined) continue;
      if (a.y === b.y) {
        const y = lowerBound(this.ys, a.y);
        if (this.ys[y] !== a.y) continue;
        const from = lowerBound(this.xs, Math.min(a.x, b.x));
        const to = upperBound(this.xs, Math.max(a.x, b.x));
        for (let x = from; x < to; x++) {
          const index = y * this.width + x;
          this.horizontalTraffic[index] = Math.min(0xffff, (this.horizontalTraffic[index] ?? 0) + 1);
        }
      } else if (a.x === b.x) {
        const x = lowerBound(this.xs, a.x);
        if (this.xs[x] !== a.x) continue;
        const from = lowerBound(this.ys, Math.min(a.y, b.y));
        const to = upperBound(this.ys, Math.max(a.y, b.y));
        for (let y = from; y < to; y++) {
          const index = y * this.width + x;
          this.verticalTraffic[index] = Math.min(0xffff, (this.verticalTraffic[index] ?? 0) + 1);
        }
      }
    }
  }

  search(start: RoutingPoint, goal: RoutingPoint, options: SearchOptions): { points: RoutingPoint[] | null; timeout: boolean } {
    const sx = lowerBound(this.xs, start.x);
    const sy = lowerBound(this.ys, start.y);
    const gx = lowerBound(this.xs, goal.x);
    const gy = lowerBound(this.ys, goal.y);
    if (this.xs[sx] !== start.x || this.ys[sy] !== start.y || this.xs[gx] !== goal.x || this.ys[gy] !== goal.y) return { points: null, timeout: false };
    const source = sy * this.width + sx;
    const target = gy * this.width + gx;
    if (source === target) return { points: [start], timeout: false };
    this.generation++;
    if (this.generation === 0xffffffff) {
      this.stamps.fill(0);
      this.generation = 1;
    }
    const stamp = this.generation;
    const heap: HeapItem[] = [];
    const heuristic = (x: number, y: number) => {
      const xCoordinate = this.xs[x];
      const yCoordinate = this.ys[y];
      if (xCoordinate === undefined || yCoordinate === undefined) return Number.MAX_SAFE_INTEGER;
      return Math.abs(xCoordinate - goal.x) + Math.abs(yCoordinate - goal.y);
    };
    for (let direction = 0; direction < 2; direction++) {
      const state = source * 2 + direction;
      this.stamps[state] = stamp;
      this.scores[state] = 0;
      this.previous[state] = -1;
      heapPush(heap, { state, distance: 0, estimate: heuristic(sx, sy) });
    }
    let iterations = 0;
    while (heap.length) {
      if ((iterations++ & 63) === 0 && options.clock() >= options.deadline) return { points: null, timeout: true };
      const current = heapPop(heap);
      if (!current) continue;
      if (this.stamps[current.state] !== stamp || current.distance !== this.scores[current.state]) continue;
      const cell = current.state >>> 1;
      if (cell === target) {
        const path: RoutingPoint[] = [];
        let state = current.state;
        while (state !== -1) {
          const index = state >>> 1;
          const x = this.xs[index % this.width];
          const y = this.ys[Math.floor(index / this.width)];
          if (x === undefined || y === undefined) return { points: null, timeout: false };
          path.push({ x, y });
          const previous = this.previous[state];
          if (previous === undefined) return { points: null, timeout: false };
          state = previous;
        }
        path.reverse();
        return { points: path, timeout: false };
      }
      const x = cell % this.width;
      const y = Math.floor(cell / this.width);
      const consider = (nextX: number, nextY: number, direction: number, edge: number) => {
        const blocked = direction === 0 ? this.blockedH : this.blockedV;
        if (blocked[edge]) return;
        const regions = direction === 0 ? this.regionsH : this.regionsV;
        for (let word = 0; word < this.words; word++) {
          const bits = regions[word * this.size + edge];
          const forbidden = options.forbidden[word];
          const required = options.required[word];
          if (bits === undefined || forbidden === undefined || required === undefined) return;
          if ((bits & forbidden) !== 0 || ((bits & required) >>> 0) !== required) return;
        }
        const nextCell = nextY * this.width + nextX;
        const nextState = nextCell * 2 + direction;
        const xCoordinate = this.xs[x];
        const nextXCoordinate = this.xs[nextX];
        const yCoordinate = this.ys[y];
        const nextYCoordinate = this.ys[nextY];
        if (xCoordinate === undefined || nextXCoordinate === undefined || yCoordinate === undefined || nextYCoordinate === undefined) return;
        const length = Math.abs(xCoordinate - nextXCoordinate) + Math.abs(yCoordinate - nextYCoordinate);
        const traffic = direction === 0 ? (this.verticalTraffic[nextCell] ?? 0) : (this.horizontalTraffic[nextCell] ?? 0);
        const score = current.distance + length + ((current.state & 1) === direction ? 0 : 40) + (nextCell === target ? 0 : Math.min(traffic, 4) * 2);
        const existingScore = this.scores[nextState];
        if (this.stamps[nextState] === stamp && existingScore !== undefined && existingScore <= score) return;
        this.stamps[nextState] = stamp;
        this.scores[nextState] = score;
        this.previous[nextState] = current.state;
        heapPush(heap, { state: nextState, distance: score, estimate: score + heuristic(nextX, nextY) });
      };
      if (x > 0) consider(x - 1, y, 0, cell - 1);
      if (x + 1 < this.width) consider(x + 1, y, 0, cell);
      if (y > 0) consider(x, y - 1, 1, cell - this.width);
      if (y + 1 < this.ys.length) consider(x, y + 1, 1, cell);
    }
    return { points: null, timeout: false };
  }
}
