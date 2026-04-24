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

  it("returns dev user when devBypass is true and request is from localhost", async () => {
    const req = new Request("http://localhost:5173/api/test");
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

  it("ignores devBypass when request is not from localhost", async () => {
    const req = new Request("https://example.com/api/test");
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
