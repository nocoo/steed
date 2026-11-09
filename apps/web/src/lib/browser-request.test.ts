import { afterEach, describe, expect, it, vi } from "vitest";
import { browserRequest } from "./browser-request";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("browser request transport", () => {
  it("preserves browser fetch defaults and existing headers", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ data: "ok" }));
    vi.stubGlobal("fetch", fetcher);
    const signal = new AbortController().signal;

    await expect(browserRequest<{ data: string }>("/api/example", {
      method: "POST",
      body: '{"name":"Fixture"}',
      signal,
      headers: { "If-Match": '"example:2"' },
    })).resolves.toEqual({ data: "ok" });

    const [path, init] = fetcher.mock.calls[0]!;
    expect(path).toBe("/api/example");
    expect(init).toMatchObject({ method: "POST", body: '{"name":"Fixture"}', signal, credentials: "same-origin", cache: "no-store", redirect: "error" });
    expect(init.headers.get("X-Steed-Request")).toBe("1");
    expect(init.headers.get("Content-Type")).toBe("application/json");
    expect(init.headers.get("If-Match")).toBe('"example:2"');
  });

  it("returns undefined for 204 responses", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 204 })));
    await expect(browserRequest<undefined>("/api/example", { method: "DELETE" })).resolves.toBeUndefined();
  });

  it("formats validation issues, preserves concurrency messages, and falls back for generic errors", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(Response.json({ error: { message: "Invalid", issues: [{ path: ["nodes", 0, "id"], message: "Duplicate" }] } }, { status: 422 }))
      .mockResolvedValueOnce(Response.json({ error: { message: "Changed remotely" } }, { status: 412 }))
      .mockResolvedValueOnce(Response.json({}, { status: 500 })));

    await expect(browserRequest("/api/example")).rejects.toThrow("nodes.0.id: Duplicate");
    await expect(browserRequest("/api/example")).rejects.toThrow("Changed remotely");
    await expect(browserRequest("/api/example")).rejects.toThrow("Request failed (500).");
  });

  it("does not add a content type for bodyless requests", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ data: [] }));
    vi.stubGlobal("fetch", fetcher);
    await browserRequest("/api/example");
    expect(fetcher.mock.calls[0]?.[1].headers.has("Content-Type")).toBe(false);
  });
});
