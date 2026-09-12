import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ConnectToken, DiagramSummary } from "@steed/api/shared";
import { useConnectViewModel } from "../use-connect-viewmodel";

const request = vi.hoisted(() => vi.fn());
vi.mock("@/lib/connect-client", async (original) => ({ ...await original<object>(), connectRequest: request }));
const token: ConnectToken = { id: "agent", name: "Assistant", diagramId: null, scope: "read", prefix: "prefix…", version: 1,
  createdAt: "2026-09-12T00:00:00Z", expiresAt: null, lastUsedAt: null, revokedAt: null };
const diagram: DiagramSummary = { id: "network", title: "Network", description: "", revision: 1, nodeCount: 3, edgeCount: 2,
  createdAt: token.createdAt, updatedAt: token.createdAt };
let tokens: ConnectToken[];
let hidden = false;
const clipboard = vi.fn();
type Options = { method?: string; body?: unknown; signal?: AbortSignal; token?: ConnectToken };
function respond(path: string, options: Options = {}) {
  if (path === "/api/connect") return { data: { apiBaseUrl: "https://steed.example/api/v1" } };
  if (options.method) return { data: path.endsWith("/challenge") ? { challenge: "proof" } : path.endsWith("/reveal") ? { token: "test-only-secret" } : {} };
  if (path.startsWith("/api/connect/diagrams")) return { data: [diagram], nextCursor: null };
  if (path.startsWith("/api/connect/tokens")) return { data: tokens, nextCursor: null };
  return { data: [], nextCursor: null };
}
function deferred<T = unknown>() {
  let resolve!: (value: T) => void;
  let reject!: (cause: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
async function setup() {
  const view = renderHook(useConnectViewModel);
  await waitFor(() => expect(view.result.current.loading).toBe(false));
  return view;
}
async function reveal(view: Awaited<ReturnType<typeof setup>>) {
  act(() => view.result.current.openAction(token, "reveal"));
  act(() => view.result.current.setConfirmation(token.name));
  await act(() => view.result.current.confirmAction());
}
beforeEach(() => {
  vi.resetAllMocks(); tokens = [token]; hidden = false;
  request.mockImplementation(async (path: string, options?: Options) => respond(path, options));
  vi.spyOn(document, "hidden", "get").mockImplementation(() => hidden);
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: clipboard } });
  clipboard.mockResolvedValue(undefined);
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe("Connect view model", () => {
  it("loads every diagram/token page and isolates state when the target changes", async () => {
    request.mockImplementation(async (path: string, options?: Options) => {
      if (path.startsWith("/api/connect/diagrams")) return path.includes("cursor=network")
        ? { data: [{ ...diagram, id: "other" }], nextCursor: null } : { data: [diagram], nextCursor: "network" };
      if (path.startsWith("/api/connect/tokens")) return path.includes("cursor=agent")
        ? { data: [{ ...token, id: "second" }], nextCursor: null } : { data: [token], nextCursor: "agent" };
      return respond(path, options);
    });
    const { result } = await setup();
    expect(result.current.diagrams).toHaveLength(2); expect(result.current.tokens).toHaveLength(2);
    expect(result.current.baseUrl).toBe("https://steed.example/api/v1");
    act(() => result.current.openAction(token, "rename"));
    act(() => result.current.changeTarget("network"));
    expect(result.current.action).toBeNull(); expect(result.current.tokens).toEqual([]);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(request.mock.calls.some(([path]) => path.includes("tokens?diagramId=network&limit=100"))).toBe(true);
  });

  it.each([new Error("Denied"), "not-an-error"])("reports load errors and recovers on refresh", async (cause) => {
    request.mockRejectedValueOnce(cause);
    const { result } = await setup();
    expect(result.current.error).toBe(cause instanceof Error ? cause.message : "Connect is unavailable.");
    act(() => result.current.reload());
    await waitFor(() => expect(result.current.tokens).toHaveLength(1));
    expect(result.current.error).toBe("");
  });

  it.each([false, true])("ignores an aborted target load, including delayed rejection (%s)", async (fail) => {
    const pending = deferred();
    request.mockImplementationOnce(() => pending.promise);
    const view = renderHook(useConnectViewModel);
    const signal = request.mock.calls[0]?.[1].signal as AbortSignal;
    act(() => view.result.current.changeTarget("network"));
    await waitFor(() => expect(view.result.current.loading).toBe(false));
    expect(signal.aborted).toBe(true);
    await act(async () => { if (fail) pending.reject(new Error("Old failure")); else pending.resolve({ data: { apiBaseUrl: "https://stale.example" } }); });
    expect(view.result.current.baseUrl).toBe("https://steed.example/api/v1");
    expect(view.result.current.error).toBe("");
  });

  it("creates metadata with the chosen scope and expiry, without revealing or writing browser storage", async () => {
    const store = vi.spyOn(Storage.prototype, "setItem");
    const { result } = await setup();
    act(() => { result.current.changeTarget("network"); result.current.openCreate(); result.current.setName(" Agent "); result.current.setScope("write"); result.current.setExpiry("2099-01-01T12:00"); });
    await act(() => result.current.create());
    expect(request).toHaveBeenCalledWith("/api/connect/tokens", { method: "POST", body: { name: "Agent", scope: "write", diagramId: "network", expiresAt: new Date("2099-01-01T12:00").toISOString() } });
    expect(result.current.creating).toBe(false); expect(result.current.name).toBe(""); expect(result.current.expiry).toBe(""); expect(result.current.scope).toBe("read");
    expect(result.current.secret).toBeNull(); expect(result.current.notice).toContain("Token created.");
    expect(clipboard).not.toHaveBeenCalled(); expect(store).not.toHaveBeenCalled();
  });

  it("keeps successful creation visible after window blur so it is not accidentally repeated", async () => {
    const view = await setup(); const pending = deferred();
    request.mockImplementation(async (path: string, options?: Options) => options?.method === "POST" ? pending.promise : respond(path, options));
    act(() => { view.result.current.openCreate(); view.result.current.setName("Agent"); });
    let creating!: Promise<void>;
    act(() => { creating = view.result.current.create(); });
    expect(view.result.current.busy).toBe(true);
    act(() => window.dispatchEvent(new Event("blur")));
    await act(async () => { pending.resolve({ data: token }); await creating; });
    expect(view.result.current.notice).toContain("Token created.");
    expect(view.result.current.busy).toBe(false);
  });

  it.each(["target", "unmount"])("does not apply a delayed creation result after %s", async (boundary) => {
    const view = await setup(); const pending = deferred();
    request.mockImplementation(async (path: string, options?: Options) => options?.method === "POST" ? pending.promise : respond(path, options));
    act(() => view.result.current.setName("Agent"));
    let creating!: Promise<void>; act(() => { creating = view.result.current.create(); });
    act(() => { if (boundary === "target") view.result.current.changeTarget("network"); else view.unmount(); });
    await act(async () => { pending.resolve({ data: token }); await creating; });
    expect(view.result.current.notice).toBe("");
  });

  it.each([new Error("No token slots"), "unknown"])("preserves the create form on server failure", async (cause) => {
    const { result } = await setup();
    request.mockImplementation(async (path: string, options?: Options) => { if (options?.method === "POST") throw cause; return respond(path, options); });
    act(() => { result.current.openCreate(); result.current.setName("Agent"); });
    await act(() => result.current.create());
    expect(result.current.name).toBe("Agent"); expect(result.current.creating).toBe(true); expect(result.current.busy).toBe(false);
    expect(result.current.error).toBe(cause instanceof Error ? cause.message : "Token creation failed.");
  });

  it("validates create fields before any mutation", async () => {
    const { result } = await setup();
    act(() => result.current.setExpiry("invalid"));
    await act(() => result.current.create());
    expect(result.current.error).not.toBe("");
    expect(request.mock.calls.every(([, options]) => !options?.method)).toBe(true);
  });

  it("renames, reveals, rotates and revokes against the token version and exact confirmation", async () => {
    const { result } = await setup();
    await act(() => result.current.confirmAction());
    for (const kind of ["rename", "reveal", "rotate", "revoke"] as const) {
      act(() => result.current.openAction(token, kind));
      expect(result.current.confirmation).toBe(kind === "rename" ? token.name : "");
      act(() => result.current.setConfirmation(kind === "rename" ? "Renamed" : token.name));
      await act(() => result.current.confirmAction());
      if (kind === "rename") expect(request).toHaveBeenCalledWith("/api/connect/tokens/agent", { method: "PATCH", body: { name: "Renamed" }, token });
      else {
        expect(request).toHaveBeenCalledWith("/api/connect/tokens/agent/challenge", { method: "POST", body: { action: kind }, token });
        expect(request).toHaveBeenCalledWith(`/api/connect/tokens/agent/${kind}`, { method: "POST", body: { challenge: "proof", confirmation: token.name }, token });
      }
      expect(result.current.action).toBeNull(); expect(result.current.busy).toBe(false);
      expect(result.current.secret?.value ?? null).toBe(kind === "reveal" ? "test-only-secret" : null);
    }
    expect(clipboard).not.toHaveBeenCalled();
  });

  it.each([new Error("Token changed"), "unknown"])("keeps a failed token action open for correction", async (cause) => {
    const { result } = await setup();
    request.mockImplementation(async (path: string, options?: Options) => { if (options?.method) throw cause; return respond(path, options); });
    act(() => result.current.openAction(token, "reveal"));
    await act(() => result.current.confirmAction());
    expect(result.current.action?.kind).toBe("reveal"); expect(result.current.busy).toBe(false);
    expect(result.current.error).toBe(cause instanceof Error ? cause.message : "The action failed. Refresh before retrying.");
  });

  it.each(["blur", "hidden", "target", "cancel", "create", "action", "unmount"])("discards a delayed reveal after %s", async (boundary) => {
    const view = await setup(); const pending = deferred();
    request.mockImplementation(async (path: string, options?: Options) => path.endsWith("/reveal") ? pending.promise : respond(path, options));
    act(() => view.result.current.openAction(token, "reveal"));
    let revealing!: Promise<void>; act(() => { revealing = view.result.current.confirmAction(); });
    await waitFor(() => expect(request.mock.calls.some(([path]) => path.endsWith("/reveal"))).toBe(true));
    act(() => {
      if (boundary === "blur") window.dispatchEvent(new Event("blur"));
      if (boundary === "hidden") { hidden = true; document.dispatchEvent(new Event("visibilitychange")); }
      if (boundary === "target") view.result.current.changeTarget("network");
      if (boundary === "cancel") view.result.current.closeAction();
      if (boundary === "create") view.result.current.openCreate();
      if (boundary === "action") view.result.current.openAction(token, "rename");
      if (boundary === "unmount") view.unmount();
    });
    await act(async () => { pending.resolve({ data: { token: "test-only-secret" } }); await revealing; });
    expect(view.result.current.secret).toBeNull(); expect(view.result.current.notice).not.toContain("Key revealed");
  });

  it("does not send the sensitive request when a challenge finishes after cancellation", async () => {
    const view = await setup(); const pending = deferred();
    request.mockImplementation(async (path: string, options?: Options) => path.endsWith("/challenge") ? pending.promise : respond(path, options));
    act(() => view.result.current.openAction(token, "rotate"));
    let rotating!: Promise<void>; act(() => { rotating = view.result.current.confirmAction(); });
    act(() => view.result.current.closeAction());
    await act(async () => { pending.resolve({ data: { challenge: "proof" } }); await rotating; });
    expect(request.mock.calls.some(([path]) => path.endsWith("/rotate"))).toBe(false);
  });

  it("hides a revealed key after 30 seconds without extending visibility on rerender", async () => {
    const view = await setup(); vi.useFakeTimers();
    await reveal(view); expect(view.result.current.secret?.value).toBe("test-only-secret");
    act(() => vi.advanceTimersByTime(29_999)); expect(view.result.current.secret).not.toBeNull();
    act(() => view.result.current.setName("Unrelated render"));
    act(() => vi.advanceTimersByTime(1)); expect(view.result.current.secret).toBeNull();
  });

  it.each(["version", "expiry", "revocation", "removed"])("hides a secret if refreshed metadata shows %s", async (change) => {
    const view = await setup(); await reveal(view);
    expect(view.result.current.secret).not.toBeNull();
    tokens = change === "removed" ? [] : [{ ...token, version: change === "version" ? 2 : 1,
      expiresAt: change === "expiry" ? "2020-01-01T00:00:00Z" : null, revokedAt: change === "revocation" ? token.createdAt : null }];
    act(() => view.result.current.reload());
    await waitFor(() => expect(view.result.current.secret).toBeNull());
  });

  it("refreshes metadata periodically and removes timers/listeners on unmount", async () => {
    vi.useFakeTimers();
    const view = renderHook(useConnectViewModel);
    await act(async () => { await Promise.resolve(); });
    const calls = request.mock.calls.length;
    await act(async () => vi.advanceTimersByTime(30_000));
    expect(request.mock.calls.length).toBeGreaterThan(calls);
    view.unmount(); const after = request.mock.calls.length;
    await act(async () => vi.advanceTimersByTime(60_000));
    expect(request).toHaveBeenCalledTimes(after);
  });

  it("copies only on explicit action and handles clipboard errors without leaking a secret", async () => {
    const view = await setup(); await reveal(view);
    expect(clipboard).not.toHaveBeenCalled();
    await act(() => view.result.current.copy("test-only-secret", "Key"));
    expect(clipboard).toHaveBeenCalledWith("test-only-secret"); expect(view.result.current.notice).toBe("Key copied.");
    clipboard.mockRejectedValueOnce(new Error("denied"));
    await act(() => view.result.current.copy("instructions", "Instructions"));
    expect(view.result.current.error).toContain("Clipboard access was denied."); expect(view.result.current.error).not.toContain("test-only-secret");
  });

  it.each([false, true])("ignores a stale clipboard result after target change (%s)", async (fail) => {
    const view = await setup(); const pending = deferred<void>(); clipboard.mockReturnValueOnce(pending.promise);
    let copying!: Promise<void>; act(() => { copying = view.result.current.copy("instructions", "Instructions"); });
    act(() => view.result.current.changeTarget("network"));
    await act(async () => { if (fail) pending.reject(new Error("denied")); else pending.resolve(); await copying; });
    expect(view.result.current.notice).toBe(""); expect(view.result.current.error).toBe("");
  });
});
