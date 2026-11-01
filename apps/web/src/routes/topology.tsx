import { useState } from "react";
import { Link } from "react-router";
import { Badge, Button, Input, Label, LayerCard } from "@nocoo/basalt";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@nocoo/basalt/components/select";
import { PageHeader } from "@nocoo/basalt/components/page-header";
import { ArrowDownLeft, ArrowUpRight, Download, Network, RefreshCw, Search, X } from "lucide-react";
import type { Topology, TopologyNode } from "@steed/api/shared";
import { useTopologyViewModel, type TopologyReach } from "@/viewmodels/use-topology-viewmodel";
import { downloadTopology } from "@/lib/topology-client";
import { ErrorBoundary } from "@/components/error-boundary";
import { topologyNodeBadgeValues, topologyNodeBoundaryLabels, TopologyCanvas } from "@/components/map/topology-canvas";

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

export function TopologyPage() {
  const vm = useTopologyViewModel();
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const topology = vm.topology;
  const selected = vm.selectedNode;

  const selectValue = (value: string) => value || sentinel;
  const actualValue = (value: string) => value === sentinel ? "" : value;

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

  return (
    <div className="space-y-basalt-layout-lg">
      <PageHeader
        title={topology?.title ?? "Topology"}
        description={topology?.description || "Canonical topology map."}
        actions={
          <>
            {topology?.revision !== undefined && <Badge variant="outline" className="mr-2 font-mono">Revision {topology.revision}</Badge>}
            {vm.updatedAt && <span className="mr-2 hidden font-mono text-xs text-basalt-muted-foreground md:inline">Updated {vm.updatedAt}</span>}
            <Button variant="outline" size="sm" onClick={() => vm.reload()} disabled={vm.busy || vm.loading}>
              <RefreshCw className="h-3.5 w-3.5" />Refresh
            </Button>
            <Button variant="outline" size="sm" disabled={!topology} onClick={() => { if (topology) downloadTopology(topology); }}>
              <Download className="h-3.5 w-3.5" />Export JSON
            </Button>
          </>
        }
      />

      {vm.error && <div role="alert" className="whitespace-pre-wrap rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-700 dark:bg-red-950/30">{vm.error}</div>}
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
          ) : <>
            <div className="mb-basalt-layout flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <Label htmlFor="topology-view" className="sr-only">Topology view</Label>
                <Select value={selectValue(vm.viewId)} onValueChange={(value) => vm.setViewId(actualValue(value))}>
                  <SelectTrigger id="topology-view" className="w-auto max-w-64"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={sentinel}>All nodes · {topology.nodes.length}</SelectItem>
                    {topology.views.map((view) => <SelectItem key={view.id} value={view.id}>{view.label}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Select value={selectValue(vm.layerId)} onValueChange={(value) => vm.setLayerId(actualValue(value))}>
                  <SelectTrigger aria-label="Layer filter" className="w-auto max-w-48"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value={sentinel}>All layers</SelectItem>{layerOptions.map((layer) => <SelectItem key={layer.id} value={layer.id}>{layer.label}</SelectItem>)}</SelectContent>
                </Select>
                <Select value={selectValue(vm.typeId)} onValueChange={(value) => vm.setTypeId(actualValue(value))}>
                  <SelectTrigger aria-label="Type filter" className="w-auto max-w-48"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value={sentinel}>All types</SelectItem>{typeOptions.map((type) => <SelectItem key={type.id} value={type.id}>{type.label}</SelectItem>)}</SelectContent>
                </Select>
                <Select value={selectValue(vm.boundaryId)} onValueChange={(value) => vm.setBoundaryId(actualValue(value))}>
                  <SelectTrigger aria-label="Boundary filter" className="w-auto max-w-48"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value={sentinel}>All boundaries</SelectItem>{boundaryOptions.map((boundary) => <SelectItem key={boundary.id} value={boundary.id}>{boundary.label}</SelectItem>)}</SelectContent>
                </Select>
                <Select value={selectValue(vm.tag)} onValueChange={(value) => vm.setTag(actualValue(value))}>
                  <SelectTrigger aria-label="Tag filter" className="w-auto max-w-48"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value={sentinel}>All tags</SelectItem>{tags.map((tag) => <SelectItem key={tag} value={tag}>{tag}</SelectItem>)}</SelectContent>
                </Select>
                {(vm.viewId || vm.layerId || vm.typeId || vm.boundaryId || vm.tag || vm.search) && <Button variant="outline" size="sm" onClick={() => vm.clearFilters()}><X className="h-3 w-3" />Clear filters</Button>}
                <Badge variant="outline">{vm.visibleNodes.length} nodes</Badge>
                <Badge variant="outline">{vm.visibleEdges.length} edges</Badge>
              </div>
              <Button variant="outline" size="sm" onClick={() => setInspectorOpen((value) => !value)}><Search className="h-3.5 w-3.5" />{inspectorOpen ? "Hide details" : "Find / inspect"}</Button>
            </div>

            {vm.trace && <p className="mb-4 flex items-center gap-2 text-sm text-basalt-muted-foreground">
              <span>{vm.trace.direction} relationships for {topology.nodes.find((node) => node.id === vm.trace?.id)?.label ?? vm.trace.id}</span>
              <Button variant="outline" size="sm" onClick={() => vm.clearTrace()}><X className="h-3 w-3" />Clear trace</Button>
            </p>}

            <div className={`grid gap-4${inspectorOpen ? " xl:grid-cols-[minmax(0,1fr)_300px]" : ""}`}>
              <LayerCard padding="none" className="h-[calc(100dvh-420px)] min-h-[440px] overflow-hidden">
                <ErrorBoundary label="Topology canvas" className="h-full" resetKeys={[topology]}>
                  <TopologyCanvas
                    topology={topology}
                    visibleNodes={vm.visibleNodes}
                    visibleEdges={vm.visibleEdges}
                    view={vm.selectedView ?? undefined}
                    selectedNodeId={vm.selectedNodeId}
                    onSelect={vm.setSelectedNodeId}
                  />
                </ErrorBoundary>
              </LayerCard>

              {inspectorOpen && <aside className="flex max-h-[calc(100dvh-420px)] min-h-[440px] flex-col gap-4 overflow-y-auto" aria-label="Topology inspector">
                <LayerCard>
                  <label htmlFor="topology-search" className="mb-2 flex items-center gap-2 text-sm font-semibold"><Search className="h-4 w-4" />Find a node</label>
                  <Input id="topology-search" value={vm.search} onChange={(event) => vm.setSearch(event.target.value)} placeholder="Name, type, tag, attribute…" />
                  {vm.search && <div className="mt-3 max-h-60 space-y-1 overflow-auto" aria-label="Topology search results">
                    {!vm.searchResults.length && <p className="text-xs text-basalt-muted-foreground">No matching nodes.</p>}
                    {vm.searchResults.map((match) => <button key={match.id} type="button" className="block w-full rounded p-2 text-left text-xs hover:bg-basalt-secondary focus-visible:outline-2" onClick={() => vm.setSelectedNodeId(match.id)}>
                      <span className="block font-medium">{match.label}</span><span className="text-basalt-muted-foreground">{match.type}</span>
                    </button>)}
                  </div>}
                </LayerCard>

                {selected && topology && <ErrorBoundary label="Node details" resetKeys={[topology, selected.id]}><LayerCard>
                  <div className="mb-3 flex items-start justify-between gap-2">
                    <h2 className="break-words text-sm font-semibold">{selected.label}</h2>
                    <Badge variant="outline">{selected.lifecycle}</Badge>
                  </div>
                  <p className="whitespace-pre-wrap break-words text-xs leading-relaxed text-basalt-muted-foreground">{selected.description || "No description."}</p>
                  {selected.url && <a href={selected.url} target="_blank" rel="noopener noreferrer" className="mt-3 block break-all text-xs text-basalt-primary underline">{selected.url}</a>}
                  <div className="mt-3 flex flex-wrap gap-2"><Button variant="outline" size="sm" onClick={() => trace("upstream")}><ArrowDownLeft className="h-3 w-3" />Upstream</Button><Button variant="outline" size="sm" onClick={() => trace("downstream")}><ArrowUpRight className="h-3 w-3" />Downstream</Button></div>
                  <dl className="mt-4 grid gap-2 text-xs">
                    <div><dt className="font-semibold">Type</dt><dd className="text-basalt-muted-foreground">{selectedType?.label ?? selected.type}</dd></div>
                    <div><dt className="font-semibold">Layer</dt><dd className="text-basalt-muted-foreground">{selectedLayer?.label ?? selected.layerId}</dd></div>
                    <div><dt className="font-semibold">Provenance</dt><dd className="font-mono text-basalt-muted-foreground">{selected.provenance ?? "Not set"}</dd></div>
                  </dl>
                  <div className="mt-4"><h3 className="mb-2 text-xs font-semibold">Badges</h3><div className="flex flex-wrap gap-1">{topologyNodeBadgeValues(topology, selected).map((badge) => <Badge key={`${badge.label}:${badge.value}`} variant="secondary" className="text-[10px]">{badge.label}: {badge.value}</Badge>)}</div></div>
                  <div className="mt-4"><h3 className="mb-2 text-xs font-semibold">Boundaries</h3><div className="flex flex-wrap gap-1">{selectedBoundaries.map((label) => <Badge key={label} variant="outline" className="text-[10px]">{label}</Badge>)}{!selectedBoundaries.length && <p className="text-xs text-basalt-muted-foreground">None</p>}</div></div>
                  <div className="mt-4"><h3 className="mb-2 text-xs font-semibold">Attributes</h3><dl className="space-y-1 text-xs">{Object.entries(selected.attrs).map(([key, value]) => <div key={key} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-2"><dt className="font-mono text-basalt-muted-foreground">{key}</dt><dd className="break-all">{formatAttrValue(value)}</dd></div>)}{!Object.keys(selected.attrs).length && <p className="text-xs text-basalt-muted-foreground">None</p>}</dl></div>
                  {selected.tags.length > 0 && <div className="mt-4"><h3 className="mb-2 text-xs font-semibold">Tags</h3><div className="flex flex-wrap gap-1">{selected.tags.map((tag) => <Badge key={tag} variant="secondary" className="text-[10px]">{tag}</Badge>)}</div></div>}
                  <div className="mt-4"><h3 className="mb-2 text-xs font-semibold">Satellites</h3>{selectedSatellites.length ? <div className="space-y-1">{selectedSatellites.map((node) => <button key={node.id} type="button" className="block w-full rounded p-2 text-left text-xs hover:bg-basalt-secondary" onClick={() => vm.setSelectedNodeId(node.id)}>{node.label}<span className="ml-2 text-basalt-muted-foreground">{node.id}</span></button>)}</div> : <p className="text-xs text-basalt-muted-foreground">None</p>}</div>
                  <div className="mt-4"><h3 className="mb-2 text-xs font-semibold">{selectedEdges.length} edges</h3><div className="space-y-1">{selectedEdges.map((edge) => { const otherId = edge.source === selected.id ? edge.target : edge.source; const other = topology.nodes.find((node) => node.id === otherId); const relativeArrow = edge.direction === "bi" ? "↔" : edge.source === selected.id ? "→" : "←"; return <button key={edge.id} type="button" className="block w-full rounded p-2 text-left text-xs hover:bg-basalt-secondary" onClick={() => vm.setSelectedNodeId(otherId)}><span className="block">{relativeArrow} {other?.label ?? otherId}</span><span className="text-basalt-muted-foreground">{edge.label || edge.kind} · {edge.evidence}</span></button>; })}{!selectedEdges.length && <p className="text-xs text-basalt-muted-foreground">None</p>}</div></div>
                </LayerCard></ErrorBoundary>}
              </aside>}
            </div>
          </>}
    </div>
  );
}
