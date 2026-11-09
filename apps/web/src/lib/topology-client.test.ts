import { afterEach, describe, expect, it, vi } from "vitest";
import { emptyTopology, type Topology } from "@steed/api/shared";
import { createTopologyClient, downloadTopology } from "./topology-client";

const topology = (): Topology => ({ ...emptyTopology("Fixture topology"), revision: 3 });

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (cause: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("topology client", () => {
  it("preserves topology HTTP errors, validation issues, and generic fallbacks", async () => {
    const issues = createTopologyClient(async () => Response.json({ error: { message: "Invalid topology", issues: [{ path: ["nodes", 0, "id"], message: "Duplicate" }] } }, { status: 422 }));
    await expect(issues.get()).rejects.toThrow("nodes.0.id: Duplicate");
    const message = createTopologyClient(async () => Response.json({ error: { message: "Resync required" } }, { status: 410 }));
    await expect(message.get()).rejects.toThrow("Resync required");
    const generic = createTopologyClient(async () => Response.json({}, { status: 503 }));
    await expect(generic.get()).rejects.toThrow("Request failed (503).");
  });

  it("caches snapshots in memory by ETag and returns the cached snapshot on 304", async () => {
    const snapshot = topology();
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: snapshot, updatedAt: "2026-10-31T00:00:00.000Z", requestId: "request-1" }), {
        status: 200,
        headers: { ETag: '"topology:3"', "Content-Type": "application/json" },
      }))
      .mockResolvedValueOnce(new Response(null, { status: 304, headers: { ETag: '"topology:3"' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { ...snapshot, title: "Changed", revision: 4 }, updatedAt: "2026-10-31T00:01:00.000Z" }), {
        status: 200,
        headers: { ETag: '"topology:4"', "Content-Type": "application/json" },
      }))
      .mockResolvedValueOnce(new Response(null, { status: 304, headers: { ETag: '"topology:4"' } }));
    const client = createTopologyClient(fetcher);

    const first = await client.get();
    expect(first.data.title).toBe("Fixture topology");
    const firstRequest = fetcher.mock.calls[0]?.[1];
    expect(firstRequest?.headers.get("X-Steed-Request")).toBe("1");
    expect(firstRequest?.headers.has("If-None-Match")).toBe(false);
    expect(firstRequest).toMatchObject({ credentials: "same-origin", cache: "no-store", redirect: "error" });

    const second = await client.get(new AbortController().signal);
    expect(second).toBe(first);
    expect(fetcher.mock.calls[1]?.[1]?.headers.get("If-None-Match")).toBe('"topology:3"');

    await client.get();
    const fourth = await client.get();
    expect(fourth.data.title).toBe("Changed");
    expect(fetcher.mock.calls[3]?.[1]?.headers.get("If-None-Match")).toBe('"topology:4"');

    client.clearCache();
    await expect(createTopologyClient(async () => new Response(null, { status: 304 })).get()).rejects.toThrow("no snapshot is cached");
  });

  it("binds an overlapping 304 to the snapshot and ETag sent by its request", async () => {
    const snapshot = topology();
    const newer = { ...snapshot, title: "Newer snapshot", revision: 4 };
    const first = deferred<Response>();
    const second = deferred<Response>();
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: snapshot, updatedAt: "2026-10-31T00:00:00.000Z" }), {
        status: 200,
        headers: { ETag: '"topology:3"', "Content-Type": "application/json" },
      }))
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise)
      .mockResolvedValueOnce(new Response(null, { status: 304, headers: { ETag: '"topology:4"' } }));
    const client = createTopologyClient(fetcher);
    await client.get();

    const olderGet = client.get();
    const newerGet = client.get();
    expect(fetcher.mock.calls[1]?.[1]?.headers.get("If-None-Match")).toBe('"topology:3"');
    expect(fetcher.mock.calls[2]?.[1]?.headers.get("If-None-Match")).toBe('"topology:3"');

    second.resolve(new Response(JSON.stringify({ data: newer, updatedAt: "2026-10-31T00:01:00.000Z" }), {
      status: 200,
      headers: { ETag: '"topology:4"', "Content-Type": "application/json" },
    }));
    await expect(newerGet).resolves.toMatchObject({ data: { title: "Newer snapshot", revision: 4 } });

    first.resolve(new Response(null, { status: 304, headers: { ETag: '"topology:3"' } }));
    await expect(olderGet).resolves.toMatchObject({ data: { title: "Fixture topology", revision: 3 } });

    await expect(client.get()).resolves.toMatchObject({ data: { title: "Newer snapshot", revision: 4 } });
    expect(fetcher.mock.calls[3]?.[1]?.headers.get("If-None-Match")).toBe('"topology:4"');
  });

  it("does not let a delayed older 200 replace a newer cached snapshot", async () => {
    const snapshot = topology();
    const newer = { ...snapshot, title: "Newest snapshot", revision: 4 };
    const older = deferred<Response>();
    const newerResponse = deferred<Response>();
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: snapshot, updatedAt: "2026-10-31T00:00:00.000Z" }), {
        status: 200,
        headers: { ETag: '"topology:3"', "Content-Type": "application/json" },
      }))
      .mockImplementationOnce(() => older.promise)
      .mockImplementationOnce(() => newerResponse.promise)
      .mockResolvedValueOnce(new Response(null, { status: 304, headers: { ETag: '"topology:4"' } }));
    const client = createTopologyClient(fetcher);
    await client.get();

    const oldGet = client.get();
    const newGet = client.get();
    newerResponse.resolve(new Response(JSON.stringify({ data: newer, updatedAt: "2026-10-31T00:02:00.000Z" }), {
      status: 200,
      headers: { ETag: '"topology:4"', "Content-Type": "application/json" },
    }));
    await expect(newGet).resolves.toMatchObject({ data: { revision: 4 } });

    older.resolve(new Response(JSON.stringify({ data: snapshot, updatedAt: "2026-10-31T00:01:00.000Z" }), {
      status: 200,
      headers: { ETag: '"topology:3"', "Content-Type": "application/json" },
    }));
    await expect(oldGet).resolves.toMatchObject({ data: { revision: 3 } });

    await expect(client.get()).resolves.toMatchObject({ data: { title: "Newest snapshot", revision: 4 } });
    expect(fetcher.mock.calls[3]?.[1]?.headers.get("If-None-Match")).toBe('"topology:4"');
  });

  it("rejects a mismatched 304 and does not repopulate a cache cleared during its request", async () => {
    const snapshot = topology();
    const inflight = deferred<Response>();
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: snapshot, updatedAt: "2026-10-31T00:00:00.000Z" }), {
        status: 200,
        headers: { ETag: '"topology:3"', "Content-Type": "application/json" },
      }))
      .mockImplementationOnce(() => inflight.promise)
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: snapshot, updatedAt: "2026-10-31T00:03:00.000Z" }), {
        status: 200,
        headers: { ETag: '"topology:3"', "Content-Type": "application/json" },
      }));
    const client = createTopologyClient(fetcher);
    await client.get();

    const request = client.get();
    client.clearCache();
    inflight.resolve(new Response(null, { status: 304, headers: { ETag: '"topology:4"' } }));
    await expect(request).rejects.toThrow("304 ETag does not match");

    const clearedRequest = client.get();
    await expect(clearedRequest).resolves.toMatchObject({ data: { revision: 3 } });
    expect(fetcher.mock.calls[2]?.[1]?.headers.has("If-None-Match")).toBe(false);
  });

  it("returns the request-bound snapshot for a 304 after clearCache without repopulating the cache", async () => {
    const snapshot = topology();
    const inflight = deferred<Response>();
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: snapshot, updatedAt: "2026-10-31T00:00:00.000Z" }), {
        status: 200,
        headers: { ETag: '"topology:3"', "Content-Type": "application/json" },
      }))
      .mockImplementationOnce(() => inflight.promise)
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { ...snapshot, title: "Fresh after clear", revision: 4 }, updatedAt: "2026-10-31T00:04:00.000Z" }), {
        status: 200,
        headers: { ETag: '"topology:4"', "Content-Type": "application/json" },
      }));
    const client = createTopologyClient(fetcher);
    await client.get();

    const request = client.get();
    client.clearCache();
    inflight.resolve(new Response(null, { status: 304, headers: { ETag: '"topology:3"' } }));
    await expect(request).resolves.toMatchObject({ data: { title: "Fixture topology", revision: 3 } });

    await expect(client.get()).resolves.toMatchObject({ data: { title: "Fresh after clear", revision: 4 } });
    expect(fetcher.mock.calls[2]?.[1]?.headers.has("If-None-Match")).toBe(false);
  });

  it("accepts signal options and does not cache a successful response without an ETag", async () => {
    const snapshot = topology();
    const withoutEtag = createTopologyClient(async () => Response.json({ data: snapshot, updatedAt: "2026-10-31T00:00:00.000Z" }));
    await expect(withoutEtag.get({ signal: new AbortController().signal })).resolves.toMatchObject({ data: { revision: 3 }, updatedAt: "2026-10-31T00:00:00.000Z" });
    await expect(withoutEtag.get()).resolves.toMatchObject({ data: { revision: 3 } });
  });

  it("exports one complete topology JSON download and clears its object URL", () => {
    const createObjectURL = vi.fn().mockReturnValue("blob:topology");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL, revokeObjectURL }));
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);

    downloadTopology({ ...topology(), title: "Provider / home" }, "fixture.json");
    expect(createObjectURL.mock.calls[0]?.[0].type).toBe("application/json");
    expect(click.mock.instances[0]?.download).toBe("fixture.json");
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:topology");

    downloadTopology({ ...topology(), title: "" });
    expect(click.mock.instances[1]?.download).toBe("topology.json");
  });
});
