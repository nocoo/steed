import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ConnectToken } from "@steed/api/shared";
import { ConnectPage } from "../connect";

const request = vi.hoisted(() => vi.fn());
vi.mock("@/lib/connect-client", async (original) => ({ ...await original<object>(), connectRequest: request }));
const token: ConnectToken = { id: "agent", name: "Assistant", diagramId: null, scope: "read", prefix: "prefix…", version: 1,
  createdAt: "2026-09-12T00:00:00Z", expiresAt: null, lastUsedAt: null, revokedAt: null };
let tokens: ConnectToken[];
let diagrams: { id: string; title: string; deleted?: boolean }[];
const clipboard = vi.fn();
type Options = { method?: string; body?: Record<string, unknown> };
async function respond(path: string, options: Options = {}) {
  if (path === "/api/connect") return { data: { apiBaseUrl: "https://steed.example/api/v1" } };
  if (options.method) {
    if (path.endsWith("/challenge")) return { data: { challenge: "proof" } };
    if (path.endsWith("/reveal")) return { data: { token: "test-only-secret" } };
    if (path === "/api/connect/tokens") tokens = [{ ...token, name: String(options.body?.name), scope: options.body?.scope === "write" ? "write" : "read", expiresAt: options.body?.expiresAt as string | null }];
    if (options.method === "PATCH") tokens = tokens.map((value) => ({ ...value, name: String(options.body?.name), version: value.version + 1 }));
    if (path.endsWith("/rotate")) tokens = tokens.map((value) => ({ ...value, version: value.version + 1 }));
    if (path.endsWith("/revoke")) tokens = tokens.map((value) => ({ ...value, revokedAt: value.createdAt, version: value.version + 1 }));
    return { data: tokens[0] };
  }
  if (path.startsWith("/api/connect/diagrams")) return { data: diagrams, nextCursor: null };
  if (path.startsWith("/api/connect/tokens")) return { data: tokens, nextCursor: null };
  return { data: [{ id: 1, operation: "diagrams.put", status: 200, code: null, requestId: "request-one", createdAt: token.createdAt },
    { id: 2, operation: "diagrams.delete", status: 412, code: "version_conflict", requestId: "request-two", createdAt: token.createdAt }], nextCursor: null };
}
const click = (name: string) => fireEvent.click(screen.getByRole("button", { name, exact: true }));
const change = (name: string | RegExp, value: string) => fireEvent.change(screen.getByLabelText(name), { target: { value } });
const dialogButton = (name: string) => within(screen.getByRole("dialog")).getByRole("button", { name, exact: true });
async function setup() {
  const view = render(<ConnectPage />);
  await waitFor(() => expect(screen.queryByText("Refreshing connections…")).not.toBeInTheDocument());
  return view;
}
async function confirm(label: string, name: string) {
  click(label); change(new RegExp(`Type ${name} to confirm`), name);
  fireEvent.click(dialogButton(label.startsWith("Revoke") ? "Revoke token" : label.startsWith("Rotate") ? "Rotate key" : "Reveal key"));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  await waitFor(() => expect(screen.queryByText("Refreshing connections…")).not.toBeInTheDocument());
}
beforeEach(() => {
  vi.resetAllMocks(); tokens = [token]; diagrams = [{ id: "network", title: "Network" }];
  request.mockImplementation(respond); clipboard.mockResolvedValue(undefined);
  vi.spyOn(document, "hidden", "get").mockReturnValue(false);
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: clipboard } });
});
afterEach(() => vi.restoreAllMocks());

describe("Connect page", () => {
  it("creates a scoped token with expiry and presents metadata without revealing a credential", async () => {
    tokens = []; await setup();
    expect(screen.getByText("No tokens for this target")).toBeInTheDocument();
    change("Target", "network");
    await waitFor(() => expect(screen.getByRole("button", { name: "Create token" })).toBeEnabled());
    click("Create token"); expect(dialogButton("Create token")).toBeDisabled();
    change("Name", "Architecture agent"); change("Permission", "write"); change("Expiry (optional)", "2099-01-01T12:00");
    fireEvent.click(dialogButton("Create token"));
    await screen.findByRole("heading", { name: "Architecture agent" });
    expect(screen.getByText("Read + write")).toBeInTheDocument();
    expect(screen.queryByLabelText("Revealed key")).not.toBeInTheDocument(); expect(clipboard).not.toHaveBeenCalled();
    expect(screen.getByRole("status")).toHaveTextContent("Token created.");
    expect(screen.getByText("Network · 1 / 50 slots used")).toBeInTheDocument();
    click("Create token"); fireEvent.click(dialogButton("Cancel"));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Create token" })).toHaveFocus();
  });

  it("requires exact confirmation, supports explicit copy/hide, then renames, rotates and revokes", async () => {
    await setup();
    click("Reveal key for Assistant"); expect(dialogButton("Reveal key")).toBeDisabled();
    change(/Type Assistant to confirm/, "assistant"); expect(dialogButton("Reveal key")).toBeDisabled();
    fireEvent.click(dialogButton("Cancel"));
    await confirm("Reveal key for Assistant", "Assistant");
    const secret = screen.getByLabelText("Revealed key");
    expect(secret).toHaveValue("test-only-secret"); expect(secret.closest('[data-private="true"]')).not.toBeNull();
    expect(clipboard).not.toHaveBeenCalled(); click("Copy key");
    await waitFor(() => expect(clipboard).toHaveBeenCalledWith("test-only-secret"));
    click("Hide key"); expect(screen.queryByLabelText("Revealed key")).not.toBeInTheDocument();
    click("Rename Assistant"); change("New name", "Renamed agent"); fireEvent.click(dialogButton("Rename token"));
    await screen.findByRole("heading", { name: "Renamed agent" });
    await confirm("Rotate key for Renamed agent", "Renamed agent");
    expect(screen.getByRole("status")).toHaveTextContent("The old key stopped working");
    await confirm("Revoke Renamed agent", "Renamed agent");
    expect(screen.getByText("Revoked")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reveal key for Renamed agent" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Revoke Renamed agent" })).toBeDisabled();
    expect(screen.getByLabelText("Target")).toHaveFocus();
    expect(screen.getByText("All diagrams · 0 / 50 slots used")).toBeInTheDocument();
  });

  it("shows errors inside the active dialog, keeps its input, and allows recovery", async () => {
    await setup(); click("Create token"); change("Name", "Agent");
    request.mockImplementation(async (path: string, options?: Options) => { if (options?.method === "POST") throw new Error("No slots available"); return respond(path, options); });
    fireEvent.click(dialogButton("Create token"));
    await waitFor(() => expect(within(screen.getByRole("dialog")).getByRole("alert")).toHaveTextContent("No slots available"));
    expect(screen.getByLabelText("Name")).toHaveValue("Agent");
    fireEvent.click(dialogButton("Cancel"));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Create token" })).toBeEnabled();
    request.mockImplementation(respond); click("Reveal key for Assistant");
    request.mockImplementation(async (path: string, options?: Options) => { if (path.endsWith("/challenge")) throw new Error("Token changed"); return respond(path, options); });
    change(/Type Assistant to confirm/, "Assistant"); fireEvent.click(dialogButton("Reveal key"));
    await waitFor(() => expect(within(screen.getByRole("dialog")).getByRole("alert")).toHaveTextContent("Token changed"));
  });

  it("serves safe curl and agent instructions with an authenticated contract download and audit metadata", async () => {
    await setup();
    const instructions = screen.getByLabelText("Agent connection instructions");
    expect(instructions).toHaveTextContent("$STEED_TOKEN");
    expect(screen.getByRole("link", { name: "Download OpenAPI" })).toHaveAttribute("href", "/api/connect/openapi.json");
    change("Instructions format", "agent"); expect(instructions).toHaveTextContent("Read GET /capabilities");
    click("Copy instructions"); await waitFor(() => expect(clipboard).toHaveBeenCalledWith(expect.stringContaining("Idempotency-Key")));
    change("Instructions format", "curl"); expect(instructions).toHaveTextContent("--fail-with-body");
    fireEvent.click(screen.getByText("Recent activity"));
    expect(screen.getByText("request-one")).toBeVisible(); expect(screen.getByText("412 · version_conflict")).toBeVisible();
    expect(screen.queryByText("test-only-secret")).not.toBeInTheDocument();
  });

  it("keeps expired tokens manageable and prevents the 51st live token", async () => {
    tokens = Array.from({ length: 50 }, (_, index) => ({ ...token, id: `agent-${index}`, name: `Agent ${index}`, expiresAt: "2020-01-01T00:00:00Z" }));
    await setup();
    expect(screen.getByRole("button", { name: "Create token" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Reveal key for Agent 0" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Rotate key for Agent 0" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Revoke Agent 0" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Rename Agent 0" })).toBeEnabled();
  });

  it("preserves a removed target selection so its credentials can still be revoked", async () => {
    await setup(); change("Target", "network");
    await waitFor(() => expect(screen.queryByText("Refreshing connections…")).not.toBeInTheDocument());
    diagrams = []; tokens = [];
    request.mockImplementation(async (path: string, options?: Options) => path.startsWith("/api/connect/audit") ? { data: [] } : respond(path, options));
    click("Refresh");
    await screen.findByRole("option", { name: "Unavailable diagram" });
    expect(screen.getByLabelText("Target")).toHaveValue("network");
    expect(screen.getByText("No recorded activity for this target.")).toBeInTheDocument();
  });

  it("discovers previously deleted targets after a reload while disabling new credentials", async () => {
    diagrams = [{ id: "network", title: "Network", deleted: true }]; await setup();
    change("Target", "network");
    await waitFor(() => expect(screen.queryByText("Refreshing connections…")).not.toBeInTheDocument());
    expect(screen.getByRole("option", { name: "Network (deleted)" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create token" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Revoke Assistant" })).toBeEnabled();
    expect(screen.getByText("This diagram is unavailable. You can still revoke its existing tokens.")).toBeInTheDocument();
  });

  it("clears a visible secret on window blur and does not copy it automatically", async () => {
    await setup(); await confirm("Reveal key for Assistant", "Assistant");
    expect(screen.getByLabelText("Revealed key")).toBeInTheDocument();
    act(() => window.dispatchEvent(new Event("blur")));
    expect(screen.queryByLabelText("Revealed key")).not.toBeInTheDocument(); expect(clipboard).not.toHaveBeenCalled();
  });
});
