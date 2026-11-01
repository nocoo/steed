# 20 — Topology UI: selection crash, workspace space and partitioned layout

## Scope

v0.5.1 acceptance against a 245-node synthetic topology found three problems
on the read-only topology page. This document records the fixes delivered for
v0.5.2. Starting point: `main` at `60d0ff5` (v0.5.1). API issues are handled
on a separate branch and are out of scope.

1. **P0 crash.** Clicking a host and then one of its satellites blanks the
   page with React error #185 (maximum update depth exceeded).
2. **P1 space.** Page header, filter rows and inspector leave the canvas a
   small part of the viewport.
3. **P1 layout.** Lanes are stacked, boundaries are only chips, and dense
   layers read as one undifferentiated grid.

## 1. Selection crash

### Root cause

`TopologyCanvas` kept selection in two places:

- React Flow's internal node state (`useNodesState` + `onNodesChange` select
  changes), and
- the controlled `selected: node.id === selectedNodeId` flag in the projected
  nodes.

It also passed an inline `onSelectionChange` arrow. React Flow's
`SelectionListener` effect depends on that prop, so it re-ran on every render
and reported the store's currently selected nodes. Each `onSelect` rebuilt the
projected nodes and edges (the memo depended on `selectedNodeId`), which
re-seeded the store, re-rendered, and fired `onSelectionChange` again. While
the host and its satellite were both transiently selected, `nodes.find`
returned the host first, so the selection alternated host → satellite → host
until React aborted.

### Fix

- Nodes are fully controlled. No `useNodesState`, no `onNodesChange`, no
  `onSelectionChange`. Selection is applied by copying only the nodes whose
  `selected` flag changes.
- The projected nodes and edges do not depend on `selectedNodeId`.
- Selection goes through `onNodeClick` and the card keyboard handler, and is
  idempotent (selecting the selected node does nothing).
- Unit regression test: one click → one `onSelect`, stable edge identity,
  only the changed node is re-created, no selection/nodes change handlers.
- Browser regression test: click every rendered node of the acceptance
  topology (see "Browser lane").
- An error boundary wraps the topology workspace. A render error shows a
  local fallback with a retry button instead of blanking the app.

## 2. Workspace space

- The topology route renders a full-height workspace. The page header and the
  filter rows become one compact toolbar (title, revision, filters, counts,
  refresh, export, inspector toggle, fullscreen toggle).
- The canvas fills the remaining height (`flex-1 min-h-0`).
- The inspector (search and selected-node details) is a floating panel on the
  right of the canvas that can be collapsed. It opens when a node is
  selected.
- Selecting a node from search centres the canvas on it.
- Fullscreen uses the Fullscreen API on the workspace element.
- The app sidebar keeps its existing collapse toggle.

## 3. Partitioned layout and semantic zoom

The layout stays a deterministic custom packer in
`apps/web/src/lib/topology-layout.ts` (ELK remains a Phase 3 item).

- **Sections.** One section per layer, with a header band (label, provider,
  counts) and a background tinted from the layer colour. Sections sit on a
  grid with uniform column widths and generous gaps; the column count keeps
  the overall aspect near 16:10.
- **Composites.** Each host and its satellites form a vertical column: host,
  then satellites indented below, then sub-satellites indented further.
  Composites never overlap.
- **Boundary frames.** Hosts are grouped by a primary boundary (kind priority
  trust > site > network > account, then id) and its ancestor chain. Frames
  nest, have padding and a title, and never overlap. Other boundaries remain
  chips on the cards.
- **Pins** from a view become ordering hints: pinned hosts go first, ordered
  by pin `y`, then `x`. Absolute pin coordinates are no longer honoured.
- **Semantic zoom.** Zoomed out shows sections, frames and hosts only (with a
  satellite count); edges between satellites and edge labels are hidden. At
  medium zoom satellites appear without edge labels. Zoomed in shows
  everything.
- Clicking a section title fits that layer.

## Browser lane

`scripts/run-browser-e2e.ts` builds the web app, starts `wrangler dev` with an
isolated `.wrangler/browser-e2e-*` state, seeds the acceptance fixture
(`apps/web/e2e/acceptance-topology.json`) through the Connect API with a local
token, and drives Chromium with Playwright:

- clicks every rendered node and fails on any page error or blank page;
- `--screens <dir>` writes light/dark overview and layer screenshots;
- `--serve` keeps the seeded server running for manual checks.

It runs as `bun run test:browser` in a separate CI job. It is not part of
pre-push.

## Commit plan

1. `docs: plan topology ui crash and layout fixes`
2. `fix(web): stop topology selection update loop`
3. `feat(web): add topology error boundary`
4. `test(e2e): add topology browser lane`
5. `feat(web): compact full-height topology workspace`
6. `feat(web): partition topology layout by layer`
7. `feat(web): add topology semantic zoom`

## Known limitations

- No ELK; edges are not routed around frames.
- Only the primary boundary is drawn as a frame.
- View pins are ordering hints, not coordinates.
