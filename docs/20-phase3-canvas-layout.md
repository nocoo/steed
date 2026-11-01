# 20 — Phase 3: canvas, auto-layout and edge routing

## Scope and decisions

Phase 3 turns the read-only topology page into a tidy, readable canvas:
edges routed around frames and cards, every boundary membership framed,
three semantic zoom levels with legible text, layer focus that shows only the
focused section, every node shape and border style from the v2 schema, and a
navigation sidebar that can be hidden for more canvas. The work starts from
`main` at `86be6c8` (v0.5.4; Phases 1 and 2 were delivered by document 19
and the 0.5.x patches). Implementation starts only after the requirements owner
approves this document. The requirements owner approved it on 2026-11-01;
the nine decisions are recorded in [Decisions](#decisions-requirements-owner-2026-11-01).

Inputs: the roadmap (section 7 Phase 3, sections 4, 6 and 8, kept privately
by the requirements owner) and the requirements owner's Phase 3 brief of
2026-11-01, which also lists the known limitations of the v0.5.2 canvas.

Decisions taken in this document (each explained below):

1. **Keep the custom partition placement; add a custom orthogonal edge
   router instead of ELK.** The brief allows "ELK orthogonal routing or an
   equivalent". ELK cannot route around already-placed nodes in `elkjs`, and
   replacing the placement would give up the zero-overlap section grid.
2. **No API, D1 or schema change.** Every style field this phase renders is
   already stored and validated since 0.5.0.
3. **Layout runs in a Web Worker** with a synchronous fallback, keyed by
   topology revision, view and a layout version.
4. **Upgrade `reactflow@11` to `@xyflow/react@12`** as its own commit with no
   behaviour change.
5. **Release `0.6.0`** (minor: new canvas features, no breaking API change).
6. **The overview bundles cross-layer edges** into one counted bundle per
   layer pair, expanded at the standard level (decision 4).

### Traceability

| Requirement | Source | Section |
|---|---|---|
| Upgrade to `@xyflow/react@12` | roadmap §7 Phase 3 | [Rendering stack](#rendering-stack) |
| Layer lanes + boundary composites + satellite blocks, pure and unit-tested | roadmap §7 Phase 3 | [Placement](#placement) |
| ELK (Web Worker) | roadmap §4, §7 Phase 3 | [Router decision](#router-decision-custom-orthogonal-router-not-elk) |
| Layout result cache, pin support | roadmap §4.3–4.4, §7 | [Worker, cache and determinism](#worker-cache-and-determinism) |
| Three semantic zoom levels | roadmap §4.5, §7; limitation 3 | [Semantic zoom](#semantic-zoom-three-levels) |
| Readable large topology at a glance (layer-pair edge bundles) | decision 4 | [Overview edge bundles](#overview-edge-bundles) |
| Node shapes, colour, size, icon, border, lifecycle light, label chips | roadmap §7 | [Shapes and styles](#shapes-and-border-styles) |
| Orthogonal edges, label capsule, protocol/port, arrows, animation | roadmap §6, §7 | [Edge rendering](#edge-rendering) |
| Limitation 1: edges must avoid frames and nodes, keep zero overlaps | brief | [Edge routing](#edge-routing) |
| Limitation 2: nested boundaries also framed | brief | [Frames for every membership](#frames-for-every-boundary-membership) |
| Limitation 3: overview text too small | brief | [Semantic zoom](#semantic-zoom-three-levels) |
| Limitation 4: focus shows neighbour fragments; off-screen section buttons missing | brief | [Layer focus](#layer-focus-clipped-to-its-section) |
| Limitation 5: all shapes and border styles | brief | [Shapes and styles](#shapes-and-border-styles) |
| Collapsible left sidebar | brief | [Sidebar](#collapsible-sidebar) |
| Acceptance: unit tests, Playwright 200-node geometry, 500-node < 2 s, light/dark screenshots | roadmap §7; brief | [Test plan](#test-plan) |
| Local datasets only | brief | [Fixtures](#local-fixture-datasets) |

### Non-goals

- Ghost nodes for cross-layer neighbours (decision 5) and boundary collapse
  (Phase 4's only aggregation; layer-pair edge bundles are Phase 3), node
  upstream/downstream focus redesign, boundary collapse, ⌘K palette,
  change-history panel, saved views (Phase 4).
- Satellite badge tiers beyond what the three zoom levels need, VPS
  attribute templates (Phase 4).
- The MOSS-style visual design system, brand icon library and design-review
  sign-off (Phase 5). Phase 3 uses theme tokens so Phase 5 can re-skin.
- Browser editing, drag-to-pin or any write from the browser (the browser
  stays read-only; pins are written through the API as today).
- Any change to the topology API, D1, Connect or production data.
- Pixel-diff screenshot baselines (decision 8): geometry assertions are the
  gate; screenshots are archived only.

## Current-state evidence

From `main` at `86be6c8`:

- `apps/web/src/lib/topology-layout.ts` (313 lines) is a deterministic pure
  placer. Each layer is a section; hosts with their satellites form fixed
  column blocks (host 240×112, satellite 64 high, indents 24/48); blocks are
  grouped by the host's **primary** boundary path (kind priority
  trust < site < network < account, then ID) and shelf-packed; sections are
  arranged in a grid whose column count best matches a 1.6 aspect. Pins
  only order hosts. Overlap freedom is tested on the acceptance fixture.
- `apps/web/src/components/map/topology-canvas.tsx` (494 lines) projects
  the layout into React Flow v11 nodes (sections, frames, cards). Edges use
  built-in `smoothstep` (same layer) or bezier (`default`, cross-layer) with
  handles picked by relative position, so they cut through cards, frames and
  sections. Node style fields (`shape`, `size`, `border`, `icon`, `color`)
  are not rendered; every card is a rounded rectangle.
- Zoom tiers exist (`far` < 0.4 ≤ `mid` < 0.75 ≤ `near`) but are pure CSS
  show/hide; far-tier host titles are 26 px in canvas units, about 7–10 px on
  screen at a whole-map fit.
- "Focus layer" fits the viewport to a section rectangle; because the
  viewport aspect differs from the section's, neighbouring sections show at
  the edges. Section header buttons are canvas nodes, so with
  `onlyRenderVisibleElements` an off-screen section has no button.
- The sidebar (`app-sidebar.tsx`, Basalt `Sidebar`) collapses to an icon
  rail, persisted in `localStorage` (`sidebar-expanded`); it never hides.
- L3 (`scripts/run-browser-e2e.ts`) seeds `apps/web/e2e/acceptance-topology.json`
  (7 layers, 6 boundaries, 245 nodes, 105 edges) into an isolated local D1
  and clicks every node; `--screens` writes light/dark screenshots. CI runs
  L1, L2 and L3 through `nocoo/base-ci` `quality.yml`.
- Production bundle today: one JS chunk, 863 kB minified / 268 kB gzip;
  CSS 21 kB gzip.
- Package facts (npm, 2026-11-01): `elkjs@0.12.1` (EPL-2.0 OR GPL-3.0),
  `elk.bundled.js` 1.65 MB / 477 kB gzip, `elk-worker.min.js` 472 kB gzip;
  `@xyflow/react@12.12.0` (MIT); `libavoid-js@0.5.0-beta.5` (LGPL-2.1,
  WASM, beta).

## Rendering stack

- `reactflow@11` → `@xyflow/react@12` in a dedicated commit. Mechanical
  changes: imports, `NodeProps`/`EdgeProps` generics, `getNodesBounds` and
  `getViewportForBounds` signatures, fixed `width`/`height` on nodes (we
  never rely on measurement), `useStore` selectors, CSS import path. The
  page must look and behave the same; existing L1 and L3 tests are the
  proof.
- Custom node types: `topologySection`, `topologyFrame`, `topologyCard`
  (host, satellite, sub-satellite). Custom edge type `topologyRoute` draws a
  precomputed polyline; React Flow never computes edge paths.
- `onlyRenderVisibleElements` stays on. Anything that must always be
  reachable (layer navigation) moves out of the canvas into the toolbar.

## Layout architecture

The layout pipeline is three pure stages, all in `apps/web/src/lib/layout/`:

```text
resolveStyles(topology)            → per-node shape, size, colours, icon
place(topology, styles, options)   → sections, frames, blocks, card rects
route(placement, edges, options)   → per-edge orthogonal polyline + label box
```

Each stage is a pure function of its inputs; the worker only wraps them.

### Placement

The existing algorithm is kept and extended, because it already guarantees
zero overlaps by construction and keeps layers apart:

- **Sections**: one per layer, in `order` then ID, arranged in the
  aspect-fitting grid (row-major). Unchanged.
- **Host blocks**: a host and its satellites/sub-satellites in one column.
  Card sizes now come from the resolved size (see below), so a block's size
  is computed before packing and adding satellites never shifts other
  blocks into overlap.
- **Frames**: see the next section; frames nest strictly (laminar), so
  shelf packing inside each frame stays overlap-free.
- **Routing channels**: gaps are widened just enough for edges: item gap
  56 → 64, frame padding 24 → 32, section gap 160 (unchanged). The router
  uses these gaps as its corridors. Exact values are tuned in the router
  commit and recorded in this document.
- **Pins**: unchanged semantics (pinned hosts first, by y then x then ID).

### Frames for every boundary membership

Today only the host's primary boundary path is framed. A host can belong to
several boundaries that are not ancestors of one another (for example
`site:home` and `network:tailnet`), and a boundary can span several layers.
Rectangles cannot represent arbitrary overlapping sets without overlaps, so
the placer builds a **laminar frame tree** per section:

1. For each host, take all `boundaryIds` plus their ancestors (via
   `parentId`).
2. Order them into one chain: explicit parent/child order is kept; unrelated
   boundary trees are ordered by kind priority (trust, site, network,
   account), then ID. Example: `home (trust) › home-lan (network) ›
   tailnet (network)`.
3. Insert the host into the section's frame tree along that chain.

Result: every membership of every host is drawn as a frame, frames never
overlap, and nesting depth equals the chain length (validated maximum is
8 memberships per node; the renderer caps visual nesting at 6 levels and
lists deeper ones on the card chip). A boundary that spans layers or is not
laminar with others appears as several **fragments**. Fragments share the
boundary's title, colour and border style (decision 2); the title gets a
suffix `(i/n)`, for example `Tailnet (1/3)`, numbered in section order then
frame position. Hovering any fragment highlights all of them. A boundary
drawn once has no suffix. Satellites inherit the
root host's frames, as today.

### Router decision: custom orthogonal router, not ELK

| Option | Fits "keep current partition, zero overlaps" | Routes around frames and cards | Bundle (gzip) | Determinism | Verdict |
|---|---|---|---|---|---|
| ELK Layered, full layout (positions + routes) | No: layered places partitions in one row/column, not the section grid; replacing placement loses the proven grid | Yes inside one hierarchy with `INCLUDE_CHILDREN` | +472–477 kB (more than today's whole app) | Yes | Rejected |
| ELK rectpacking for sections + layered inside | Partly | No: cross-section edges are not routed across rectpacking parents | +477 kB | Yes | Rejected |
| ELK `fixed` + routing on our coordinates | Yes | No: `elkjs` has no obstacle-avoiding router for fixed nodes (libavoid is not in `elkjs`) | +477 kB | Yes | Rejected |
| `libavoid-js` (WASM libavoid) | Yes | Yes | ~250–350 kB WASM | Yes | Rejected: LGPL-2.1 and beta (decision 1) |
| **Custom orthogonal router (pure TS)** | **Yes** | **Yes** | **~10–15 kB** | **Yes, by construction** | **Chosen** |

The custom router follows the standard orthogonal connector routing method
(Wybrow, Marriott and Stuckey, 2009) on our fixed geometry:

1. **Obstacles.** Every card rectangle, inflated by a 12 px margin. Frames
   and sections are obstacles for an edge unless they contain one of its
   endpoints; an edge leaving a frame may cross its border only once, and
   never through a frame or section header. Endpoint cards themselves are
   open only at their port.
2. **Ports.** Each card has four sides; the side is chosen per edge from the
   relative direction of the two endpoints' section/frame positions, then
   ties by edge ID. Multiple edges on one side are spread evenly along it in
   a stable order (by the other endpoint's position, then edge ID); for
   non-rectangular shapes ports collapse to the side midpoint, which lies on
   every shape outline.
3. **Orthogonal visibility graph.** Built with a sweep line over obstacle
   edges plus port stubs (O(n log n + segments)); built once per layout and
   shared by all edges. Large graphs are built per section plus one global
   graph of section gutters, so cross-section edges travel in the 160 px
   gaps.
4. **Search.** A* per edge with cost = length + bend penalty (equal to 40 px)
   + a small crossing penalty against already-routed edges; ties broken by
   coordinates, then edge ID. Edges are routed in a stable order (same
   section first, then by source ID, target ID, edge ID).
5. **Nudging.** Parallel segments that share a channel are separated by
   6 px in a stable order, so overlapping edges become distinct lanes.
6. **Labels.** The label capsule is placed on the longest horizontal
   segment; if it would overlap a card or an earlier label it slides along
   the route, then hides at that zoom level (always listed in the inspector).
7. **Fallback (decision 1).** Routing never blocks rendering. If an edge
   has no orthogonal solution, or the routing time budget (20 ms per edge,
   1500 ms per layout pass) is exhausted, that edge and every edge not yet
   routed get a straight segment between their ports, marked
   `fallback: "no_path" | "timeout"` in the result. Failures are recorded in
   `result.diagnostics.routeFailures` (edge ID and reason), exposed on the
   edge as `data-route="fallback"` and on the canvas as
   `data-route-failures`; one `console.warn` summarises them. Cards and
   frames render regardless. Unit tests force both failure modes (an
   enclosed endpoint, and an injected clock) and assert the straight
   fallback, the recorded failure and a complete result. The fixtures must
   produce zero fallbacks (L1 and L3 fail otherwise).

ELK stays an option for the future only if placement itself must change.

### Worker, cache and determinism

- **Off main thread.** `layout.worker.ts` (Vite module worker) runs the three
  stages. The page posts `{requestId, layoutVersion, topology, viewId,
  pins, options}` and drops stale replies. While layout runs the canvas
  shows the previous layout (or a skeleton on first load). In jsdom and
  browsers without workers, the same functions run synchronously.
- **Cache.** In-memory LRU (4 entries) keyed by
  `revision : viewId : pinsHash : layoutVersion`. Filters and focus are
  projections of the full layout and never re-run it (current behaviour).
  A persistent IndexedDB cache is deferred; it is added (in commit 8) only
  if the 500-node first paint misses its budget.
- **Determinism.** No `Math.random`, `Date` or locale-dependent comparison;
  all sorts are by explicit numeric keys then code-unit ID comparison; all
  coordinates are integers; Map iteration only over arrays sorted first. A
  golden test hashes the layout and routes of each fixture; the worker path
  and the synchronous path must produce the identical hash.
- **Cost.** Bundle: router + placement + styles ≈10–15 kB gzip in a
  separate worker chunk; no new runtime dependency besides
  `@xyflow/react`. CPU targets are in [Performance budgets](#performance-budgets).

## Data and model changes

None. Specifically:

- No change to `packages/api/src/shared/topology.ts`, OpenAPI, D1 or
  Connect. `TypeDef.shape` (required), `TypeDef.icon/color`,
  `node.style.{shape,size,color,border{style,width,color},icon}`,
  `boundary.style.{color,border,icon}`, `edge.style.{dash,width,animated}`,
  `edge.protocol/port/direction/evidence` are all stored and validated
  since 0.5.0.
- Client-only: `LAYOUT_VERSION` constant (cache key; bumped when output
  changes); new layout result type with `routes` and `labels`.
- Stored `view.pins` keep their meaning (host ordering).

## Shapes and border styles

Style precedence for every field: node `style` → node's `TypeDef` → layer
colour (for colour) → theme default. Satellites use the same precedence.

| Field | Values | Rendering |
|---|---|---|
| `shape` | `rect` | SVG rectangle, square corners |
| | `rounded` | rectangle, 10 px radius (today's card) |
| | `pill` | rectangle, radius = height / 2 |
| | `hexagon` | flat-top hexagon, 16 px side insets |
| | `cylinder` | rectangle body with elliptical top (12 px) and bottom arc |
| | `diamond` | rhombus through the four side midpoints |
| | `circle` | ellipse inscribed in the card box (circle for square sizes) |
| | `cloud` | fixed, scaled cloud path through the four side midpoints |
| `size` | `s`, `m`, `l` | hosts 176×88, 240×112, 320×144 (decision 7); satellites and sub-satellites use `s` or `m` only (64 high; `l` resolves to `m`), width follows the host column |
| `color` | `#rrggbb` or palette token | fill tint (8 %) and accent; tokens map to CSS variables, unknown tokens fall back to the layer colour |
| `border.style` | `solid`, `dashed`, `dotted`, `double` | SVG stroke; dashed `6 4`, dotted `1.5 3` with round caps, double = two strokes with a 2 px gap |
| `border.width` | 0–4 | stroke width; 0 = no outline (selection ring still shows) |
| `border.color` | colour | stroke colour, default theme border |
| `icon` | icon key | lucide icon from a fixed table until Phase 5 (decision 9: server, database, globe, cloud, network, laptop, monitor, hard-drive, bot, git-branch, shield, key, box, cpu, …); unknown keys use the type default, then `circle-dot`. Brand icons are Phase 5 |
| `lifecycle` | active, planned, deprecated, retired | status light: none, dashed outline + "planned", amber light, grey 50 % opacity + "retired" |
| tags / boundary chips | — | label capsules, as today, capped per zoom level |
| boundary `style` | colour, border, icon | frame stroke, tint and header icon; default border dashed for `trust`, solid otherwise |
| edge `style.dash` / `width` / `animated` | solid/dashed/dotted, 1–4, bool | stroke dash, width, moving dash animation (disabled under `prefers-reduced-motion`) |
| edge `direction` | uni / bi | arrowhead at target / both ends |
| edge `evidence` | documented / inferred | inferred defaults to dashed when no dash is set |

The shape is drawn as an SVG background inside the card; card content sits
inside a per-shape safe rectangle (`shapeInset(shape, w, h)`), so text never
crosses the outline. Layout and routing use the card's bounding box, so
shapes never change overlap guarantees.

## Edge rendering

- Custom edge `topologyRoute` draws the precomputed polyline with 8 px
  rounded corners, arrow markers per `direction`, stroke per kind colour (a
  fixed palette for the eight edge kinds, theme-aware), dash/width/animation
  per `style`.
- Label capsule: `label`, then `protocol` and `:port` in monospace
  (`HTTPS :443`). Labels show at the detail level only, or at the standard
  level when the capsule fits.
- Cross-layer edges keep a distinct treatment (lower opacity at overview).
- Hover or selection highlights the edge and both endpoints.

## Semantic zoom: three levels

Levels are chosen from the on-screen width of a medium host card
(`240 × zoom`), with hysteresis of 5 % to avoid flicker:

| Level | Zoom (m card on screen) | Shows | Hides |
|---|---|---|---|
| Overview | < 0.35 (< 84 px) | sections with large titles, provider and counts; frames with labels; hosts as shape + colour with the label only if it fits at ≥ 12 px; same-layer edges thin; cross-layer edges as counted layer-pair bundles | satellites, badges, chips, edge labels, ports |
| Standard | 0.35–0.8 | host cards with icon, label, type; satellites as compact cards; frame labels; every edge routed individually (bundles expanded) | badges beyond 2, edge labels that do not fit, tags |
| Detail | ≥ 0.8 (≥ 192 px) | everything: badges (up to 6), boundary and tag chips, edge label capsules with protocol/port, lifecycle text | — |

Legibility rule (fixes limitation 3): **no visible text renders below 11 px
on screen**. Section titles, frame labels and overview host labels are
counter-scaled (`font-size = target / zoom`, clamped to the element box);
anything that would still be under 11 px is not rendered at that level. A
unit test checks the size table; the L3 test samples computed font sizes ×
zoom for every visible text node at each level.

### Overview edge bundles

Decision 4: at the overview level a large topology must read at a glance.

- Every cross-layer edge belongs to the bundle of its unordered layer pair.
  Same-layer edges are not bundled.
- Each bundle is routed once, section border to section border through the
  gutters (ports on the facing section sides), drawn with width
  `2 + 2·log2(count)` px (capped at 10) in the cross-layer colour, with a
  capsule such as `Cloudflare ⇄ VPS · 14`. Bundles show no direction; the
  capsule tooltip lists counts per edge kind.
- Bundle routes are computed in the same worker pass as individual routes,
  so a level switch is a class change, never a re-layout.
- At the standard and detail levels bundles are hidden and individual
  routed edges show. Clicking a bundle zooms to the standard level framing
  both sections.
- Filters apply before bundling (counts are visible edges only). In layer
  focus, stubs replace bundles.

## Layer focus clipped to its section

Focus becomes a state (`focusedLayerId`), not a one-shot viewport fit:

- The projection keeps only the focused section, its frames and cards.
  Other sections are not rendered, so no fragments appear regardless of
  the viewport aspect.
- Cross-layer edges are drawn up to the section border and end in a stub
  capsule naming the other layer and the count (`→ Cloudflare · 3`);
  clicking the stub focuses that layer. Ghost neighbour nodes are deferred
  to Phase 4 (decision 5).
- The viewport fits the section; `translateExtent` limits panning to the
  section plus padding.
- A **layer navigator** in the toolbar (always in the DOM, not a canvas
  node) lists every layer in order with node counts, plus "All layers"; it
  fixes the missing off-screen section buttons. Keyboard: `Esc` leaves
  focus; `[`/`]` move to the previous/next layer.
- The focused layer is reflected in the URL (`?layer=<id>`) so a reload or
  link restores it. Section header buttons stay as a shortcut when visible.

## Collapsible sidebar

Decision 6:

- On `/topology` the sidebar **defaults to the narrow icon rail** and can be
  **fully hidden** (0 px); expanded stays available. A toolbar button
  ("Hide navigation" / "Show navigation", `PanelLeftClose`/`PanelLeftOpen`)
  and the shortcut `\` toggle hidden; a small edge tab reveals the rail on
  hover/focus.
- **Fullscreen always hides the sidebar completely** and restores the
  previous state on exit.
- The topology state persists in `localStorage` (`steed-topology-nav`:
  `rail` | `hidden` | `expanded`, default `rail`), separate from the global
  `sidebar-expanded`, and falls back to `rail` when storage is unavailable.
  Other pages keep today's expand/rail behaviour; mobile keeps the sheet.
- A state change re-fits the canvas only if the user has not panned since
  the last fit.

## Local fixture datasets

All testing uses local data. Nothing in this phase reads from or writes to
production; L3 seeds an isolated local D1 per run, as today.

- `scripts/topology-fixture.ts`: seeded generator (mulberry32, fixed seeds)
  producing schema-valid topologies, validated by the shared zod schema at
  generation time.
- `topology-200`: 8 layers, 200 nodes (≈30 % satellites, depth-2 chains),
  ≈400 edges (≈35 % cross-layer, some bidirectional, labels with
  protocol/port), 12 boundaries with 3-level nesting and multi-membership
  across layers, every shape × size × border style × lifecycle at least
  once, a few nodes with 8 boundaries.
- `topology-500`: 10 layers, 500 nodes, ≈1000 edges, same mix.
- Generated at test time (no 10k-line JSON in git); an L1 test pins the
  SHA-256 of each generated document so drift is visible. The existing
  `acceptance-topology.json` stays for the click-every-node check.
- No real IPs, hostnames or identifiers; values pass the secret-like
  detector.

## Test plan

Every acceptance criterion maps to automated tests:

| Acceptance criterion | Test | Lane |
|---|---|---|
| Layout deterministic (same input, same output) | golden hashes for both fixtures; run twice and shuffled input order (nodes/edges/boundaries permuted) → identical result; worker path = sync path | L1 |
| No overlaps | all card rects pairwise disjoint; frames laminar (disjoint or strictly nested); sections disjoint; property test over 200 seeded random topologies | L1 |
| Layer order correct | sections in row-major order equal layer `order`; every card inside its layer's section | L1 |
| Satellites stay inside host block | every satellite/sub-satellite rect inside its root host block, block inside its innermost frame | L1 |
| Every membership framed | for each host and each boundary membership (with ancestors), the host lies inside a frame fragment of that boundary | L1 |
| Edges do not pass through nodes | every route segment misses every card rect except its endpoints; never crosses a header; no fallback routes | L1 |
| Routing failure never blocks (decision 1) | forced no-path and injected-clock timeout: the edge falls back to a straight segment, the failure is recorded in `diagnostics.routeFailures` with its reason, the result is complete; the canvas still renders and exposes `data-route-failures` | L1 |
| Overview bundles (decision 4) | one bundle per layer pair with the right count after filters; bundle routes miss non-endpoint sections; hidden at standard/detail; click zooms to standard | L1 + L3 |
| Fragment titles (decision 2) | all fragments of a boundary share colour, border style and title; suffixes `(1/n)`…`(n/n)` in stable order; single frames unsuffixed | L1 |
| 200-node overview: no overlaps, no cross-layer misplacement | Playwright on `topology-200`: read rendered bboxes of cards, frames, sections at overview fit; same assertions as L1 on screen geometry | L3 |
| 200-node: no edge passes through a node (bbox) | Playwright samples each rendered edge path (`getPointAtLength` every 4 px, mapped by `getScreenCTM`) and checks no sample lies inside a non-endpoint card bbox shrunk by 2 px | L3 |
| 500-node first paint < 2 s (decision 3) | Playwright on `topology-500`: cold context; `performance.mark("steed:topology-painted")` only after nodes **and every edge** (routed, bundled or fallback) are drawn; measured from navigation start; 3 runs, each < 2000 ms; results printed | L3 |
| Light and dark screenshots (decision 8) | archived, never diffed: `--screens <dir>` writes overview, standard, detail, each layer focused and sidebar hidden in light and dark, uploaded as CI artifacts; the six release files are `{light,dark}-overview.png`, `{light,dark}-layer-focus.png`, `{light,dark}-detail.png` | L3 |
| Text ≥ 11 px on screen | sample visible text nodes at each zoom level | L3 |
| Layer focus shows no neighbour fragments | focus each layer: no card/frame of another layer intersects the viewport; navigator reaches off-screen layers | L3 |
| Sidebar collapsible (decision 6) | default rail, hide/show, persistence, keyboard, fully hidden in fullscreen and restored after, canvas width grows | L1 (RTL) + L3 |
| Shapes and border styles | `shapePath`/`shapeInset` unit tests per shape; style resolver precedence; RTL renders each shape/border variant | L1 |
| No regressions | existing click-every-node run and console-error check on the acceptance fixture | L3 |

Geometry assertions are the gate (decision 8); screenshots fail a run only
when they cannot be written.

L1 keeps the root gate (statements/functions/lines 95 %, branches 90 %).
L2 is unchanged (no API change). G2 unchanged. `bun run test:browser` gains
`--fixture <name>` and runs the acceptance, 200 and 500 lanes in CI; it
stays out of pre-push.

## Performance budgets

Measured in the L3 lane on the CI runner (headless Chromium, 1600×1000, no
throttling) and recorded in the PR:

| Metric | Budget |
|---|---|
| 500-node first paint (navigation → nodes and all edges drawn) | < 2000 ms, each of 3 cold runs |
| Routing hard limit (then straight fallback) | 1500 ms per pass, 20 ms per edge |
| Placement, 500 nodes | < 50 ms |
| Routing, 500 nodes / 1000 edges (worker) | < 600 ms |
| Routing, 200 nodes / 400 edges | < 200 ms |
| Main JS chunk | ≤ 290 kB gzip (today 268 kB) |
| Layout worker chunk | ≤ 30 kB gzip |
| Zoom level switch | no layout recompute; CSS/class change only |

A `bench:layout` script prints placement and routing times for both
fixtures and the 1000/5000 Phase 1 design point (informational; above the
500-node acceptance scope).

## Risks

- **Router quality and cost** (largest risk). Many cross-layer edges can
  crowd the 160 px gutters. Mitigations: per-section visibility graphs,
  gutter widening proportional to the number of edges that use it, bend and
  crossing penalties, early benchmarking on the 500 fixture in the router
  commit, and the straight-line fallback with recorded failures, so a bad
  case degrades instead of blocking. `libavoid-js` is not adopted.
- **Boundary fragments** may look unfamiliar: one boundary drawn in several
  places. Mitigated by shared title, colour and border, the `(i/n)` suffix and hover
  highlighting; this is inherent to layers being separate sections.
- **xyflow v12 migration** can change subtle behaviour (selection, fit,
  scroll). Isolated as one commit, verified by the existing L1/L3 tests
  before any feature lands.
- **First-paint budget** depends on CI runner speed. Budgets are checked on
  the same runner type every run; if marginal, the IndexedDB layout cache
  is the next step.
- **Coverage**: the worker entry and SVG shape code need RTL and pure tests
  to keep 95/90; the router is pure and easy to cover.
- **Dependency noise**: daily dependency PRs may conflict with the
  lockfile change in the upgrade commit; rebase before merge.

## Decisions (requirements owner, 2026-11-01)

The nine open questions of the first draft were decided by the requirements
owner on 2026-11-01 (PR #113); the body above reflects them.

1. **Router.** Custom orthogonal router; no ELK (and no `libavoid-js`). When
   routing fails (no solution or timeout) the edge falls back to a straight
   line, the failure is recorded, and rendering never blocks; a unit test
   covers it (router step 7).
2. **Fragments.** Splitting a boundary into fragments is accepted. All
   fragments of one boundary share colour, border style and title; the
   title gets a suffix such as `(1/3)`.
3. **First paint.** Includes every edge drawn: a 500-node cold start
   finishes with edges drawn in < 2 s.
4. **Overview edges.** At the overview level cross-layer edges are bundled
   into one bundle per layer pair labelled with its count, expanded at the
   standard level. The owner's priority is reading a large topology at a
   glance. Phase 4 aggregation covers only boundary collapse, so there is no
   overlap.
5. **Layer focus.** Stubs only; ghost nodes are deferred to Phase 4.
6. **Sidebar.** Defaults to the narrow icon rail, can be fully hidden, and
   is fully hidden in fullscreen.
7. **Sizes.** Hosts s 176×88, m 240×112, l 320×144; satellites use s or m
   only.
8. **Screenshots.** Geometry assertions are the gate; screenshots are
   archived only, no pixel diffs. Every release puts six screenshots in
   `/workspace/steed-screens/` on the steward's box (outside the
   repository): overview, focused layer and detail level, each in light and
   dark.
9. **Icons.** A fixed lucide icon table until Phase 5.

Development path: herdr on a Mac allocated by 机器管家 (decided; allocation
pending).

## Atomic commits

Every commit is one logical change, uses Conventional Commits with a
lowercase subject of at most 50 characters, and passes the pre-commit hook
(typecheck, lint, tests with coverage, coverage gate). The branch passes
pre-push (local HTTP E2E, OSV, gitleaks) before every push. Hooks are never
bypassed, no force-push, no autofix. No mirror registry URLs in `bun.lock`.

1. `docs: add phase 3 canvas and layout plan` — this document and the docs
   index, followed by `docs: record phase 3 decisions` (both already on the
   branch; draft PR #113 becomes the development PR).
2. `build(web): migrate to xyflow react 12` — replace `reactflow` with
   `@xyflow/react`, adapt imports/types/CSS, no behaviour change; tests
   updated.
3. `test: add seeded topology fixture generator` — `topology-200` and
   `topology-500` generators, schema validation and pinned hashes.
4. `feat(web): add topology style resolver` — precedence rules, size table
   (satellites s/m only), colour tokens, fixed lucide icon table; pure,
   tested.
5. `feat(web): size layout blocks by style` — placement uses resolved sizes
   and routing gaps; existing layout tests extended.
6. `feat(web): frame every boundary membership` — laminar frame tree,
   fragments with shared style and `(i/n)` titles, depth cap; geometry
   tests.
7. `feat(web): add orthogonal edge router` — obstacles, ports, visibility
   graph, A*, nudging, label boxes, layer-pair bundle routes, time budget
   with straight fallback and recorded failures; geometry, determinism and
   failure-path tests, not yet wired; `bench:layout`.
8. `feat(web): run layout in a web worker` — worker, request/stale
   handling, sync fallback, LRU cache, worker = sync hash test.
9. `feat(web): render routed edges` — `topologyRoute` edge, arrows, dash,
   width, animation, label capsules with protocol/port.
10. `feat(web): render node shapes and borders` — SVG shapes, safe insets,
    border styles, icons, lifecycle lights, boundary frame styles and
    fragment markers.
11. `feat(web): add three semantic zoom levels` — level selection with
    hysteresis, counter-scaled labels, 11 px rule, counted layer-pair
    bundles at overview, expanded at standard.
12. `feat(web): clip layer focus to its section` — focus state, projection,
    stubs, `translateExtent`, toolbar layer navigator, URL and keys.
13. `feat(web): hide sidebar on topology page` — default rail, hidden
    state, toggle, shortcut, persistence, hidden in fullscreen, re-fit.
14. `test(e2e): check topology layout in browser` — `--fixture`, 200-node
    geometry and edge bbox checks, 500-node first-paint timing, text size,
    focus and bundle checks, light/dark screenshots archived as CI
    artifacts (no pixel diff).
15. `docs: update agents and readme for phase 3` — L3 row in `AGENTS.md`,
    README, implementation decisions appended here.
16. `chore(release): bump version to 0.6.0` — manifests, version
    assertions, `CHANGELOG`. Release step (not a commit): put the six
    release screenshots in `/workspace/steed-screens/`.

Commits 2–3 are independent; 4–7 are pure and can be reviewed before any UI
change; 8–13 wire them in; 14 proves the acceptance criteria end to end.

## Implementation decisions

- Routing uses a coordinate grid per section and one for the gutters, not a
  sparse sweep-line graph. Estimated typed-array allocations are capped at
  64 MiB per pass; exceeding the limit produces recorded fallbacks. This is
  not a bound on total process memory.
- The search reserves 2 px around protected geometry for the widest edge
  stroke, 3 px around headers for the section border and stroke, and 5 px
  for the widest overview bundle stroke. Bends remain square rather than
  the planned 8 px radius: rounding can cut into protected geometry.
  Arrowheads and fallback segments also need renderer-side geometry checks;
  a safe centerline alone does not establish safe painted output.
- The routing deadlines are cooperative, not hard preemption. Bounded nudging
  separates some shared channels but cannot guarantee 6 px separation for
  all fanout arms or after candidate capacity is exhausted. The narrow
  unresolved-channel diagnostic is not an exhaustive overlap inventory.

## Version and development path

- Version: **0.6.0** (Y+1: new canvas capabilities; no API or data change,
  so no D1 migration and no production data step). Release through the
  existing tag + GitHub release flow after merge; CI deploys on merge.
- Development path (jev-judge, 2026-11-01 13:18 CST, caller `repo-steed`,
  one request per path): herdr on a Mac had the higher `proceed_inline`
  (0.47 vs 0.33 for a Cursor cloud agent, which leaned to "needs a
  browser" at 0.89); both gates returned `ask_user` (confidence below 0.70;
  requests `3a1a3fbc-af18-4583-9dcd-9617ac50b9e6`,
  `f45431ff-861d-4121-b52d-26a3770398b7`).
- **Decided** (requirements owner, 2026-11-01): the herdr flow on a Mac
  allocated by 机器管家, as in Phase 1; the allocation is pending. The work
  spans many modules, needs real Chromium for geometry and timing, local
  Wrangler for L3, and long iteration on router quality. One Codex
  controller works on this PR's branch with a review loop (implement →
  review until APPROVE → rebase onto `origin/main` → re-review), capped at
  three review rounds per commit; remaining findings become documented known
  limitations. All hooks on; no production deploy or release from the
  controller; the repo steward releases after merge.

## Acceptance checklist

- [ ] Gates green on every commit; `bun run test:e2e`, OSV and gitleaks
      clean; CI L1/L2/L3 green.
- [ ] Layout unit tests: deterministic, no overlaps, layer order,
      satellites inside host block, every membership framed, edges miss
      cards.
- [ ] Playwright `topology-200`: no overlaps, no cross-layer misplacement,
      no edge through a node (bbox), no fallback routes.
- [ ] Playwright `topology-500`: first paint with all edges drawn < 2 s on
      each of 3 runs.
- [ ] Routing failures fall back to straight lines, are recorded and never
      block rendering (unit-tested); zero fallbacks in the fixtures.
- [ ] Overview shows one counted bundle per layer pair; standard expands
      them.
- [ ] Boundary fragments share colour, border style and title with `(i/n)`.
- [ ] Screenshots archived as CI artifacts (no pixel diff); the six release
      screenshots (overview, layer focus, detail × light, dark) are in
      `/workspace/steed-screens/`.
- [ ] All eight shapes, three sizes, four border styles, widths 0–4 and
      lifecycle states visible in the fixtures and screenshots.
- [ ] Layer focus shows no other layer; navigator reaches every layer.
- [ ] Sidebar defaults to the rail on the topology page, hides fully,
      persists, and is hidden in fullscreen.
- [ ] Production untouched until release; after release, `/api/live` 200 and
      the page reports 0.6.0.
