import { afterEach, describe, expect, it, vi } from "vitest";
import type { ConnectToken } from "@steed/api/shared";
import { connectDate, connectExamples, connectRequest, tokenStatus } from "./connect-client";

const token: ConnectToken = { id: "agent", name: "Agent", diagramId: null, scope: "read", prefix: "steedc_prefix…", version: 4,
  createdAt: "2026-09-12T00:00:00Z", expiresAt: null, lastUsedAt: null, revokedAt: null };
afterEach(() => vi.unstubAllGlobals());

describe("Connect client", () => {
  it("uses same-origin management with token-version preconditions and no credentials in URLs", async () => {
    const fetcher = vi.fn().mockImplementation(async () => Response.json({ data: token }));
    vi.stubGlobal("fetch", fetcher);
    await connectRequest("/api/connect");
    const signal = new AbortController().signal;
    await connectRequest("/api/connect/tokens/agent", { method: "PATCH", body: { name: "Updated" }, token, signal });
    expect(fetcher.mock.calls[0]?.[1].headers.has("If-Match")).toBe(false);
    const request = fetcher.mock.calls[1]?.[1];
    expect(request.headers.get("If-Match")).toBe('"agent:4"');
    expect(request.headers.get("X-Steed-Request")).toBe("1");
    expect(request.headers.has("Authorization")).toBe(false);
    expect(request).toMatchObject({ method: "PATCH", body: '{"name":"Updated"}', signal, credentials: "same-origin", cache: "no-store", redirect: "error" });
  });

  it("gives revocation precedence over expiry and treats the exact expiry instant as expired", () => {
    const expiresAt = "2026-09-12T12:00:00Z";
    const now = Date.parse(expiresAt);
    expect(tokenStatus(token)).toBe("Active");
    expect(tokenStatus({ ...token, expiresAt }, now - 1)).toBe("Active");
    expect(tokenStatus({ ...token, expiresAt }, now)).toBe("Expired");
    expect(tokenStatus({ ...token, expiresAt, revokedAt: expiresAt }, now)).toBe("Revoked");
    expect(connectDate(null)).toBe("Never used");
    expect(connectDate(expiresAt)).not.toBe("Never used");
  });

  it("publishes scoped agent instructions with placeholders, retry discipline and destructive confirmation", () => {
    const all = connectExamples("https://steed.example/api/v1", "");
    expect(all.curl).toContain('"$STEED_TOKEN"');
    expect(all.curl).toContain("--header @-");
    expect(all.curl).toContain("/diagrams/DIAGRAM_ID");
    expect(all.curl).toContain('"If-Match: $ETAG"');
    expect(all.agent).toContain("List /diagrams");
    expect(all.agent).toContain("/requests/{key}");
    const bound = connectExamples("http://localhost/api/v1", "network");
    expect(bound.agent).toContain("Operate only on diagram network.");
    expect(bound.agent).toContain("X-Steed-Confirm: network");
    expect(bound.curl).toContain("/diagrams/network/operations");
    expect(JSON.stringify(bound)).not.toContain("steedc_");
  });
});
