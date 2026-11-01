import { describe, expect, it } from "vitest";
import { applyServerTiming, SERVER_TIMING_METRICS, ServerTiming } from "./server-timing";

const clock = (...values: number[]) => {
  let index = 0;
  return () => values[Math.min(index++, values.length - 1)]!;
};

describe("ServerTiming", () => {
  it("times work in a fixed metric order with one decimal and a total", async () => {
    const timing = new ServerTiming(clock(0, 1, 6.04, 10, 30, 31, 32, 50));
    expect(await timing.time("write", () => "done")).toBe("done");
    await timing.time("auth", async () => undefined);
    await timing.time("auth", () => undefined);
    expect(timing.header()).toBe("auth;dur=21.0, write;dur=5.0, total;dur=50.0");
  });

  it("still records a segment when the work throws", async () => {
    const timing = new ServerTiming(clock(0, 2, 7, 9));
    await expect(timing.time("read", () => { throw new Error("boom"); })).rejects.toThrow("boom");
    expect(timing.header()).toBe("read;dur=5.0, total;dur=9.0");
  });

  it("sums D1 meta.duration and ignores missing or invalid values", () => {
    const timing = new ServerTiming(clock(0, 3));
    timing.sql("write-sql", [{ meta: { duration: 1.25 } }, { meta: {} }, { meta: { duration: -1 } }, null, { meta: { duration: Number.NaN } }, { meta: { duration: 2 } }]);
    timing.sql("read-sql", [{ meta: { duration: "4" } }, {}]);
    timing.sql("auth-sql", "not an array");
    expect(timing.header()).toBe("write-sql;dur=3.3, total;dur=3.0");
  });

  it("ignores invalid durations and appends the cold flag once", () => {
    const timing = new ServerTiming(clock(5, 4));
    for (const value of [-1, Number.POSITIVE_INFINITY, "3", undefined]) timing.add("colo", value);
    timing.cold();
    timing.cold();
    expect(timing.header()).toBe("total;dur=0.0, cold");
  });

  it("is fail-soft when the clock throws or is not finite", async () => {
    const broken = new ServerTiming(() => { throw new Error("no clock"); });
    expect(await broken.time("auth", () => 1)).toBe(1);
    expect(broken.header()).toBe("");
    const nan = new ServerTiming(() => Number.NaN);
    nan.add("read", 2);
    expect(nan.header()).toBe("read;dur=2.0");
    const response = applyServerTiming(new Response("x"), broken);
    expect(response.headers.has("Server-Timing")).toBe(false);
  });

  it("sets the header and never breaks the response on failure", () => {
    const timing = new ServerTiming(clock(0, 4));
    expect(applyServerTiming(new Response("x"), timing).headers.get("Server-Timing")).toBe("total;dur=4.0");
    const throwing = { header: () => { throw new Error("bad"); } } as unknown as ServerTiming;
    const response = new Response("y");
    expect(applyServerTiming(response, throwing)).toBe(response);
    const immutable = Response.redirect("https://example.com/", 302);
    expect(applyServerTiming(immutable, new ServerTiming(clock(0, 1))).status).toBe(302);
  });

  it("uses only fixed lowercase metric names", () => {
    for (const metric of SERVER_TIMING_METRICS) expect(metric).toMatch(/^[a-z]+(-sql)?$/);
    expect(typeof new ServerTiming().header()).toBe("string");
  });
});
