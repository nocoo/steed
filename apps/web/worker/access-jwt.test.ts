import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { isLocalRequest, verifyAccessJwt } from "./access-jwt";

describe("verifyAccessJwt", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it.each([
    "http://localhost:7035",
    "http://127.0.0.1:37035",
    "http://[::1]:37035",
    "https://steed.dev.hexly.ai",
  ])("returns the explicit dev identity for %s", async (origin) => {
    const req = new Request(`${origin}/api/test`);
    const result = await verifyAccessJwt(req, {
      team: "test",
      aud: "test-aud",
      devBypass: true,
    });

    expect(result).toEqual({
      ok: true,
      user: { email: "dev@local", sub: "dev" },
    });
  });

  it.each([
    "https://example.com",
    "https://steed.hexly.ai",
    "http://steed.dev.hexly.ai",
    "https://steed.dev.hexly.ai:7035",
    "https://steed.dev.hexly.ai.attacker.example",
  ])("rejects devBypass for %s", async (origin) => {
    const req = new Request(`${origin}/api/test`);
    const result = await verifyAccessJwt(req, {
      team: "test",
      aud: "test-aud",
      devBypass: true,
    });

    expect(result).toEqual({
      ok: false,
      reason: "Missing Cf-Access-Jwt-Assertion header",
    });
  });

  it("requires Access on the dev domain without an explicit bypass", async () => {
    const result = await verifyAccessJwt(new Request("https://steed.dev.hexly.ai/api/test"), {
      team: "test", aud: "test-aud",
    });
    expect(result.ok).toBe(false);
  });

  it("returns error when JWT header is missing", async () => {
    const req = new Request("https://example.com");
    const result = await verifyAccessJwt(req, {
      team: "test",
      aud: "test-aud",
    });

    expect(result).toEqual({
      ok: false,
      reason: "Missing Cf-Access-Jwt-Assertion header",
    });
  });

  it("returns error when JWT is invalid", async () => {
    const req = new Request("https://example.com", {
      headers: {
        "Cf-Access-Jwt-Assertion": "invalid-jwt",
      },
    });

    globalThis.fetch = vi.fn().mockResolvedValueOnce(
      new Response(JSON.stringify({ keys: [] }), { status: 200 })
    );

    const result = await verifyAccessJwt(req, {
      team: "test-invalid",
      aud: "test-aud",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBeDefined();
    }
  });

  describe("isLocalRequest", () => {
    it.each([
      ["http://localhost:7035", true],
      ["http://127.0.0.1:37035", true],
      ["http://[::1]:37035", true],
      ["https://steed.dev.hexly.ai/api/live", true],
      ["https://example.com", false],
      ["http://steed.dev.hexly.ai", false],
    ])("classifies %s as local=%s", (url, expected) => {
      expect(isLocalRequest(new Request(url))).toBe(expected);
    });
  });

  it("returns error when certificate fetch fails", async () => {
    const req = new Request("https://example.com", {
      headers: { "Cf-Access-Jwt-Assertion": "token" },
    });
    globalThis.fetch = vi.fn().mockResolvedValueOnce(new Response("", { status: 503 }));

    const result = await verifyAccessJwt(req, { team: "cert-fail", aud: "aud" });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain("Failed to fetch certs");
    }
  });

  it("reuses cached certs for repeated verifications", async () => {
    const req = new Request("https://example.com", {
      headers: { "Cf-Access-Jwt-Assertion": "token" },
    });
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ keys: [] }), { status: 200 }),
    );
    globalThis.fetch = fetchMock;

    const opts = { team: "cached-team", aud: "aud" };
    await verifyAccessJwt(req, opts);
    await verifyAccessJwt(req, opts);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("returns error when certs cannot be used", async () => {
    const req = new Request("https://example.com", {
      headers: {
        "Cf-Access-Jwt-Assertion": "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwiZW1haWwiOiJ0ZXN0QHRlc3QuY29tIiwiaWF0IjoxNTE2MjM5MDIyfQ.signature",
      },
    });

    globalThis.fetch = vi.fn().mockResolvedValueOnce(
      new Response(JSON.stringify({ keys: [] }), { status: 200 })
    );

    const result = await verifyAccessJwt(req, {
      team: "test-empty-keys",
      aud: "test-aud",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(typeof result.reason).toBe("string");
    }
  });
});
