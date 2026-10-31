import { useCallback, useEffect, useRef, useState } from "react";
import { CONNECT_LIMITS, topologyTokenInputSchema, type TopologyConnectAudit, type TopologyConnectScope, type ConnectSensitiveAction, type TopologyConnectToken } from "@steed/api/shared";
import { topologyConnectRequest as connectRequest, topologyTokenStatus as tokenStatus } from "@/lib/topology-connect-client";

interface TokenAction { token: TopologyConnectToken; kind: ConnectSensitiveAction | "rename" }
interface Page<T> { data: T[]; nextCursor: string | null }
async function allPages<T>(path: string, signal: AbortSignal): Promise<T[]> {
  const data: T[] = [];
  let cursor = "";
  do {
    const result: Page<T> = await connectRequest(`${path}${path.includes("?") ? "&" : "?"}limit=100&cursor=${encodeURIComponent(cursor)}`, { signal });
    data.push(...result.data); cursor = result.nextCursor ?? "";
  } while (cursor && !signal.aborted);
  return data;
}

export function useConnectViewModel() {
  const [tokens, setTokens] = useState<TopologyConnectToken[]>([]);
  const [audit, setAudit] = useState<TopologyConnectAudit[]>([]);
  const [baseUrl, setBaseUrl] = useState(`${window.location.origin}/api/v1`);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [scope, setScope] = useState<TopologyConnectScope>("topology:read");
  const [expiry, setExpiry] = useState("");
  const [action, setAction] = useState<TokenAction | null>(null);
  const [confirmation, setConfirmation] = useState("");
  const [secret, setSecret] = useState<{ id: string; version: number; value: string } | null>(null);
  const generation = useRef(0);
  const mounted = useRef(true);
  const hide = useCallback(() => { generation.current++; setSecret(null); }, []);
  const reload = useCallback(() => setRefresh((value) => value + 1), []);
  useEffect(() => {
    mounted.current = true;
    const visibility = () => { if (document.hidden) hide(); };
    window.addEventListener("blur", hide); document.addEventListener("visibilitychange", visibility);
    const interval = window.setInterval(reload, 30_000);
    return () => { mounted.current = false; generation.current++; window.removeEventListener("blur", hide); document.removeEventListener("visibilitychange", visibility); window.clearInterval(interval); };
  }, [hide, reload]);
  useEffect(() => {
    if (!secret) return;
    const timer = window.setTimeout(hide, CONNECT_LIMITS.revealSeconds * 1000);
    return () => window.clearTimeout(timer);
  }, [secret, hide]);
  useEffect(() => {
    if (secret && !tokens.some((token) => token.id === secret.id && token.version === secret.version && tokenStatus(token) === "Active")) hide();
  }, [tokens, secret, hide]);
  useEffect(() => {
    const controller = new AbortController();
    const signal = controller.signal;
    setLoading(true); setLoadError("");
    void (async () => {
      try {
        const [info, tokens, audit] = await Promise.all([
          connectRequest<{ data: { apiBaseUrl: string } }>("/api/connect", { signal }),
          allPages<TopologyConnectToken>("/api/connect/tokens", signal),
          connectRequest<{ data: TopologyConnectAudit[] }>("/api/connect/audit?limit=20", { signal }),
        ]);
        if (signal.aborted) return;
        setBaseUrl(info.data.apiBaseUrl); setTokens(tokens); setAudit(audit.data);
      } catch (cause) { if (!signal.aborted) setLoadError(cause instanceof Error ? cause.message : "Connect is unavailable."); }
      finally { if (!signal.aborted) setLoading(false); }
    })();
    return () => controller.abort();
  }, [refresh]);
  const openAction = (token: TopologyConnectToken, kind: TokenAction["kind"]) => {
    hide(); setCreating(false); setAction({ token, kind }); setConfirmation(kind === "rename" ? token.name : ""); setError(""); setNotice("");
  };
  const closeAction = () => { hide(); setAction(null); setConfirmation(""); };
  const openCreate = () => { hide(); setAction(null); setCreating(true); setError(""); setNotice(""); };
  const create = async () => {
    setBusy(true); setError("");
    try {
      const input = topologyTokenInputSchema.parse({ name, scope, expiresAt: expiry ? new Date(expiry).toISOString() : null });
      await connectRequest("/api/connect/tokens", { method: "POST", body: input });
      if (!mounted.current) return;
      setCreating(false); setName(""); setScope("topology:read"); setExpiry(""); setNotice("Token created. Reveal its key when you are ready to connect your agent.");
    } catch (cause) { if (mounted.current) setError(cause instanceof Error ? cause.message : "Token creation failed."); }
    finally { if (mounted.current) { setBusy(false); reload(); } }
  };
  const confirmAction = async () => {
    if (!action) return;
    const current = generation.current;
    const path = `/api/connect/tokens/${action.token.id}`;
    setBusy(true); setError("");
    try {
      let updated: TopologyConnectToken | undefined;
      if (action.kind === "rename") updated = (await connectRequest<{ data: TopologyConnectToken }>(path, { method: "PATCH", body: { name: confirmation }, token: action.token })).data;
      else {
        const challenge = await connectRequest<{ data: { challenge: string } }>(`${path}/challenge`, { method: "POST", body: { action: action.kind }, token: action.token });
        if (current !== generation.current || !mounted.current || document.hidden) return;
        const result = await connectRequest<{ data: TopologyConnectToken | { token: string } }>(`${path}/${action.kind}`, { method: "POST", body: { challenge: challenge.data.challenge, confirmation }, token: action.token });
        if (current !== generation.current || !mounted.current || document.hidden) return;
        if (action.kind === "reveal" && "token" in result.data) setSecret({ id: action.token.id, version: action.token.version, value: result.data.token });
        else if ("id" in result.data) updated = result.data;
      }
      if (current !== generation.current || !mounted.current) return;
      const metadata = updated;
      if (metadata) setTokens((tokens) => tokens.map((token) => token.id === metadata.id ? metadata : token));
      setNotice({ rename: "Token renamed.", reveal: "Key revealed for 30 seconds.", rotate: "Key rotated. The old key stopped working; reveal the replacement to reconnect your agent.", revoke: "Token revoked. Its key no longer works." }[action.kind]);
      setAction(null); setConfirmation("");
    } catch (cause) { if (current === generation.current && mounted.current) setError(cause instanceof Error ? cause.message : "The action failed. Refresh before retrying."); }
    finally { if (mounted.current) { setBusy(false); reload(); } }
  };
  const copy = async (value: string, label: string) => {
    const current = generation.current;
    try { await navigator.clipboard.writeText(value); if (current === generation.current && mounted.current) setNotice(`${label} copied.`); }
    catch { if (current === generation.current && mounted.current) setError("Clipboard access was denied. Select and copy the visible text manually."); }
  };
  return { tokens, audit, baseUrl, loading, error: error || loadError, notice, busy, reload,
    creating, setCreating, openCreate, name, setName, scope, setScope, expiry, setExpiry, create, action, confirmation, setConfirmation, openAction, closeAction, confirmAction, secret, hide, copy };
}
