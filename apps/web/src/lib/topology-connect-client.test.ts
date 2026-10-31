import { afterEach, describe, expect, it, vi } from "vitest";
import type { TopologyConnectToken } from "@steed/api/shared";
import { topologyConnectExamples, topologyConnectRequest } from "./topology-connect-client";

afterEach(() => vi.unstubAllGlobals());
describe("topology Connect browser client preparation", () => {
  it("uses the existing same-origin transport and token-version ETag", async () => {
    const fetch = vi.fn().mockImplementation(() => Promise.resolve(new Response(JSON.stringify({ data: { ok: true } }), { headers: { "Content-Type": "application/json" } })));
    vi.stubGlobal("fetch", fetch);
    const token = { id: "fixture", version: 3 } as TopologyConnectToken;
    await expect(topologyConnectRequest("/api/connect/tokens/fixture", { method: "PATCH", body: { name: "Fixture" }, token })).resolves.toEqual({ data: { ok: true } });
    const request = fetch.mock.calls[0]?.[1] as RequestInit;
    expect(new Headers(request.headers).get("If-Match")).toBe('"fixture:3"');
    expect(new Headers(request.headers).get("X-Steed-Request")).toBe("1");
    expect(request.body).toBe(JSON.stringify({ name: "Fixture" }));
    await topologyConnectRequest("/api/connect");
    const read = fetch.mock.calls[1]?.[1] as RequestInit;
    expect(new Headers(read.headers).has("If-Match")).toBe(false);
    expect(read.body).toBeUndefined();
  });
  it("documents the topology endpoint, exact retry and destructive confirmation", () => {
    const examples = topologyConnectExamples("https://fixture.example/api/v1");
    expect(examples.curl).toContain("https://fixture.example/api/v1/topology/operations");
    expect(examples.agent).toContain("X-Steed-Confirm: topology");
    expect(examples.agent).toContain("/requests/{key}");
    expect(examples.agent).not.toContain("/diagrams");
  });
});
