import { afterEach, describe, expect, it, vi } from "vitest";
import { AUTHOR_PROFILE_TTL, emailHash, getUserProfile, type ProfileCache, type ProfileFetcher } from "./author-profile";

const host = "steed.example";
const VECTOR = "7ba563171c26fb9b82e9f7750840c0455602eb35025192027230bcb40aae1217";
const PNG = "data:image/png;base64,iVBORw0KGgo=";

function memoryCache() {
  const store = new Map<string, Response>();
  const cache: ProfileCache & { store: Map<string, Response> } = {
    store,
    match: vi.fn(async (key: RequestInfo | URL) => store.get(String(key))?.clone()) as ProfileCache["match"],
    put: vi.fn(async (key: RequestInfo | URL, response: Response) => { store.set(String(key), response); }) as ProfileCache["put"],
  };
  return cache;
}
const fetcherOf = (impl: () => Promise<Response>): ProfileFetcher & { fetch: ReturnType<typeof vi.fn> } => ({ fetch: vi.fn(impl) });
const maxAge = (cache: ReturnType<typeof memoryCache>) => [...cache.store.values()][0]?.headers.get("Cache-Control");

afterEach(() => vi.unstubAllGlobals());

describe("author profile", () => {
  it("hashes the trimmed, lowercased email as sha256 hex", async () => {
    expect(await emailHash("architie@gmail.com")).toBe(VECTOR);
    expect(await emailHash("  Architie@Gmail.COM ")).toBe(VECTOR);
  });

  it("queries the fixed service with the email hash, manual redirects and a timeout", async () => {
    const fetcher = fetcherOf(async () => Response.json({ name: "  Zheng Li  ", avatar: "https://images.example.com/a.png" }));
    const cache = memoryCache();
    const result = await getUserProfile(" Architie@Gmail.com ", { host, fetcher, cache });
    expect(fetcher.fetch).toHaveBeenCalledWith(`https://lizheng.blog/api/authors/profile?hash=${VECTOR}`, {
      headers: { Accept: "application/json" }, redirect: "manual", signal: expect.any(AbortSignal),
    });
    expect(result).toEqual({ email: "architie@gmail.com", name: "Zheng Li", avatar: "https://images.example.com/a.png" });
    expect([...cache.store.keys()]).toEqual([`https://${host}/_author-profiles/v2/${VECTOR}`]);
    expect(maxAge(cache)).toBe(`public, max-age=${AUTHOR_PROFILE_TTL.found}`);
  });

  it("uses an explicit upstream origin when given", async () => {
    const fetcher = fetcherOf(async () => Response.json({ name: null, avatar: null }));
    await getUserProfile("a@b.c", { host, fetcher, cache: memoryCache(), origin: "http://127.0.0.1:9" });
    expect(fetcher.fetch.mock.calls[0]?.[0]).toMatch(/^http:\/\/127\.0\.0\.1:9\/api\/authors\/profile\?hash=/);
  });

  it("serves a cached profile without calling upstream", async () => {
    const cache = memoryCache();
    const first = fetcherOf(async () => Response.json({ name: "Cached", avatar: PNG }));
    await getUserProfile("user@example.com", { host, fetcher: first, cache });
    const second = fetcherOf(async () => Response.json({ name: "Fresh", avatar: null }));
    expect(await getUserProfile("user@example.com", { host, fetcher: second, cache }))
      .toEqual({ email: "user@example.com", name: "Cached", avatar: PNG });
    expect(second.fetch).not.toHaveBeenCalled();
  });

  it("refetches when the cached entry is unreadable", async () => {
    const cache = memoryCache();
    cache.store.set(`https://${host}/_author-profiles/v2/${await emailHash("user@example.com")}`, new Response("not-json"));
    const fetcher = fetcherOf(async () => Response.json({ name: "Fresh", avatar: null }));
    expect((await getUserProfile("user@example.com", { host, fetcher, cache })).name).toBe("Fresh");
  });

  it("caches a known-empty profile for one hour", async () => {
    const cache = memoryCache();
    const result = await getUserProfile("user@example.com", { host, fetcher: fetcherOf(async () => Response.json({ name: null, avatar: null })), cache });
    expect(result).toEqual({ email: "user@example.com", name: "user", avatar: null });
    expect(maxAge(cache)).toBe(`public, max-age=${AUTHOR_PROFILE_TTL.empty}`);
  });

  it.each([
    ["http error", async () => new Response(null, { status: 503 })],
    ["redirect", async () => new Response(null, { status: 302, headers: { Location: "https://elsewhere.example/" } })],
    ["empty body", async () => new Response(null)],
    ["invalid json", async () => new Response("not-json")],
    ["oversized body", async () => new Response("x".repeat(24_577))],
    ["network error", async () => { throw new TypeError("network"); }],
    ["timeout", async () => { throw new DOMException("timed out", "TimeoutError"); }],
    ["non-error throw", async () => { throw "boom"; }],
  ])("falls back and caches the failure for five minutes (%s)", async (_label, impl) => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const cache = memoryCache();
    expect(await getUserProfile("user@example.com", { host, fetcher: fetcherOf(impl as () => Promise<Response>), cache }))
      .toEqual({ email: "user@example.com", name: "user", avatar: null });
    expect(maxAge(cache)).toBe(`public, max-age=${AUTHOR_PROFILE_TTL.failure}`);
  });

  it.each([
    Response.json(null),
    Response.json([1]),
    Response.json({ name: "", avatar: "javascript:alert(1)" }),
    Response.json({ name: 5, avatar: "http://example.com/avatar" }),
    Response.json({ name: " ", avatar: "https://user:pass@example.com/a.png" }),
    Response.json({ name: null, avatar: "data:image/svg+xml;base64,PHN2Zz4=" }),
  ])("drops invalid fields and keeps the identity usable", async (response) => {
    expect(await getUserProfile("user@example.com", { host, fetcher: fetcherOf(async () => response), cache: memoryCache() }))
      .toEqual({ email: "user@example.com", name: "user", avatar: null });
  });

  it("does not query the service for identities without an email", async () => {
    const fetcher = fetcherOf(async () => Response.json({}));
    expect(await getUserProfile("  ", { host, fetcher })).toEqual({ email: null, name: "User", avatar: null });
    expect(fetcher.fetch).not.toHaveBeenCalled();
  });

  it("survives cache read and write failures", async () => {
    const cache: ProfileCache = { match: vi.fn().mockRejectedValue(new Error("r")), put: vi.fn().mockRejectedValue(new Error("w")) };
    expect((await getUserProfile("user@example.com", { host, fetcher: fetcherOf(async () => Response.json({ name: "Ok", avatar: null })), cache })).name).toBe("Ok");
  });

  it("decodes multibyte names across response chunks", async () => {
    const data = new TextEncoder().encode(JSON.stringify({ name: "用户", avatar: null }));
    const response = new Response(new ReadableStream({
      start(controller) { for (const byte of data) controller.enqueue(new Uint8Array([byte])); controller.close(); },
    }));
    expect(await getUserProfile("user@example.com", { host, fetcher: fetcherOf(async () => response), cache: memoryCache() }))
      .toMatchObject({ name: "用户" });
  });

  it("defaults to caches.default and a wrapped global fetch", async () => {
    const cache = memoryCache();
    const globalFetch = vi.fn(async function (this: unknown) {
      // A bare `fetch` reference would be invoked with a foreign receiver in Workers.
      expect(this).toBeUndefined();
      return Response.json({ name: "Global", avatar: null });
    });
    vi.stubGlobal("caches", { default: cache });
    vi.stubGlobal("fetch", globalFetch);
    expect((await getUserProfile("user@example.com", { host })).name).toBe("Global");
    expect(globalFetch).toHaveBeenCalledOnce();
    expect(cache.store.size).toBe(1);
  });
});
