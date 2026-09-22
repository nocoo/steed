import { useMemo, useRef, useState } from "react";
import { Badge, Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Input, Label, LayerCard } from "@nocoo/basalt";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@nocoo/basalt/components/select";
import { Check, Copy, Eye, EyeOff, KeyRound, Pencil, Plug, Plus, RefreshCw, RotateCw, ShieldCheck, Terminal, Trash2 } from "lucide-react";
import { CONNECT_LIMITS, connectScopeSchema, type ConnectToken } from "@steed/api/shared";
import { connectDate, connectExamples, tokenStatus } from "@/lib/connect-client";
import { useConnectViewModel } from "@/viewmodels/use-connect-viewmodel";

const labels = { reveal: "Reveal key", rotate: "Rotate key", revoke: "Revoke token", rename: "Rename token" };
const descriptions = {
  reveal: "The key hides after 30 seconds, when this window loses focus, or when you leave this target. Copy it only to your agent's secret store.",
  rotate: "The old key stops working immediately. The replacement keeps this target, permission and expiry. Reveal it again to reconnect your agent.",
  revoke: "The key stops working immediately. Revocation cannot be undone.",
  rename: "Choose a name that identifies the agent or integration using this token.",
};

export function ConnectPage() {
  const vm = useConnectViewModel();
  const [example, setExample] = useState<"curl" | "agent">("curl");
  const examples = useMemo(() => connectExamples(vm.baseUrl, vm.target), [vm.baseUrl, vm.target]);
  const opener = useRef<HTMLButtonElement | null>(null);
  const target = useRef<HTMLButtonElement | null>(null);
  const restoreFocus = (event: Event) => { event.preventDefault(); (opener.current?.isConnected && !opener.current.disabled ? opener.current : target.current)?.focus(); };
  const open = (button: HTMLButtonElement, token: ConnectToken, kind: keyof typeof labels) => { opener.current = button; vm.openAction(token, kind); };
  const used = vm.tokens.filter((token) => !token.revokedAt).length;
  const selectedTarget = vm.diagrams.find((diagram) => diagram.id === vm.target);
  const targetName = selectedTarget ? `${selectedTarget.title}${selectedTarget.deleted ? " (deleted)" : ""}` : vm.target || "All diagrams";
  const targetUnavailable = Boolean(vm.target && (!selectedTarget || selectedTarget.deleted));

  return <div className="mx-auto max-w-6xl space-y-6 p-4 md:p-6">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div><div className="mb-2 flex items-center gap-2 text-xs font-medium text-basalt-muted-foreground"><Plug className="h-4 w-4" />AGENT CONNECTIONS</div>
        <h1 className="text-2xl font-semibold tracking-tight">Connect</h1><p className="mt-2 text-sm text-basalt-muted-foreground">Let your agents read and maintain architecture diagrams.</p></div>
      <Badge variant="outline">API v1</Badge>
    </div>
    {vm.error && <p role="alert" className="whitespace-pre-wrap rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-700 dark:bg-red-950/30">{vm.error}</p>}
    {vm.notice && <p role="status" className="flex items-center gap-2 text-sm text-basalt-muted-foreground"><Check className="h-4 w-4" />{vm.notice}</p>}
    <LayerCard className="flex flex-col justify-between gap-6 sm:flex-row sm:items-center">
      <div className="flex items-start gap-3"><ShieldCheck className="mt-0.5 h-6 w-6 shrink-0 text-basalt-primary" />
        <div><h2 className="text-sm font-semibold">Choose what your agent can access</h2><p className="mt-2 max-w-lg text-sm text-basalt-muted-foreground">Bind a token to one diagram, or allow all diagrams so an agent can create new ones. Write permission includes read access.</p></div>
      </div>
      <div className="w-full shrink-0 space-y-2 sm:w-64"><Label htmlFor="connect-target">Target</Label>
        <Select value={vm.target === "" ? "\u0000" : vm.target} onValueChange={(value) => vm.changeTarget(value === "\u0000" ? "" : value)}>
          <SelectTrigger ref={target} id="connect-target" className="w-full"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={"\u0000"}>All diagrams</SelectItem>
            {vm.target && !vm.diagrams.some((diagram) => diagram.id === vm.target) && <SelectItem value={vm.target}>Unavailable diagram</SelectItem>}
            {vm.diagrams.map((diagram) => <SelectItem key={diagram.id} value={diagram.id}>{diagram.title}{diagram.deleted ? " (deleted)" : ""}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
    </LayerCard>
    <section aria-labelledby="connect-tokens-title" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 id="connect-tokens-title" className="text-base font-semibold">Tokens</h2><p className="mt-1 text-xs text-basalt-muted-foreground">{targetName} · {used} / {CONNECT_LIMITS.tokensPerTarget} slots used</p></div>
        <div className="flex gap-2"><Button size="sm" variant="outline" disabled={vm.loading || vm.busy} onClick={vm.reload}><RefreshCw className="h-3.5 w-3.5" />Refresh</Button>
          <Button size="sm" disabled={vm.loading || vm.busy || targetUnavailable || used >= CONNECT_LIMITS.tokensPerTarget} onClick={(event) => { opener.current = event.currentTarget; vm.openCreate(); }}><Plus className="h-3.5 w-3.5" />Create token</Button></div>
      </div>
      {vm.loading && <p role="status" className="text-sm text-basalt-muted-foreground">Refreshing connections…</p>}
      {targetUnavailable && <p className="text-sm text-basalt-muted-foreground">This diagram is unavailable. You can still revoke its existing tokens.</p>}
      {!vm.tokens.length && !vm.loading && !vm.error && <LayerCard className="py-10 text-center"><KeyRound className="mx-auto mb-3 h-8 w-8 text-basalt-muted-foreground" /><h3 className="text-sm font-medium">No tokens for this target</h3><p className="mt-2 text-sm text-basalt-muted-foreground">Create a read token to explore the API, or a write token to maintain diagrams.</p></LayerCard>}
      {vm.tokens.map((token) => {
        const status = tokenStatus(token);
        return <LayerCard key={token.id} className="space-y-4" aria-label={`Token ${token.name}`}>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h3 className="break-words text-sm font-semibold">{token.name}</h3><Badge variant="outline">{token.scope === "write" ? "Read + write" : "Read"}</Badge><Badge variant="outline">{status}</Badge></div>
              <p className="mt-2 font-mono text-xs text-basalt-muted-foreground">{token.prefix}</p></div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" disabled={vm.busy || status !== "Active"} aria-label={`Reveal key for ${token.name}`} onClick={(event) => open(event.currentTarget, token, "reveal")}><Eye className="h-3.5 w-3.5" />Reveal</Button>
              <Button variant="ghost" size="icon" className="h-8 w-8" disabled={vm.busy || status === "Revoked"} aria-label={`Rename ${token.name}`} onClick={(event) => open(event.currentTarget, token, "rename")}><Pencil className="h-3.5 w-3.5" /></Button>
              <Button variant="ghost" size="icon" className="h-8 w-8" disabled={vm.busy || status !== "Active"} aria-label={`Rotate key for ${token.name}`} onClick={(event) => open(event.currentTarget, token, "rotate")}><RotateCw className="h-3.5 w-3.5" /></Button>
              <Button variant="ghost" size="icon" className="h-8 w-8" disabled={vm.busy || status === "Revoked"} aria-label={`Revoke ${token.name}`} onClick={(event) => open(event.currentTarget, token, "revoke")}><Trash2 className="h-3.5 w-3.5" /></Button>
            </div>
          </div>
          <dl className="grid gap-3 text-xs text-basalt-muted-foreground sm:grid-cols-3"><div><dt>Created</dt><dd className="mt-1 text-basalt-foreground">{connectDate(token.createdAt)}</dd></div><div><dt>Expires</dt><dd className="mt-1 text-basalt-foreground">{token.expiresAt ? connectDate(token.expiresAt) : "No expiry"}</dd></div><div><dt>Last used</dt><dd className="mt-1 text-basalt-foreground">{connectDate(token.lastUsedAt)}</dd></div></dl>
          {vm.secret?.id === token.id && <div data-private="true" className="space-y-3 rounded-lg border border-basalt-primary/30 bg-basalt-primary/5 p-3">
            <Label htmlFor="revealed-key">Revealed key · hides after 30 seconds</Label>
            <Input id="revealed-key" aria-label="Revealed key" value={vm.secret.value} readOnly autoComplete="off" spellCheck={false} className="font-mono text-xs" />
            <div className="flex gap-2"><Button size="sm" variant="outline" onClick={() => { if (vm.secret) void vm.copy(vm.secret.value, "Key"); }}><Copy className="h-3.5 w-3.5" />Copy key</Button><Button size="sm" variant="ghost" onClick={vm.hide}><EyeOff className="h-3.5 w-3.5" />Hide key</Button></div>
          </div>}
        </LayerCard>;
      })}
    </section>
    <LayerCard className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="flex items-center gap-2 text-sm font-semibold"><Terminal className="h-4 w-4" />Connect your agent</h2><a href="/api/connect/openapi.json" className="text-sm text-basalt-primary underline">Download OpenAPI</a></div>
      <p className="text-sm text-basalt-muted-foreground">Read capabilities first. Keep credentials in a secret store, and retain one idempotency key for each intended change.</p>
      <div className="flex flex-wrap items-center gap-2"><Label htmlFor="connect-example" className="sr-only">Instructions format</Label>
        <Select value={example} onValueChange={(value) => setExample(value === "agent" ? "agent" : "curl")}>
          <SelectTrigger id="connect-example" className="w-auto"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="curl">curl</SelectItem>
            <SelectItem value="agent">Agent instructions</SelectItem>
          </SelectContent>
        </Select>
        <Button size="sm" variant="outline" onClick={() => void vm.copy(examples[example], "Instructions")}><Copy className="h-3.5 w-3.5" />Copy instructions</Button></div>
      <pre className="max-h-96 overflow-auto rounded-lg bg-basalt-secondary p-4 font-mono text-xs leading-relaxed" aria-label="Agent connection instructions">{examples[example]}</pre>
    </LayerCard>
    <LayerCard><details><summary className="cursor-pointer text-sm font-semibold">Recent activity</summary>
      <ul className="mt-4 space-y-3">{vm.audit.map((entry) => <li key={entry.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-basalt-border pb-3 text-xs"><div><span className="font-mono">{entry.operation}</span><span className="ml-3 text-basalt-muted-foreground">{entry.status}{entry.code ? ` · ${entry.code}` : ""}</span><p className="mt-1 break-all font-mono text-[10px] text-basalt-muted-foreground">{entry.requestId}</p></div><time dateTime={entry.createdAt} className="text-basalt-muted-foreground">{connectDate(entry.createdAt)}</time></li>)}</ul>
      {!vm.audit.length && <p className="mt-4 text-xs text-basalt-muted-foreground">No recorded activity for this target.</p>}
    </details></LayerCard>
    <Dialog open={vm.creating} onOpenChange={vm.setCreating}><DialogContent onCloseAutoFocus={restoreFocus}><DialogHeader><DialogTitle>Create token</DialogTitle><DialogDescription>Give an agent access to {targetName}. You can reveal its key after creation.</DialogDescription></DialogHeader>
      {vm.error && <p role="alert" className="whitespace-pre-wrap text-sm text-red-600">{vm.error}</p>}
      <form onSubmit={(event) => { event.preventDefault(); void vm.create(); }} className="space-y-4">
        <div><Label htmlFor="token-name">Name</Label><Input id="token-name" value={vm.name} maxLength={64} required disabled={vm.busy} onChange={(event) => vm.setName(event.target.value)} placeholder="Architecture assistant" /></div>
        <div><Label htmlFor="token-scope">Permission</Label>
          <Select value={vm.scope} onValueChange={(value) => vm.setScope(connectScopeSchema.parse(value))}>
            <SelectTrigger id="token-scope" className="w-full" disabled={vm.busy}><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="read">Read · view and export</SelectItem>
              <SelectItem value="write">Read + write · create and maintain</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div><Label htmlFor="token-expiry">Expiry (optional)</Label><Input id="token-expiry" type="datetime-local" value={vm.expiry} disabled={vm.busy} onChange={(event) => vm.setExpiry(event.target.value)} /><p className="mt-1 text-xs text-basalt-muted-foreground">Leave blank for no expiry. Rotate or revoke it whenever needed.</p></div>
        <DialogFooter><Button type="button" variant="outline" disabled={vm.busy} onClick={() => vm.setCreating(false)}>Cancel</Button><Button type="submit" disabled={vm.busy || !vm.name.trim()}>{vm.busy ? "Creating…" : "Create token"}</Button></DialogFooter>
      </form>
    </DialogContent></Dialog>
    <Dialog open={vm.action !== null} onOpenChange={(open) => { if (!open) vm.closeAction(); }}><DialogContent onCloseAutoFocus={restoreFocus}><DialogHeader><DialogTitle>{vm.action ? labels[vm.action.kind] : "Token action"}</DialogTitle><DialogDescription>{vm.action ? descriptions[vm.action.kind] : ""}</DialogDescription></DialogHeader>
      {vm.error && <p role="alert" className="whitespace-pre-wrap text-sm text-red-600">{vm.error}</p>}
      <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); void vm.confirmAction(); }}>
        <div><Label htmlFor="token-confirmation">{vm.action?.kind === "rename" ? "New name" : `Type ${vm.action?.token.name ?? "the token name"} to confirm`}</Label><Input id="token-confirmation" value={vm.confirmation} maxLength={64} autoComplete="off" disabled={vm.busy} onChange={(event) => vm.setConfirmation(event.target.value)} /></div>
        <DialogFooter><Button type="button" variant="outline" onClick={vm.closeAction}>Cancel</Button><Button type="submit" disabled={vm.busy || (vm.action?.kind === "rename" ? !vm.confirmation.trim() : vm.confirmation !== vm.action?.token.name)}>{vm.busy ? "Working…" : vm.action ? labels[vm.action.kind] : "Confirm"}</Button></DialogFooter>
      </form>
    </DialogContent></Dialog>
  </div>;
}
