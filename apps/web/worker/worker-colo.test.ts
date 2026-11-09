import { describe, expect, it, vi } from "vitest";
import { coloLookup, TRACE_RETRY_MS, TRACE_TIMEOUT_MS, TRACE_URL, traceColo, type TraceFetcher } from "./worker-colo";

const TRACE = "fl=1f1\nh=www.cloudflare.com\nip=203.0.113.9\nts=1.0\nvisit_scheme=https\nuag=workerd\ncolo=NRT\nhttp=http/1.1\nloc=JP\ntls=TLSv1.3\n";
const fetcherOf = (impl: () => Promise<Response>): TraceFetcher & { fetch: ReturnType<typeof vi.fn> } => ({ fetch: vi.fn(impl) });

describe("traceColo", () => {
  it("reads the colo line with a manual redirect and a short timeout", async () => {
    const fetcher = fetcherOf(async () => new Response(TRACE));
    expect(await traceColo(TRACE_URL, fetcher)).toBe("NRT");
    const [url, init] = fetcher.fetch.mock.calls[0] as [string, RequestInit];
    expect([url, init.redirect, init.signal instanceof AbortSignal, TRACE_TIMEOUT_MS <= 1000]).toEqual([TRACE_URL, "manual", true, true]);
  });

  it("is null for redirects, errors, timeouts, oversize and malformed bodies", async () => {
    const cases: (() => Promise<Response>)[] = [
      async () => new Response(null, { status: 302, headers: { Location: "https://elsewhere.example" } }),
      async () => new Response("colo=NRT", { status: 503 }),
      async () => { throw new DOMException("timed out", "TimeoutError"); },
      async () => new Response(`colo=NRT\n${"x".repeat(5000)}`),
      async () => new Response("colo=nrt\n"),
      async () => new Response("colo=NRT1\nxcolo=IAD\n"),
      async () => new Response(""),
    ];
    for (const impl of cases) expect(await traceColo(TRACE_URL, fetcherOf(impl))).toBeNull();
  });

  it("calls the global fetch through a wrapper by default", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(TRACE));
    try {
      expect(await traceColo("https://trace.test/cdn-cgi/trace")).toBe("NRT");
      expect(spy.mock.calls[0]?.[0]).toBe("https://trace.test/cdn-cgi/trace");
    } finally {
      spy.mockRestore();
    }
  });
});

describe("coloLookup", () => {
  it("keeps a found colo for the life of the isolate", async () => {
    const fetcher = fetcherOf(async () => new Response(TRACE));
    const lookup = coloLookup(fetcher);
    expect([await lookup(TRACE_URL), await lookup(TRACE_URL)]).toEqual(["NRT", "NRT"]);
    expect(fetcher.fetch).toHaveBeenCalledTimes(1);
  });

  it("caches a failure for the retry window, then looks up again", async () => {
    let clock = 1_000;
    const fetcher = fetcherOf(async () => new Response(null, { status: 500 }));
    const lookup = coloLookup(fetcher, () => clock);
    expect(await lookup(TRACE_URL)).toBeNull();
    clock += TRACE_RETRY_MS - 1;
    expect(await lookup(TRACE_URL)).toBeNull();
    expect(fetcher.fetch).toHaveBeenCalledTimes(1);
    clock += 1;
    fetcher.fetch.mockImplementation(async () => new Response(TRACE));
    expect(await lookup(TRACE_URL)).toBe("NRT");
    expect(fetcher.fetch).toHaveBeenCalledTimes(2);
  });
});
