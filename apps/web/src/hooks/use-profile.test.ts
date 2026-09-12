import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useProfile } from "./use-profile";

afterEach(() => vi.unstubAllGlobals());

describe("useProfile", () => {
  it("loads the verified profile without caching it in browser storage", async () => {
    const profile = { email: "user@example.com", name: "User Name", avatar: "https://example.com/a.png" };
    const fetcher = vi.fn().mockResolvedValue(Response.json(profile));
    vi.stubGlobal("fetch", fetcher);
    const { result } = renderHook(useProfile);
    await waitFor(() => expect(result.current).toEqual(profile));
    expect(fetcher).toHaveBeenCalledWith("/api/me", {
      signal: expect.any(AbortSignal), credentials: "same-origin", cache: "no-store", redirect: "error",
    });
    expect(localStorage.length).toBe(0);
  });

  it.each([new Response(null, { status: 401 }), Response.json({ avatar: "javascript:bad" })])(
    "keeps the fallback for unauthorized or invalid responses", async (response) => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
      const { result } = renderHook(useProfile);
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
      expect(result.current).toBeNull();
    }
  );

  it("keeps the fallback on network failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    const { result } = renderHook(useProfile);
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    expect(result.current).toBeNull();
  });

  it("ignores a late response after unmount", async () => {
    let finish!: (response: Response) => void;
    const fetcher = vi.fn().mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    vi.stubGlobal("fetch", fetcher);
    const { result, unmount } = renderHook(useProfile);
    const signal = fetcher.mock.calls[0]?.[1].signal as AbortSignal;
    unmount();
    expect(signal.aborted).toBe(true);
    await act(async () => { finish(Response.json({ name: "Late", email: null, avatar: null })); });
    expect(result.current).toBeNull();
  });
});
