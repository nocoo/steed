import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router";
import { Badge, Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Input, Label, LayerCard } from "@nocoo/basalt";
import { ArrowDownLeft, ArrowUpRight, Braces, Check, Download, FileUp, Layers, Network, Plus, Save, Search, Trash2, X } from "lucide-react";
import { DIAGRAM_LIMITS, EDGE_KINDS, NODE_KINDS, diagramSchema, edgeSchema, nodeSchema, removeDiagramEdge, removeDiagramNode, type Diagram, type DiagramEdge, type DiagramNode } from "@steed/api/shared";
import { DiagramCanvas } from "@/components/map/diagram-canvas";
import { downloadDiagram } from "@/lib/diagram-client";
import { EDGE_COLORS, moveDiagramNode, type DiagramFilter, type Reach } from "@/lib/diagram-graph";
import { useDiagramViewModel } from "@/viewmodels/use-diagram-viewmodel";

const fieldClass = "w-full rounded-md border border-basalt-border bg-basalt-background px-3 py-2 text-sm text-basalt-foreground focus-visible:outline-2 focus-visible:outline-basalt-ring";
type Editor = { kind: "source"; text: string } | { kind: "node"; value: DiagramNode; isNew: boolean } | { kind: "edge"; value: DiagramEdge; isNew: boolean };

function ArchitectureEditor({ document, onChange, busy }: { document: Diagram; onChange: (document: Diagram) => void; busy: boolean }) {
  const [viewId, setViewId] = useState(document.views[0]?.id ?? "");
  const [collapsed, setCollapsed] = useState<string[]>([]);
  const [focus, setFocus] = useState<DiagramFilter["focus"]>();
  const [selected, setSelected] = useState("");
  const [selectedEdges, setSelectedEdges] = useState<DiagramEdge[]>([]);
  const [query, setQuery] = useState("");
  const [editor, setEditor] = useState<Editor | null>(null);
  const [editError, setEditError] = useState("");
  const [confirmNodeDelete, setConfirmNodeDelete] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [showBoundaries, setShowBoundaries] = useState<boolean>();
  const filter = useMemo(() => ({ viewId, collapsed, focus, showBoundaries }), [viewId, collapsed, focus, showBoundaries]);
  const node = document.nodes.find((candidate) => candidate.id === selected);
  const view = document.views.find((candidate) => candidate.id === viewId);
  const matches = document.nodes.filter((candidate) =>
    `${candidate.label} ${candidate.kind} ${candidate.url ?? ""} ${candidate.tags.join(" ")} ${candidate.description}`.toLowerCase().includes(query.toLowerCase()));
  const relationships = node ? document.edges.filter((edge) => edge.source === node.id || edge.target === node.id) : [];

  const open = (next: Editor) => { setEditError(""); setEditor(next); };
  const select = (id: string) => { setSelected(id); setSelectedEdges([]); setInspectorOpen(true); };
  const trace = (id: string, direction: Reach) => { select(id); setViewId(""); setCollapsed([]); setFocus({ id, direction }); };
  const addEdge = (source = document.nodes[0]?.id, target = document.nodes[1]?.id) => {
    if (!source || !target) return;
    open({ kind: "edge", isNew: true, value: edgeSchema.parse({ id: crypto.randomUUID(), source, target }) });
  };
  const applyEditor = () => {
    if (!editor) return;
    try {
      let next: Diagram;
      if (editor.kind === "source") {
        next = diagramSchema.parse(JSON.parse(editor.text));
        setViewId(next.views[0]?.id ?? ""); setFocus(undefined); setCollapsed([]);
        setSelected(""); setSelectedEdges([]); setQuery(""); setShowBoundaries(undefined);
      }
      else if (editor.kind === "node") {
        const value = nodeSchema.parse(editor.value);
        const nodes = editor.isNew ? [...document.nodes, value] : document.nodes.map((candidate) => candidate.id === value.id ? value : candidate);
        next = diagramSchema.parse({ ...document, nodes });
        setViewId(""); setFocus(undefined); select(value.id);
      } else {
        const value = edgeSchema.parse(editor.value);
        const edges = editor.isNew ? [...document.edges, value] : document.edges.map((candidate) => candidate.id === value.id ? value : candidate);
        next = diagramSchema.parse({ ...document, edges });
        setSelectedEdges([value]);
      }
      onChange(next); setEditor(null);
    } catch (cause) { setEditError(cause instanceof Error ? cause.message : "Invalid diagram source."); }
  };

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Label htmlFor="diagram-view" className="sr-only">Diagram view</Label>
          <select id="diagram-view" className={`${fieldClass} !w-auto max-w-64`} value={viewId}
            onChange={(event) => { setViewId(event.target.value); setFocus(undefined); setSelected(""); setSelectedEdges([]); setShowBoundaries(undefined); }}>
            <option value="">All components · {document.nodes.length}</option>
            {document.views.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
          </select>
          {focus && <Button variant="outline" size="sm" onClick={() => setFocus(undefined)}><X className="h-3 w-3" />Clear trace</Button>}
          <Badge variant="outline">{document.nodes.length} components</Badge>
          <Badge variant="outline">{document.edges.length} connections</Badge>
          <label className="flex items-center gap-2 text-xs text-basalt-muted-foreground"><input type="checkbox" checked={showBoundaries ?? view?.showBoundaries ?? true} onChange={(event) => setShowBoundaries(event.target.checked)} />Boundaries</label>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => setInspectorOpen((value) => !value)}><Search className="h-3.5 w-3.5" />{inspectorOpen ? "Hide details" : "Find / inspect"}</Button>
          <Button variant="outline" size="sm" disabled={busy} onClick={() => open({ kind: "node", isNew: true,
            value: nodeSchema.parse({ id: crypto.randomUUID(), label: "New component", kind: "service", position: { x: document.nodes.length * 24, y: document.nodes.length * 24 } }) })}>
            <Plus className="h-3.5 w-3.5" />Component
          </Button>
          <Button variant="outline" size="sm" disabled={busy || document.nodes.length < 2} onClick={() => addEdge()}><Network className="h-3.5 w-3.5" />Connection</Button>
          <Button variant="outline" size="sm" disabled={busy} onClick={() => open({ kind: "source", text: JSON.stringify(document, null, 2) })}><Braces className="h-3.5 w-3.5" />Edit source</Button>
        </div>
      </div>
      {view?.description && <p className="mb-4 text-sm text-basalt-muted-foreground">{view.description}</p>}
      {focus && <p className="mb-4 text-sm text-basalt-muted-foreground">{focus.direction} relationships for {node?.label ?? focus.id}, as recorded in this diagram.</p>}
      <div className={`grid gap-4${inspectorOpen ? " xl:grid-cols-[minmax(0,1fr)_280px]" : ""}`}>
        <LayerCard padding="none" className="h-[calc(100dvh-420px)] min-h-[440px] overflow-hidden">
          <DiagramCanvas document={document} filter={filter} disabled={busy} onSelect={select} onEdgeSelect={(edges) => { setSelected(""); setSelectedEdges(edges); setInspectorOpen(true); }}
            onExpand={(id) => setCollapsed((ids) => ids.filter((candidate) => candidate !== id))}
            onMove={(id, point) => onChange(moveDiagramNode(document, id, point, viewId))} onConnect={addEdge} />
        </LayerCard>
        {inspectorOpen && <aside className="flex max-h-[calc(100dvh-420px)] min-h-[440px] flex-col gap-4 overflow-y-auto" aria-label="Diagram inspector">
          <LayerCard>
            <label htmlFor="component-search" className="mb-2 flex items-center gap-2 text-sm font-semibold"><Search className="h-4 w-4" />Find a component</label>
            <Input id="component-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Name, domain, tag…" />
            {query && <div className="mt-3 max-h-60 space-y-1 overflow-auto" aria-label="Search results">
              {!matches.length && <p className="text-xs text-basalt-muted-foreground">No matching components.</p>}
              {matches.map((match) => <button key={match.id} className="block w-full rounded p-2 text-left text-xs hover:bg-basalt-secondary focus-visible:outline-2" onClick={() => trace(match.id, "neighbors")}>
                <span className="block font-medium">{match.label}</span><span className="text-basalt-muted-foreground">{match.kind}</span>
              </button>)}
            </div>}
          </LayerCard>
          {node && <LayerCard>
            <div className="mb-3 flex items-start justify-between gap-2"><h2 className="break-words text-sm font-semibold">{node.label}</h2><Badge variant="outline">{node.kind}</Badge></div>
            <p className="whitespace-pre-wrap break-words text-xs leading-relaxed text-basalt-muted-foreground">{node.description || "No description yet."}</p>
            {node.url && <a href={node.url} target="_blank" rel="noopener noreferrer" className="mt-3 block break-all text-xs text-basalt-primary underline">{node.url}</a>}
            <div className="my-3 flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={() => trace(node.id, "upstream")}><ArrowDownLeft className="h-3 w-3" />Upstream</Button>
              <Button variant="outline" size="sm" onClick={() => trace(node.id, "downstream")}><ArrowUpRight className="h-3 w-3" />Downstream</Button>
            </div>
            <div className="mb-3 flex gap-2"><Button size="sm" variant="outline" disabled={busy} onClick={() => open({ kind: "node", isNew: false, value: { ...node } })}>Edit component</Button>
              <Button size="sm" variant="ghost" disabled={busy} aria-label="Delete component" onClick={() => setConfirmNodeDelete(true)}><Trash2 className="h-3.5 w-3.5" /></Button></div>
            <h3 className="mb-2 text-xs font-semibold">{relationships.length} connections</h3>
            <div className="space-y-1">{relationships.map((edge) => <button key={edge.id} className="block w-full rounded p-2 text-left text-xs hover:bg-basalt-secondary" onClick={() => { setSelectedEdges([edge]); setSelected(""); }}>
              <span className="block">{edge.source === node.id ? "→ " : "← "}{document.nodes.find((candidate) => candidate.id === (edge.source === node.id ? edge.target : edge.source))?.label}</span>
              <span className="text-basalt-muted-foreground">{edge.label || edge.kind} · {edge.evidence}</span>
            </button>)}</div>
          </LayerCard>}
          {selectedEdges.length > 0 && <LayerCard><h2 className="mb-3 text-sm font-semibold">Connection details</h2>
            {selectedEdges.map((edge) => <div key={edge.id} className="mb-4 space-y-2 text-xs">
              <p className="font-medium">{document.nodes.find((candidate) => candidate.id === edge.source)?.label} → {document.nodes.find((candidate) => candidate.id === edge.target)?.label}</p>
              <p>{edge.label || edge.kind} · <strong>{edge.evidence}</strong></p><p className="whitespace-pre-wrap text-basalt-muted-foreground">{edge.description}</p>
              <Button variant="outline" size="sm" disabled={busy} onClick={() => open({ kind: "edge", value: { ...edge }, isNew: false })}>Edit connection</Button>
            </div>)}
          </LayerCard>}
          <LayerCard><h2 className="mb-3 flex items-center gap-2 text-sm font-semibold"><Layers className="h-4 w-4" />Boundaries</h2>
            {!document.groups.length && <p className="text-xs text-basalt-muted-foreground">Add boundaries and named views in Edit source.</p>}
            <div className="space-y-2">{document.groups.map((group) => <label key={group.id} className="flex items-center gap-2 text-xs">
              <input type="checkbox" checked={collapsed.includes(group.id)} onChange={(event) => setCollapsed((ids) => event.target.checked ? [...ids, group.id] : ids.filter((id) => id !== group.id))} />
              <span>Collapse {group.label}</span>
            </label>)}</div>
          </LayerCard>
        </aside>}
      </div>
      <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-xs text-basalt-muted-foreground" aria-label="Connection legend">
        {EDGE_KINDS.map((kind) => <span key={kind} className="inline-flex items-center gap-2"><i className="h-0.5 w-4" style={{ background: EDGE_COLORS[kind] }} />{kind}</span>)}
        <span className="inline-flex items-center gap-2"><i className="w-5 border-t border-dashed border-current" />Inferred connection</span>
      </div>

      <Dialog open={editor !== null} onOpenChange={(isOpen) => { if (!isOpen) setEditor(null); }}>
        <DialogContent className="max-h-[90vh] overflow-auto sm:max-w-2xl">
          <DialogHeader><DialogTitle>{editor?.kind === "source" ? "Edit diagram source" : editor?.kind === "node" ? "Edit component" : "Edit connection"}</DialogTitle>
            <DialogDescription>{editor?.kind === "source" ? "Edit the complete graph, including boundaries and named views. Changes are validated before applying." : "Apply changes to your draft, then save the diagram."}</DialogDescription></DialogHeader>
          {editError && <pre role="alert" className="max-h-36 overflow-auto whitespace-pre-wrap text-xs text-red-600">{editError}</pre>}
          {editor?.kind === "source" && <textarea aria-label="Diagram JSON" spellCheck={false} className={`${fieldClass} h-[50vh] font-mono text-xs`} value={editor.text} onChange={(event) => setEditor({ ...editor, text: event.target.value })} />}
          {editor?.kind === "node" && <div className="space-y-4">
            <div><Label htmlFor="node-label">Name</Label><Input id="node-label" value={editor.value.label} onChange={(event) => setEditor({ ...editor, value: { ...editor.value, label: event.target.value } })} /></div>
            <div className="grid gap-4 sm:grid-cols-2"><div><Label htmlFor="node-kind">Kind</Label><select id="node-kind" className={fieldClass} value={editor.value.kind} onChange={(event) => setEditor({ ...editor, value: { ...editor.value, kind: nodeSchema.shape.kind.parse(event.target.value) } })}>{NODE_KINDS.map((kind) => <option key={kind}>{kind}</option>)}</select></div>
              <div><Label htmlFor="node-group">Boundary</Label><select id="node-group" className={fieldClass} value={editor.value.groupId ?? ""} onChange={(event) => setEditor({ ...editor, value: { ...editor.value, groupId: event.target.value || undefined } })}><option value="">No boundary</option>{document.groups.map((group) => <option key={group.id} value={group.id}>{group.label}</option>)}</select></div></div>
            <div><Label htmlFor="node-url">URL</Label><Input id="node-url" value={editor.value.url ?? ""} placeholder="https://…" onChange={(event) => setEditor({ ...editor, value: { ...editor.value, url: event.target.value || undefined } })} /></div>
            <div><Label htmlFor="node-description">Description and evidence</Label><textarea id="node-description" className={`${fieldClass} min-h-28`} value={editor.value.description} onChange={(event) => setEditor({ ...editor, value: { ...editor.value, description: event.target.value } })} /></div>
          </div>}
          {editor?.kind === "edge" && <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">{(["source", "target"] as const).map((end) => <div key={end}><Label htmlFor={`edge-${end}`}>{end === "source" ? "From" : "To"}</Label><select id={`edge-${end}`} className={fieldClass} value={editor.value[end]} onChange={(event) => setEditor({ ...editor, value: { ...editor.value, [end]: event.target.value } })}>{document.nodes.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></div>)}</div>
            <div><Label htmlFor="edge-label">Connection label</Label><Input id="edge-label" value={editor.value.label} onChange={(event) => setEditor({ ...editor, value: { ...editor.value, label: event.target.value } })} /></div>
            <div className="grid gap-4 sm:grid-cols-2"><div><Label htmlFor="edge-kind">Kind</Label><select id="edge-kind" className={fieldClass} value={editor.value.kind} onChange={(event) => setEditor({ ...editor, value: { ...editor.value, kind: edgeSchema.shape.kind.parse(event.target.value) } })}>{EDGE_KINDS.map((kind) => <option key={kind}>{kind}</option>)}</select></div>
              <div><Label htmlFor="edge-evidence">Evidence</Label><select id="edge-evidence" className={fieldClass} value={editor.value.evidence} onChange={(event) => setEditor({ ...editor, value: { ...editor.value, evidence: edgeSchema.shape.evidence.parse(event.target.value) } })}><option value="documented">Documented</option><option value="inferred">Inferred</option></select></div></div>
            <div><Label htmlFor="edge-description">Evidence and notes</Label><textarea id="edge-description" className={`${fieldClass} min-h-28`} value={editor.value.description} onChange={(event) => setEditor({ ...editor, value: { ...editor.value, description: event.target.value } })} /></div>
            {!editor.isNew && <Button variant="outline" onClick={() => { onChange(removeDiagramEdge(document, editor.value.id)); setSelectedEdges([]); setEditor(null); }}>Remove connection</Button>}
          </div>}
          <DialogFooter><Button variant="outline" onClick={() => setEditor(null)}>Cancel</Button><Button onClick={applyEditor}>Apply to draft</Button></DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={confirmNodeDelete} onOpenChange={setConfirmNodeDelete}><DialogContent><DialogHeader><DialogTitle>Remove {node?.label}?</DialogTitle><DialogDescription>Its connections and named-view memberships will also be removed from the draft.</DialogDescription></DialogHeader>
        <DialogFooter><Button variant="outline" onClick={() => setConfirmNodeDelete(false)}>Cancel</Button><Button onClick={() => { if (node) onChange(removeDiagramNode(document, node.id)); setSelected(""); setFocus(undefined); setConfirmNodeDelete(false); }}>Remove component</Button></DialogFooter>
      </DialogContent></Dialog>
    </>
  );
}

export function DiagramsPage() {
  const vm = useDiagramViewModel();
  const file = useRef<HTMLInputElement>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  useEffect(() => { setConfirmDelete(false); }, [vm.id]);
  const importFile = async (input: File | undefined) => {
    if (!input) return;
    try {
      if (input.size > DIAGRAM_LIMITS.bytes) throw new Error("The diagram file exceeds 1 MiB.");
      const document = diagramSchema.parse(JSON.parse(await input.text()));
      await vm.create(document);
    } catch (cause) { vm.setError(cause instanceof Error ? cause.message : "Could not import this diagram."); }
    finally { if (file.current) file.current.value = ""; }
  };

  return <div className="p-4 md:p-6">
    <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0"><div className="mb-2 flex items-center gap-2 text-xs font-medium text-basalt-muted-foreground"><Network className="h-4 w-4" />ARCHITECTURE WORKSPACE</div>
        <h1 className="text-2xl font-semibold tracking-tight">{vm.record ? vm.draft?.title : "Diagrams"}</h1>
        <p className="mt-2 max-w-3xl whitespace-pre-line text-sm text-basalt-muted-foreground">{vm.draft?.description || "Map services, infrastructure, and the connections between them."}</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {vm.record && vm.draft && <>
          <span className="mr-2 font-mono text-xs text-basalt-muted-foreground">{vm.dirty ? "Unsaved changes" : `Revision ${vm.record.revision}`}</span>
          <Button variant="outline" size="sm" onClick={() => { if (vm.draft) downloadDiagram(vm.draft); }}><Download className="h-3.5 w-3.5" />Export JSON</Button>
          <Button size="sm" disabled={vm.busy || !vm.dirty} onClick={() => void vm.save()}><Save className="h-3.5 w-3.5" />{vm.busy ? "Saving…" : "Save changes"}</Button>
          <Button variant="ghost" size="sm" disabled={vm.busy} aria-label="Delete diagram" onClick={() => setConfirmDelete(true)}><Trash2 className="h-4 w-4" /></Button>
        </>}
        <Button variant="outline" size="sm" disabled={vm.busy || vm.dirty} onClick={() => file.current?.click()}><FileUp className="h-3.5 w-3.5" />Import JSON</Button>
        <Button variant="outline" size="sm" disabled={vm.busy || vm.dirty} onClick={() => void vm.create()}><Plus className="h-3.5 w-3.5" />New diagram</Button>
        <input ref={file} type="file" accept=".json,application/json" aria-label="Import diagram file" className="hidden" onChange={(event) => void importFile(event.target.files?.[0])} />
      </div>
    </div>
    {vm.error && <div role="alert" className="mb-4 whitespace-pre-wrap rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-700 dark:bg-red-950/30">{vm.error}</div>}
    {vm.notice && <p role="status" className="mb-4 flex items-center gap-2 text-sm text-basalt-muted-foreground"><Check className="h-4 w-4" />{vm.notice}</p>}
    {vm.loading ? <p role="status" className="py-12 text-center text-sm text-basalt-muted-foreground">Loading diagrams…</p>
      : vm.draft && vm.record ? <ArchitectureEditor key={vm.record.id} document={vm.draft} onChange={vm.setDraft} busy={vm.busy} />
        : <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">{vm.list.map((diagram) => <Link key={diagram.id} to={`/diagrams/${diagram.id}`} className="rounded-xl focus-visible:outline-2 focus-visible:outline-basalt-ring">
          <LayerCard className="h-full transition-colors hover:bg-basalt-secondary/40"><Network className="mb-6 h-6 w-6 text-basalt-primary" /><h2 className="text-base font-semibold">{diagram.title}</h2>
            <p className="mt-2 line-clamp-3 text-sm text-basalt-muted-foreground">{diagram.description || "Architecture diagram"}</p>
            <div className="mt-6 flex items-center gap-4 font-mono text-xs text-basalt-muted-foreground"><span>{diagram.nodeCount} components</span><span>{diagram.edgeCount} connections</span></div>
          </LayerCard></Link>)}
          {!vm.list.length && !vm.error && <LayerCard className="col-span-full py-16 text-center"><Network className="mx-auto mb-4 h-10 w-10 text-basalt-muted-foreground" /><h2 className="mb-2 text-lg font-medium">Your architecture starts here</h2><p className="text-sm text-basalt-muted-foreground">Create a diagram, or import a structured graph from your agent.</p></LayerCard>}
        </div>}
    <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}><DialogContent><DialogHeader><DialogTitle>Delete {vm.record?.title}?</DialogTitle><DialogDescription>This removes the diagram from your workspace. Export its JSON first if you need a copy.</DialogDescription></DialogHeader>
      <DialogFooter><Button variant="outline" onClick={() => setConfirmDelete(false)}>Cancel</Button><Button disabled={vm.busy} onClick={() => void vm.remove()}>Delete diagram</Button></DialogFooter>
    </DialogContent></Dialog>
    <Dialog open={vm.blocker.state === "blocked"} onOpenChange={(open) => { if (!open) vm.blocker.reset?.(); }}><DialogContent><DialogHeader><DialogTitle>Discard unsaved changes?</DialogTitle><DialogDescription>Your draft has changes that have not been saved.</DialogDescription></DialogHeader>
      <DialogFooter><Button variant="outline" onClick={() => vm.blocker.reset?.()}>Keep editing</Button><Button onClick={() => vm.blocker.proceed?.()}>Discard and leave</Button></DialogFooter>
    </DialogContent></Dialog>
  </div>;
}
