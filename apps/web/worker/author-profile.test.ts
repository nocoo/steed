import { describe, expect, it, vi } from "vitest";
import { getUserProfile } from "./author-profile";

describe("author profile", () => {
  it("queries the fixed service with a normalized email hash only", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({
      name: "  Example User  ", avatar: "https://images.example.com/avatar.png",
    }));
    const result = await getUserProfile(" User@Example.com ", fetcher);
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest(
      "SHA-256", new TextEncoder().encode("user@example.com")
    )), (b) => b.toString(16).padStart(2, "0")).join("");
    expect(fetcher).toHaveBeenCalledWith(
      `https://lizheng.blog/api/authors/profile?hash=${hash}`,
      { signal: expect.any(AbortSignal), redirect: "error" }
    );
    expect(result).toEqual({
      email: "user@example.com", name: "Example User", avatar: "https://images.example.com/avatar.png",
    });
  });

  it("does not query the service for identities without an email", async () => {
    const fetcher = vi.fn();
    expect(await getUserProfile("", fetcher)).toEqual({ email: null, name: "User", avatar: null });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([
    new Response(null, { status: 503 }),
    new Response(null),
    new Response("not-json"),
    Response.json(null),
    Response.json({ name: "", avatar: "javascript:alert(1)" }),
    Response.json({ name: 5, avatar: "http://example.com/avatar" }),
    Response.json({ name: null, avatar: null }),
    new Response("x".repeat(8193)),
  ])("keeps identity usable after an invalid or unavailable profile", async (response) => {
    expect(await getUserProfile("user@example.com", vi.fn().mockResolvedValue(response))).toEqual({
      email: "user@example.com", name: "user", avatar: null,
    });
  });

  it("falls back after network/timeout failures", async () => {
    expect(await getUserProfile("user@example.com", vi.fn().mockRejectedValue(new Error("timeout"))))
      .toMatchObject({ name: "user", avatar: null });
  });

  it("decodes multibyte names across response chunks", async () => {
    const data = new TextEncoder().encode(JSON.stringify({ name: "用户", avatar: null }));
    const response = new Response(new ReadableStream({
      start(controller) {
        for (const byte of data) controller.enqueue(new Uint8Array([byte]));
        controller.close();
      },
    }));
    expect(await getUserProfile("user@example.com", vi.fn().mockResolvedValue(response)))
      .toMatchObject({ name: "用户" });
  });
});
