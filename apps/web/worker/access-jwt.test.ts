import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { verifyAccessJwt, type VerifyResult } from "./access-jwt";

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
