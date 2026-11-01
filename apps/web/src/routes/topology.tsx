import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { Badge, Button, Input, Label, LayerCard } from "@nocoo/basalt";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@nocoo/basalt/components/select";
import { ArrowDownLeft, ArrowUpRight, Download, Maximize2, Minimize2, Network, PanelRightClose, PanelRightOpen, RefreshCw, Search, X } from "lucide-react";
import type { Topology, TopologyNode } from "@steed/api/shared";
import { useTopologyViewModel, type TopologyReach } from "@/viewmodels/use-topology-viewmodel";
import { downloadTopology } from "@/lib/topology-client";
import { ErrorBoundary } from "@/components/error-boundary";
import { topologyNodeBadgeValues, topologyNodeBoundaryLabels, TopologyCanvas, type TopologyFocusRequest } from "@/components/map/topology-canvas";

const sentinel = "\u0000";

function formatAttrValue(value: string | number | boolean | string[]): string {
  if (Array.isArray(value)) return value.join(", ");
  return String(value);
}

function satelliteNodes(topology: Topology, node: TopologyNode): TopologyNode[] {
  const descendants = new Set<string>();
  const queue = [node.id];
  for (const current of queue) {
    for (const child of topology.nodes.filter((candidate) => candidate.parentId === current)) {
      if (!descendants.has(child.id)) {
        descendants.add(child.id);
        queue.push(child.id);
      }
    }
  }
  return topology.nodes.filter((candidate) => descendants.has(candidate.id));
}

function useFullscreen() {
  const ref = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(false);
  useEffect(() => {
    const sync = () => setActive(document.fullscreenElement !== null && document.fullscreenElement === ref.current);
    document.addEventListener("fullscreenchange", sync);
    return () => document.removeEventListener("fullscreenchange", sync);
  }, []);
  const toggle = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    else void ref.current?.requestFullscreen?.().catch(() => undefined);
  }, []);
  return { ref, active, supported: typeof document !== "undefined" && document.fullscreenEnabled === true, toggle };
}

const iconButton = "h-8 w-8 shrink-0";

export function TopologyPage() {
  const vm = useTopologyViewModel();
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const [focus, setFocus] = useState<TopologyFocusRequest | undefined>();
  const fullscreen = useFullscreen();
  const topology = vm.topology;
  const selected = vm.selectedNode;

  const selectValue = (value: string) => value || sentinel;
  const actualValue = (value: string) => value === sentinel ? "" : value;
  const focusOn = (kind: TopologyFocusRequest["kind"], id: string) => setFocus((current) => ({ kind, id, seq: (current?.seq ?? 0) + 1 }));
  const revealNode = (id: string) => { vm.setSelectedNodeId(id); focusOn("node", id); };

  const typeOptions = topology ? [...topology.types].sort((a, b) => a.label.localeCompare(b.label) || a.id.localeCompare(b.id)) : [];
  const layerOptions = topology ? [...topology.layers].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id)) : [];
  const boundaryOptions = topology ? [...topology.boundaries].sort((a, b) => a.label.localeCompare(b.label) || a.id.localeCompare(b.id)) : [];
  const tags = topology ? [...new Set(topology.nodes.flatMap((node) => node.tags))].sort((a, b) => a.localeCompare(b)) : [];

  const selectedType = selected ? topology?.types.find((type) => type.id === selected.type) : undefined;
  const selectedLayer = selected ? topology?.layers.find((layer) => layer.id === selected.layerId) : undefined;
  const selectedBoundaries = selected && topology ? topologyNodeBoundaryLabels(topology, selected) : [];
  const selectedSatellites = selected && topology ? satelliteNodes(topology, selected) : [];
  const selectedEdges = selected && topology ? topology.edges.filter((edge) => edge.source === selected.id || edge.target === selected.id) : [];
  const trace = (direction: TopologyReach) => { if (selected) vm.traceNode(selected.id, direction); };
  const filtered = Boolean(vm.viewId || vm.layerId || vm.typeId || vm.boundaryId || vm.tag || vm.search);

  return (
    <div
      ref={fullscreen.ref}
      className="flex h-full min-h-0 flex-col gap-2 bg-basalt-card"
      data-testid="topology-workspace"
      data-fullscreen={fullscreen.active ? "true" : "false"}
      onKeyDown={(event) => { if (event.key === "Escape" && vm.selectedNodeId && !(event.target instanceof HTMLInputElement)) vm.setSelectedNodeId(""); }}
    >
      <div className={`flex flex-wrap items-center gap-2${fullscreen.active ? " px-3 pt-3" : ""}`} role="toolbar" aria-label="Topology toolbar">
        <Network className="h-4 w-4 shrink-0 text-basalt-primary" aria-hidden="true" />
        <h1 className="max-w-64 truncate text-sm font-semibold" title={topology?.description || "Canonical topology map."}>{topology?.title ?? "Topology"}</h1>
        {topology?.revision !== undefined && <Badge variant="outline" className="font-mono text-[10px]" title={vm.updatedAt ? `Updated ${vm.updatedAt}` : undefined}>Rev {topology.revision}</Badge>}
        {topology && topology.nodes.length > 0 && <>
          <span className="mx-1 hidden h-5 w-px bg-basalt-border md:block" aria-hidden="true" />
          <Label htmlFor="topology-view" className="sr-only">Topology view</Label>
          <Select value={selectValue(vm.viewId)} onValueChange={(value) => vm.setViewId(actualValue(value))}>
            <SelectTrigger id="topology-view" size="sm" className="h-8 w-auto max-w-56"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={sentinel}>All nodes · {topology.nodes.length}</SelectItem>
              {topology.views.map((view) => <SelectItem key={view.id} value={view.id}>{view.label}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={selectValue(vm.layerId)} onValueChange={(value) => vm.setLayerId(actualValue(value))}>
            <SelectTrigger aria-label="Layer filter" size="sm" className="h-8 w-auto max-w-44"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value={sentinel}>All layers</SelectItem>{layerOptions.map((layer) => <SelectItem key={layer.id} value={layer.id}>{layer.label}</SelectItem>)}</SelectContent>
          </Select>
          <Select value={selectValue(vm.typeId)} onValueChange={(value) => vm.setTypeId(actualValue(value))}>
            <SelectTrigger aria-label="Type filter" size="sm" className="h-8 w-auto max-w-44"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value={sentinel}>All types</SelectItem>{typeOptions.map((type) => <SelectItem key={type.id} value={type.id}>{type.label}</SelectItem>)}</SelectContent>
          </Select>
          <Select value={selectValue(vm.boundaryId)} onValueChange={(value) => vm.setBoundaryId(actualValue(value))}>
            <SelectTrigger aria-label="Boundary filter" size="sm" className="h-8 w-auto max-w-44"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value={sentinel}>All boundaries</SelectItem>{boundaryOptions.map((boundary) => <SelectItem key={boundary.id} value={boundary.id}>{boundary.label}</SelectItem>)}</SelectContent>
          </Select>
          <Select value={selectValue(vm.tag)} onValueChange={(value) => vm.setTag(actualValue(value))}>
            <SelectTrigger aria-label="Tag filter" size="sm" className="h-8 w-auto max-w-44"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value={sentinel}>All tags</SelectItem>{tags.map((tag) => <SelectItem key={tag} value={tag}>{tag}</SelectItem>)}</SelectContent>
          </Select>
          {filtered && <Button variant="ghost" size="sm" className="h-8" onClick={() => vm.clearFilters()} aria-label="Clear filters"><X className="h-3 w-3" />Clear</Button>}
          <span className="font-mono text-xs text-basalt-muted-foreground" aria-live="polite">{vm.visibleNodes.length} nodes · {vm.visibleEdges.length} edges</span>
        </>}
        <div className="ml-auto flex items-center gap-1">
          <Button variant="ghost" size="icon" className={iconButton} onClick={() => vm.reload()} disabled={vm.busy || vm.loading} aria-label="Refresh topology" title="Refresh">
            <RefreshCw className={`h-4 w-4${vm.busy ? " animate-spin" : ""}`} />
          </Button>
          <Button variant="ghost" size="icon" className={iconButton} disabled={!topology} onClick={() => { if (topology) downloadTopology(topology); }} aria-label="Export JSON" title="Export JSON">
            <Download className="h-4 w-4" />
          </Button>
          {topology && topology.nodes.length > 0 && <Button variant="ghost" size="icon" className={iconButton} onClick={() => setInspectorOpen((value) => !value)} aria-label={inspectorOpen ? "Hide inspector" : "Show inspector"} aria-pressed={inspectorOpen} title={inspectorOpen ? "Hide inspector" : "Find / inspect"}>
            {inspectorOpen ? <PanelRightClose className="h-4 w-4" /> : <PanelRightOpen className="h-4 w-4" />}
          </Button>}
          {fullscreen.supported && <Button variant="ghost" size="icon" className={iconButton} onClick={fullscreen.toggle} aria-label={fullscreen.active ? "Exit fullscreen" : "Enter fullscreen"} title={fullscreen.active ? "Exit fullscreen" : "Fullscreen"}>
            {fullscreen.active ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
          </Button>}
        </div>
      </div>

      {vm.error && <div role="alert" className="whitespace-pre-wrap rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/30">{vm.error}</div>}
      {vm.trace && topology && <p className="flex items-center gap-2 text-xs text-basalt-muted-foreground">
        <span>{vm.trace.direction} relationships for {topology.nodes.find((node) => node.id === vm.trace?.id)?.label ?? vm.trace.id}</span>
        <Button variant="outline" size="sm" className="h-7" onClick={() => vm.clearTrace()}><X className="h-3 w-3" />Clear trace</Button>
      </p>}

      {vm.loading ? <p role="status" className="py-12 text-center text-sm text-basalt-muted-foreground">Loading topology…</p>
        : !topology ? null
          : topology.nodes.length === 0 ? (
            <LayerCard className="col-span-full">
              <LayerCard.Empty
                icon={<Network />}
                title="Your topology is empty"
                description="Structure is written through the Connect API."
              />
              <Link className="mx-auto mt-3 text-sm text-basalt-primary underline" to="/connect">Open Connect</Link>
            </LayerCard>
          ) : (
            <div className={`relative min-h-[360px] flex-1 overflow-hidden border border-basalt-border bg-basalt-background${fullscreen.active ? "" : " rounded-xl"}`}>
              <ErrorBoundary label="Topology canvas" className="h-full" resetKeys={[topology]}>
                <TopologyCanvas
                  topology={topology}
                  visibleNodes={vm.visibleNodes}
                  visibleEdges={vm.visibleEdges}
                  view={vm.selectedView ?? undefined}
                  selectedNodeId={vm.selectedNodeId}
                  onSelect={vm.setSelectedNodeId}
                  focus={focus}
                />
              </ErrorBoundary>

              {inspectorOpen && <aside className="absolute right-3 top-3 bottom-3 z-10 flex w-80 max-w-[calc(100%-1.5rem)] flex-col gap-3 overflow-y-auto rounded-xl border border-basalt-border bg-basalt-card/95 p-3 shadow-lg backdrop-blur" aria-label="Topology inspector">
                <div>
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <label htmlFor="topology-search" className="flex items-center gap-2 text-sm font-semibold"><Search className="h-4 w-4" />Find a node</label>
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setInspectorOpen(false)} aria-label="Close inspector"><X className="h-3.5 w-3.5" /></Button>
                  </div>
                  <Input id="topology-search" value={vm.search} onChange={(event) => vm.setSearch(event.target.value)} placeholder="Name, type, tag, attribute…" />
                  {vm.search && <div className="mt-2 max-h-60 space-y-1 overflow-auto" aria-label="Topology search results">
                    {!vm.searchResults.length && <p className="text-xs text-basalt-muted-foreground">No matching nodes.</p>}
                    {vm.searchResults.map((match) => <button key={match.id} type="button" data-node-id={match.id} className="block w-full rounded p-2 text-left text-xs hover:bg-basalt-secondary focus-visible:outline-2" onClick={() => revealNode(match.id)}>
                      <span className="block font-medium">{match.label}</span><span className="text-basalt-muted-foreground">{match.type}</span>
                    </button>)}
                  </div>}
                </div>

                {!selected && <p className="text-xs text-basalt-muted-foreground">Select a node to see its details. Click a section title to focus a layer.</p>}
                {selected && <ErrorBoundary label="Node details" resetKeys={[topology, selected.id]}><div className="border-t border-basalt-border pt-3">
                  <div className="mb-3 flex items-start justify-between gap-2">
                    <h2 className="break-words text-sm font-semibold">{selected.label}</h2>
                    <Badge variant="outline">{selected.lifecycle}</Badge>
                  </div>
                  <p className="whitespace-pre-wrap break-words text-xs leading-relaxed text-basalt-muted-foreground">{selected.description || "No description."}</p>
                  {selected.url && <a href={selected.url} target="_blank" rel="noopener noreferrer" className="mt-3 block break-all text-xs text-basalt-primary underline">{selected.url}</a>}
                  <div className="mt-3 flex flex-wrap gap-2"><Button variant="outline" size="sm" onClick={() => revealNode(selected.id)}><Search className="h-3 w-3" />Center</Button><Button variant="outline" size="sm" onClick={() => trace("upstream")}><ArrowDownLeft className="h-3 w-3" />Upstream</Button><Button variant="outline" size="sm" onClick={() => trace("downstream")}><ArrowUpRight className="h-3 w-3" />Downstream</Button></div>
                  <dl className="mt-4 grid gap-2 text-xs">
                    <div><dt className="font-semibold">Type</dt><dd className="text-basalt-muted-foreground">{selectedType?.label ?? selected.type}</dd></div>
                    <div><dt className="font-semibold">Layer</dt><dd className="text-basalt-muted-foreground">{selectedLayer?.label ?? selected.layerId}</dd></div>
                    <div><dt className="font-semibold">Provenance</dt><dd className="font-mono text-basalt-muted-foreground">{selected.provenance ?? "Not set"}</dd></div>
                  </dl>
                  <div className="mt-4"><h3 className="mb-2 text-xs font-semibold">Badges</h3><div className="flex flex-wrap gap-1">{topologyNodeBadgeValues(topology, selected).map((badge) => <Badge key={`${badge.label}:${badge.value}`} variant="secondary" className="text-[10px]">{badge.label}: {badge.value}</Badge>)}</div></div>
                  <div className="mt-4"><h3 className="mb-2 text-xs font-semibold">Boundaries</h3><div className="flex flex-wrap gap-1">{selectedBoundaries.map((label) => <Badge key={label} variant="outline" className="text-[10px]">{label}</Badge>)}{!selectedBoundaries.length && <p className="text-xs text-basalt-muted-foreground">None</p>}</div></div>
                  <div className="mt-4"><h3 className="mb-2 text-xs font-semibold">Attributes</h3><dl className="space-y-1 text-xs">{Object.entries(selected.attrs).map(([key, value]) => <div key={key} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-2"><dt className="font-mono text-basalt-muted-foreground">{key}</dt><dd className="break-all">{formatAttrValue(value)}</dd></div>)}{!Object.keys(selected.attrs).length && <p className="text-xs text-basalt-muted-foreground">None</p>}</dl></div>
                  {selected.tags.length > 0 && <div className="mt-4"><h3 className="mb-2 text-xs font-semibold">Tags</h3><div className="flex flex-wrap gap-1">{selected.tags.map((tag) => <Badge key={tag} variant="secondary" className="text-[10px]">{tag}</Badge>)}</div></div>}
                  <div className="mt-4"><h3 className="mb-2 text-xs font-semibold">Satellites</h3>{selectedSatellites.length ? <div className="space-y-1">{selectedSatellites.map((node) => <button key={node.id} type="button" className="block w-full rounded p-2 text-left text-xs hover:bg-basalt-secondary" onClick={() => revealNode(node.id)}>{node.label}<span className="ml-2 text-basalt-muted-foreground">{node.id}</span></button>)}</div> : <p className="text-xs text-basalt-muted-foreground">None</p>}</div>
                  <div className="mt-4"><h3 className="mb-2 text-xs font-semibold">{selectedEdges.length} edges</h3><div className="space-y-1">{selectedEdges.map((edge) => { const otherId = edge.source === selected.id ? edge.target : edge.source; const other = topology.nodes.find((node) => node.id === otherId); const relativeArrow = edge.direction === "bi" ? "↔" : edge.source === selected.id ? "→" : "←"; return <button key={edge.id} type="button" className="block w-full rounded p-2 text-left text-xs hover:bg-basalt-secondary" onClick={() => revealNode(otherId)}><span className="block">{relativeArrow} {other?.label ?? otherId}</span><span className="text-basalt-muted-foreground">{edge.label || edge.kind} · {edge.evidence}</span></button>; })}{!selectedEdges.length && <p className="text-xs text-basalt-muted-foreground">None</p>}</div></div>
                </div></ErrorBoundary>}
              </aside>}
            </div>
          )}
    </div>
  );
}
