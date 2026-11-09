/**
 * Server-Timing for API responses (docs/19 "Server-Timing"). Only fixed metric names and rounded
 * millisecond durations are emitted, never descriptions, identities, ids or request data. Every
 * step is fail-soft: a broken clock or a missing D1 `meta.duration` drops that value, never the
 * response.
 *
 * Workers clocks advance only across I/O, so CPU-only segments (validate) read 0 in production;
 * the I/O segments and `total` are accurate.
 */
export const SERVER_TIMING_METRICS = [
  "auth", "auth-sql", "read", "read-sql", "validate", "write", "write-sql", "audit", "colo", "total",
] as const;
export type ServerTimingMetric = typeof SERVER_TIMING_METRICS[number];

type Clock = () => number;
const defaultClock: Clock = () => performance.now();

export class ServerTiming {
  private readonly durations = new Map<ServerTimingMetric, number>();
  private readonly started: number;
  private flags: string[] = [];

  constructor(private readonly clock: Clock = defaultClock) {
    this.started = this.read() ?? 0;
  }

  private read(): number | undefined {
    try {
      const value = this.clock();
      return Number.isFinite(value) ? value : undefined;
    } catch {
      return undefined;
    }
  }

  /** Adds a duration (ms); negative, non-finite or non-numeric values are ignored. */
  add(metric: ServerTimingMetric, ms: unknown): void {
    if (typeof ms !== "number" || !Number.isFinite(ms) || ms < 0) return;
    this.durations.set(metric, (this.durations.get(metric) ?? 0) + ms);
  }

  /** Times `work` under `metric`, including when it throws. */
  async time<T>(metric: ServerTimingMetric, work: () => Promise<T> | T): Promise<T> {
    const start = this.read();
    try {
      return await work();
    } finally {
      const end = this.read();
      if (start !== undefined && end !== undefined) this.add(metric, end - start);
    }
  }

  /** Adds the SQL execution time D1 reports per statement (`meta.duration`) to `metric`. */
  sql(metric: "auth-sql" | "read-sql" | "write-sql", results: unknown): void {
    if (!Array.isArray(results)) return;
    let total = 0;
    let seen = false;
    for (const result of results as { meta?: { duration?: unknown } }[]) {
      const duration = result?.meta?.duration;
      if (typeof duration === "number" && Number.isFinite(duration) && duration >= 0) { total += duration; seen = true; }
    }
    if (seen) this.add(metric, total);
  }

  /** Marks the first request served by this isolate. */
  cold(): void {
    if (!this.flags.includes("cold")) this.flags.push("cold");
  }

  /** The header value with `total` measured now, in a fixed metric order. */
  header(): string {
    const end = this.read();
    if (end !== undefined) this.durations.set("total", Math.max(0, end - this.started));
    const parts = SERVER_TIMING_METRICS.flatMap((metric) => {
      const value = this.durations.get(metric);
      return value === undefined ? [] : [`${metric};dur=${value.toFixed(1)}`];
    });
    return [...parts, ...this.flags].join(", ");
  }
}

/** Sets Server-Timing on a mutable response; a failure leaves the response untouched. */
export function applyServerTiming(response: Response, timing: ServerTiming): Response {
  try {
    const value = timing.header();
    if (value) response.headers.set("Server-Timing", value);
  } catch {
    // Fail-soft: timing must never break a response.
  }
  return response;
}
