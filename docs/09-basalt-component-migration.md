# 09 — Basalt public component migration

> Status: ✅ COMPLETED — Root Codex sign-off includes S7 at `f69960c`; no open P0–P3
>
> Package: `@nocoo/basalt@2.1.7` (exact). Active frontend: `apps/web` (Vite / React 19 / React Router 7).
> Baseline HEAD: `107256b7104a067133029f7f4b5a60a86efd717b`. App version stays `0.0.1`. Root has no `version`; do not add one.

This document is the numbered plan required by `CLAUDE.md` §1. It inventories the live SPA, maps every chrome and leaf control onto the published Basalt 2.1.7 API, and lists atomic commits. It does **not** migrate `apps/web_legacy`, `packages/*` APIs, Caddy, Basalt itself, or Wooly.

---

## 0. Decisions locked before code

| # | Decision | Why |
|---|---|---|
| D1 | **No in-app login badge.** Do not add `/login`. | Phase F (`docs/features/07-phase-f-vite-web-cf-access.md` §4.4): Cloudflare Access authenticates at the edge. Unauthenticated users never reach the SPA. `apps/web` has zero login routes. `su-basalt-upgrade` step 3 (“replace the login card first”) does not apply. |
| D2 | Consume **published** `@nocoo/basalt@2.1.7`. Pin exact, not `^`. | Root evidence `/tmp/basalt-steed-wooly-migration-2026-09-11/baseline.json` `target: 2.1.7`. Do not copy library source, do not path-alias the local Basalt repo. |
| D3 | Brand accent via `AccentProvider.paletteOverrides` on id `primary`. Default that id. `persist={false}`. | Current tokens: light `175 70% 38%`, dark `175 65% 45%` (`apps/web/src/index.css`). Do **not** globally re-declare `--basalt-*`. Do **not** use the library teal swatch (`182 62% 47%` / `182 62% 63%`) — it is a different hue. No accent picker. |
| D4 | Keep original logo files. Never `BasaltMark`. | `docs/06-logo-identity.md`: sidebar uses `apps/web/public/logo-24.png` (24×24, transparent). Same asset expanded and collapsed. |
| D5 | Follow `INTEGRATION.md` shell tree (Sheet on mobile), not the overlay `SidebarProvider` recipe. | Contract the upgrade command named. Basalt `SidebarProvider` is for peek/resize/overlay; a normal product shell does not need it. |
| D6 | Keep CF Access, `ApiClient`, viewmodels, D1, and Worker routes unchanged. | Product and login security must not move. Existing `[env.dev] CF_ACCESS_DEV_BYPASS=true` stays as-is; do not add a durable SPA mock/bypass. |
| D7 | Do not occupy Caddy port **7035**. Isolated verify port **17035**. | `steed.dev.hexly.ai` → 7035 is Root’s. This agent may bind `127.0.0.1:17035` only. |
| D8 | Do not touch `apps/web_legacy`, Wooly, Basalt, or Caddy. | Out of this agent’s repo scope. |
| D9 | Do not lower gates. Root coverage stays 95/95/95/90 (lines/statements/functions/branches). `apps/web` vitest stays 90/85/85/90. ESLint `--max-warnings=0`. No `--no-verify`. | Current summary: 97.33 / 97.07 / 96.35 / 90.14. Branches are tight. |
| D10 | No parallel widget kit. No wrappers whose only job is renaming Basalt. | Ponytail. Composition is allowed only where Basalt has no direct control (LaneChips, React Flow nodes, map legend). |

---

## 1. Current architecture (file evidence)

### 1.1 What is live

| Fact | Evidence |
|---|---|
| Active app | `apps/web` — Vite 8, React 19, React Router 7, Tailwind v4 |
| Package name / version | `@steed/web` `0.0.1` (`apps/web/package.json`) |
| Root package | `"private": true`, **no** `"version"` (`package.json`) |
| Auth | CF Access JWT in `apps/web/worker/access-jwt.ts`; browser API under `/api/*`; Host/CLI under `/api/v1/*` (`apps/web/worker/index.ts`) |
| Local Access bypass | `apps/web/wrangler.toml` `[env.dev].vars.CF_ACCESS_DEV_BYPASS = "true"` **and** `isLocalRequest()` in `access-jwt.ts`. Production env has no bypass. Do not extend. |
| Data | `ApiClientProvider` → `@steed/api/client` → same-origin `/api` (Vite proxies to 8787) |
| Dev domain | `https://steed.dev.hexly.ai` → Caddy → **7035**. `vite.config.ts` currently does **not** pin 7035 (Vite default 5173). Port pin is **out of this migration** unless Root asks. |
| Not live | `apps/web_legacy` (Next.js + Google OAuth). Ignored by root tsconfig, eslint, vitest, CI. |

### 1.2 Route table (7 product pages, 0 login)

From `apps/web/src/router.tsx`:

| Path | File | Auth in SPA |
|---|---|---|
| `/` | redirect → `/overview` | none |
| `/overview` | `routes/overview.tsx` | none |
| `/hosts` | `routes/hosts.tsx` | none |
| `/agents` | `routes/agents/index.tsx` | none |
| `/agents/:id` | `routes/agents/$id.tsx` | none |
| `/data-sources` | `routes/data-sources/index.tsx` | none |
| `/data-sources/:id` | `routes/data-sources/$id.tsx` | none |
| `/map` | `routes/map.tsx` | none |

There is **no** `/login`, no session provider, no sign-out, no user chip. Sidebar footer is static `Steed v{APP_VERSION}`.

### 1.3 Provider / chrome tree today

```
main.tsx → index.css (hand-rolled HSL tokens, no Basalt)
App
  ApiClientProvider
    RouterProvider
      Layout (_layout.tsx)
        SidebarProvider          ← local collapse + mobile overlay
          AppShell               ← local fixed sidebar + marginLeft main
            Sidebar              ← local 260/68, fixed, dual trees
            <header>             ← local h-14
              native <button> menu (mobile)
              Breadcrumbs        ← local; Home always a link
              <a> GitHub
              ThemeToggle        ← local light/dark only
            <div> island         ← rounded card, bg-card
              <Outlet/> pages
          Toaster (sonner wrapper)
```

Gaps vs `INTEGRATION.md`:

- No `ThemeProvider` / `AccentProvider` / `LinkProvider` / Basalt `TooltipProvider` at app root.
- No `AppSkipLink`, `AppShell`, `AppMain`, `AppHeader`, `ContentIsland`.
- Sidebar is `position: fixed` + `marginLeft` on `<main>`, not in-flow flex.
- Mobile is a homegrown overlay `<div>`, not `Sheet`.
- Pages invent their own `<h1>` + `<p>` instead of `PageHeader`.
- Cards are local shadcn `Card`, not `LayerCard`. Surfaces use `bg-card` / `bg-background` (L1 painted as page cards on an already-L1 island — nested luminance is inverted vs §14).
- Theme prehydrate only toggles `.dark`, never `.light` or `data-mode`.

### 1.4 Brand tokens to preserve

From `apps/web/src/index.css`:

| Token | Light | Dark |
|---|---|---|
| Primary (Steed teal) | `175 70% 38%` | `175 65% 45%` |
| Primary foreground | `0 0% 100%` | `0 0% 100%` |

Library surfaces (background / card / secondary / bright) come from Basalt after CSS switch. Do not re-implement a second `--background` / `--sidebar-*` system.

Logo assets (keep, do not regenerate): `apps/web/public/logo-24.png`, `logo-80.png`, `favicon.ico`, `apple-touch-icon.png`, `og-image.png`; root `logo.png`; `assets/brand/icon-rounded.png`.

Version string: import `version` from `apps/web/package.json` at build time (`0.0.1`). Do not keep `VITE_APP_VERSION ?? "0.0.1"` as a hardcoded fallback. Do not change the number.

---

## 2. Published Basalt 2.1.7 API used here

Inspected from local Basalt package source that publishes 2.1.7 (`packages/basalt/package.json` `"version": "2.1.7"`, `src/index.ts`, granular components). Implementation must re-check `node_modules/@nocoo/basalt` **after** install and follow that d.ts, not this table if they diverge.

### 2.1 Import map (chrome is granular)

| Import from | Symbols |
|---|---|
| `@nocoo/basalt` | `Button`, `Badge`, `Checkbox`, `Dialog`+parts, `Input`, `Label`, `LayerCard`, `DescriptionList`, `Sheet`+parts, `Sidebar`+regions, `ContentIsland`, `Avatar`*, `Tooltip`+parts, `ThemeProvider`, `ThemeToggle`, `LinkProvider`, `Toaster`, `toast`, `ConfirmDialog`*, `Field`, `StatStrip`*, `Separator`* |
| `@nocoo/basalt/providers/theme` | `useTheme` |
| `@nocoo/basalt/providers/accent` | `AccentProvider` |
| `@nocoo/basalt/components/app-shell` | `AppShell`, `AppMain`, `AppSkipLink` |
| `@nocoo/basalt/components/app-header` | `AppHeader` |
| `@nocoo/basalt/components/page-header` | `PageHeader` |
| `@nocoo/basalt/components/section-rule` | `SectionRule` |
| `@nocoo/basalt/components/select` | `Select`, `SelectTrigger`, `SelectValue`, `SelectContent`, `SelectItem` |
| `@nocoo/basalt/components/toggle-group` | `ToggleGroup`, `ToggleGroupItem` |
| `@nocoo/basalt/components/input-area` | `InputArea` |
| `@nocoo/basalt/components/empty` | `Empty` |
| `@nocoo/basalt/components/skeleton-line` | `SkeletonLine` |
| `@nocoo/basalt/components/filter-bar` | `FilterBar` |
| `@nocoo/basalt/components/loading-screen` | `LoadingScreen` — **not used** (no boot splash; pages already handle loading) |
| `@nocoo/basalt/components/basalt-mark` | **forbidden** (D4) |
| `@nocoo/basalt/charts/*` | **not used** (no charts; map is React Flow) |
| `@nocoo/basalt/components/data-table` | **not used** (lists are icon+badge rows, not tables) |
| `@nocoo/basalt/components/flow` | **not used** (linear process diagram, not a graph) |

\*Imported only if a product page actually needs it. Avatar/Separator have **no product callers** today.

### 2.2 CSS (Vite + Tailwind v4)

Exact order in `apps/web/src/index.css`, path relative to that file. Confirm `node_modules` location after install (workspace hoist vs `apps/web/node_modules`):

```css
@source "../node_modules/@nocoo/basalt/dist/**/*.{js,jsx,ts,tsx}";
@import "@nocoo/basalt/styles/tailwind";
@import "tailwindcss";

@layer base {
  html, body, #root { height: 100%; }
  body { @apply bg-basalt-background text-basalt-foreground antialiased; }
}
```

Delete the current `@theme inline` second color system, `--background` / `--primary` / `--sidebar-*` blocks, accordion keyframes, and `tw-animate-css`. Lane graph colors stay as **local** constants (see §5).

### 2.3 Provider tree (one tree, login-less)

```tsx
<ThemeProvider>
  <AccentProvider
    defaultAccent="primary"
    persist={false}
    paletteOverrides={{
      primary: { light: "175 70% 38%", dark: "175 65% 45%" },
    }}
  >
    <LinkProvider render={AppLink}>
      <TooltipProvider>
        <ApiClientProvider>
          <Toaster />
          <RouterProvider router={router} />
        </ApiClientProvider>
      </TooltipProvider>
    </LinkProvider>
  </AccentProvider>
</ThemeProvider>
```

`AppLink` maps `href` → React Router `<Link to>`. `http(s):` / `mailto:` / `tel:` stay `<a>`.

Theme prehydrate in `index.html` must match `storageKey="theme"` and also set `.light` / `.dark` plus `data-mode`.

`ThemeToggle` in 2.1.7 cycles `system → light → dark`. Current Steed only stores resolved light/dark. Accept the three-state control (library behavior). Do not reimplement a two-state toggle.

---

## 3. Target shell

```
AppProviders
└── Layout
    └── AppFrame                          ← apps/web/src/components/layout/app-frame.tsx
        AppShell
        ├── AppSkipLink
        ├── Sidebar (desktop, in-flow)    ← collapsed flag; 260 / 68; 300ms on Sidebar
        │   expanded: Header (logo+name+version+collapse) / Nav partitions / Footer version
        │   collapsed: Header (logo only, centered) / expand btn / icon nav / empty footer
        └── or Sheet (mobile <768): same Sidebar collapsed={false}
        AppMain#main-content
        ├── AppHeader
        │   leading = mobile menu
        │   breadcrumbs = ancestors only (href omitted when no target)
        │   title = current page (h1 text-sm)
        │   actions = GitHub <a> + ThemeToggle
        └── island wrap (px-2 pb-2 md:px-3 md:pb-3)
            └── ContentIsland
                └── <Outlet/> pages
```

### 3.1 Logo collapse contract (P1)

Root review: `SidebarHeader` `px-3` (expanded) vs `justify-center px-0` on a 68px rail still moves a 24px mark (`x`: 12 → 22). Same `alt`/src is not enough.

Contract: **one fixed-width leading slot in both states**.

| Rule | Value |
|---|---|
| Slot | `h-14 w-[68px] shrink-0 flex items-center justify-center` |
| Header | `SidebarHeader className="px-0"` always (override library `px-3`) |
| Image | `logo-24.png` 24×24, identical element tree inside the slot |
| Expanded | `[slot][name + version][collapse]` |
| Collapsed | `[slot]` then expand control **below** the header |
| Expected origin | `x = (68 - 24) / 2 = 22`, `y = (56 - 24) / 2 = 16` relative to the sidebar |

Measure with the browser (getBoundingClientRect of the img in both states). Do not treat “same alt” as pass.

### 3.2 Breadcrumbs (P0)

`AppHeader.breadcrumbs` = ancestors. Current page is `title`, never a crumb, never clickable.

| Path | breadcrumbs | title |
|---|---|---|
| `/overview` | `[]` | Overview |
| `/hosts` | `[{ href: "/overview", label: "Overview" }]` | Hosts |
| `/agents` | same Overview | Agents |
| `/agents/:id` | Overview, `{ href: "/agents", label: "Agents" }` | raw id (no kebab Title-Case) |
| `/data-sources` | Overview | Data Sources |
| `/data-sources/:id` | Overview, Data Sources | raw id |
| `/map` | Overview | Map |

Rules:

- A crumb **without** a real route is not given `href` (unlinked text).
- Do not keep the always-on Home icon that links to `/overview` while already on `/overview`.
- Do not put `PageHeader.breadcrumbs` on product pages (`INTEGRATION.md` §13).
- Detail **content** title stays the nickname / resource name inside `PageHeader` on the island. Shell title may differ; that is the Basalt split (`AppHeader` vs `PageHeader`).

Helper lives in `apps/web/src/lib/navigation.ts` next to `findNavItemByHref`.

### 3.3 Filters rule

| Page | Filter count | Placement |
|---|---|---|
| Overview, Hosts, Agents list, Data Sources list, both details | 0 | none |
| Map | 3 (lane chips, host select, orphans checkbox) | `PageHeader.filters` **own row**. No create button. |

Phase F text mentioned host/lane/status filters on Agents. **They are not in the live SPA.** Do not invent them.

### 3.4 No FAB, no command palette, no app-level panel

Scan found none. Map `NodeDrawer` is an in-grid complementary column, not a FAB sheet. Keep it as `LayerCard` in the existing `lg:grid-cols-[1fr_320px]`.

---

## 4. Local UI inventory → disposition

### 4.1 `apps/web/src/components/ui/` (delete after replacement)

| File | Product callers | Basalt replacement | Notes |
|---|---|---|---|
| `button.tsx` + test | agents list/detail, data-sources list/detail, node-drawer | `Button` | variants align (`default/outline/ghost/sm`) |
| `card.tsx` + test | every page | `LayerCard` (+ Header/Body/Well) | unstructured KPIs; structured lists |
| `badge.tsx` + test | hosts, agents, data-sources | `Badge` | `success` / `warning` / `secondary` / `outline` exist on 2.1.7 |
| `input.tsx` | agent + DS detail | `Input` | |
| `textarea.tsx` | agent + DS detail | `InputArea` | granular path |
| `label.tsx` | agent + DS detail | `Label` or `Field` | prefer `Field` for labelled controls |
| `dialog.tsx` (no test) | agent detail add-binding | `Dialog`+parts | |
| `skeleton.tsx` + test | all pages | `SkeletonLine` / `LayerCard.Loading` | |
| `sonner.tsx` + test | layout + detail toasts | `Toaster`, `toast` from `@nocoo/basalt` | still sonner under the hood in the library |
| `tooltip.tsx` + test | sidebar collapsed | Basalt `Tooltip*` | |
| `lane-chips.tsx` + test | agent + DS detail | **keep**, restyle onto `ToggleGroup` | business single/multi LaneId; no Basalt “lane” control |
| `avatar.tsx` + test | **none** (tests only) | delete | dead |
| `separator.tsx` + test | **none** (tests only) | delete | dead |

### 4.2 `apps/web/src/components/layout/`

| File | Disposition |
|---|---|
| `app-shell.tsx` + test | rewrite as `app-frame.tsx` composing Basalt chrome; migrate interaction tests |
| `sidebar.tsx` + test | rewrite as `app-sidebar.tsx`; keep logo/nav/version/collapse tests |
| `sidebar-context.tsx` + test | **delete**. Collapse + mobile state live in `AppFrame` (INTEGRATION §10). |
| `breadcrumbs.tsx` + test | **delete**. Trail computed in `navigation.ts`, rendered by `AppHeader`. Move clickability tests onto AppFrame. |
| `theme-toggle.tsx` + test | **delete**. Use library `ThemeToggle`. Keep a small AppFrame test that the control is present and toggles `documentElement`. |

### 4.3 Keep (not chrome)

| File | Why no Basalt stand-in |
|---|---|
| `hooks/use-mobile.ts` | INTEGRATION §9 local hook. Keep name. |
| `contexts/api-client.tsx` | transport, not UI. |
| `viewmodels/*` | MVVM; no View imports today; keep that. |
| `components/map/lane-map.tsx` | React Flow canvas. Basalt `flow` is a linear diagram. |
| `components/map/layout.ts` | graph layout math. |
| `components/map/nodes/*` | React Flow custom nodes. Nested `LayerCard` (L3 on canvas L2). Keep Handles, lane bars, `LANE_COLORS`. No `bg-basalt-card`. |
| `components/map/map-legend.tsx` | domain legend. Restyle tokens. |
| `components/map/map-filters.tsx` | compose `FilterBar` + `ToggleGroup` + `Select` + `Checkbox`. |
| `components/map/node-drawer.tsx` | compose `LayerCard` + `DescriptionList` + `Button`. |
| `lib/map-data.ts` `LANE_COLORS` | Work/Life/Learning/Unassigned identity for the graph. Not a theme accent. Keep. Optional later map onto chart tokens; not required. |

### 4.4 Native controls to eliminate (product source only)

| Location | Element | Replacement |
|---|---|---|
| `app-shell.tsx:55` | `<button>` mobile menu | `Button variant="ghost" size="icon"` |
| `sidebar.tsx:73,129` | `<button>` collapse/expand | `Button variant="ghost" size="icon"` |
| `theme-toggle.tsx:33` | `<button>` | library `ThemeToggle` |
| `lane-chips.tsx:59` | `<button role=radio/checkbox>` | `ToggleGroupItem` |
| `map-filters.tsx:33` | `<button role=checkbox>` lane | `ToggleGroup type="multiple"` |
| `map-filters.tsx:59` | native `<select>` | Basalt `Select` |
| `map-filters.tsx:77` | native `<input type=checkbox>` | Basalt `Checkbox` |
| `node-drawer.tsx:30` | `<button>` close | `Button variant="ghost" size="icon"` |
| `agents/$id.tsx:283` | `<button>` candidate row | `Button variant="outline"` or selectable `LayerCard` row |
| `ui/input.tsx` / `textarea.tsx` | native inside wrappers | deleted with wrappers |

Tests may still use `<button>` as fixtures (`sidebar-context.test.tsx` goes away; `lane-map.test.tsx` mock nodes stay).

After the last page commit, scan again:

```bash
rg '<(button|select|input|textarea)\b' apps/web/src --glob '!**.test.*'
```

Must be empty except React Flow internals / remaining composed controls that render Basalt (which should not match this pattern).

---

## 5. Per-page, per-control migration table

Legend: **R** replace with Basalt, **C** compose Basalt, **K** keep local (justified), **D** delete, **N** none today.

### 5.1 Login / identity — N (D1)

| Control | Now | After | Exception |
|---|---|---|---|
| Login badge | absent | absent | CF Access. Do not build INTEGRATION §11. |
| User chip / Sign out | deleted in Phase F | stay absent | YAGNI (Phase F R2) |
| LoadingScreen boot | none | none | Pages already skeleton. |

### 5.2 App frame

| Control | Now | After |
|---|---|---|
| Skip link | N | `AppSkipLink` |
| Sidebar rail | local fixed | `Sidebar` in-flow |
| Collapse | local buttons | `Button` + `collapsed` |
| Mobile nav | overlay `div` | `Sheet` + `SheetContent` + `SheetTitle` sr-only |
| Header | local `<header>` | `AppHeader` |
| Breadcrumbs | local | `AppHeader.breadcrumbs` |
| Theme | local | `ThemeToggle` |
| GitHub | raw `<a>` to niccokunzmann/steed | `LinkButton` (`@nocoo/basalt/components/button`) `variant="ghost" size="icon"` → `https://github.com/nocoo/steed` |
| Island | rounded `div.bg-card` | `ContentIsland` |
| Version | `APP_VERSION` pill + footer text | same slots in `SidebarHeader` / `SidebarFooter` |
| Logo | `img /logo-24.png` | same, both states, see §3.1 |

### 5.3 Overview (`routes/overview.tsx`)

| Region | Now | After |
|---|---|---|
| Title / subtitle | local `PageHeader()` | `PageHeader title="Overview" description="AI asset visibility at a glance"` |
| Actions / filters | N | N |
| 4 KPI tiles | `Card` + icon + skeleton | `LayerCard` unstructured (keep icon + description; **do not** squash into `StatStrip` — that drops icon/description) |
| Agents by Lane | `Card` + `CardHeader/Title` | `SectionRule title="Agents by Lane"` + `LayerCard` grid or inner well |
| Error | `Card border-destructive` | `LayerCard` + `Badge variant="error"` / destructive text |
| Loading | `Skeleton` | `SkeletonLine` inside the same cards |
| Empty | N (zeros are valid) | N |

### 5.4 Hosts (`routes/hosts.tsx`)

| Region | Now | After |
|---|---|---|
| Title | local h1 | `PageHeader` |
| List card | `Card` + rows | `LayerCard` > `Header` + `Body` / `Well` |
| Row | bordered `div` | well row; Hosts are **not** links today — keep |
| Status | `Badge success/secondary` | `Badge` |
| Empty copy | `<p>` | `LayerCard.Empty` or `Empty` |
| Loading | row skeletons | `LayerCard.Loading` or `SkeletonLine` |
| Error | destructive card | same pattern as Overview |

### 5.5 Agents list (`routes/agents/index.tsx`)

| Region | Now | After |
|---|---|---|
| Title | local h1 | `PageHeader` |
| Filters | N (despite Phase F prose) | N |
| Rows | `Link` + `Badge` | `LinkProvider`/`Link` + `LayerCard` well rows |
| Load more | `Button outline` | `Button variant="outline"` disabled while loading |
| Empty / error / loading | as Hosts | as Hosts |

### 5.6 Agent detail (`routes/agents/$id.tsx`)

| Region | Now | After |
|---|---|---|
| Back link | `Link` “Back to agents” | **D** — trail is in `AppHeader` |
| Identity card | `Card` + `StatusBadge` | `LayerCard` + `DescriptionList columns={2}` + `Badge` |
| Edit form | `Input` `Textarea` `Label` `LaneChips` `Button` | `Field`+`Input` / `InputArea` / `LaneChips` / `Button`. `disabled={isSubmitting \|\| !isDirty}`. Copy “Saving…” |
| Bindings list | `Card` + ghost destroy | `LayerCard` + `Button variant="ghost"` |
| Add dialog | local `Dialog` + native row `<button>` | Basalt `Dialog` + Basalt `Button` rows. Cancel / Confirm / empty / loading candidates |
| Unbind confirm | **none** (immediate) | **keep immediate**. If `ConfirmDialog` is ever used: it does **not** close itself; caller closes on success and keeps it open on failure. |
| Toasts | `toast` from local sonner | `toast` from `@nocoo/basalt` |
| Loading / error | skeletons / destructive card | `SkeletonLine` / `LayerCard` |

### 5.7 Data Sources list (`routes/data-sources/index.tsx`)

Same pattern as Agents list. Type icons stay lucide.

### 5.8 Data Source detail (`routes/data-sources/$id.tsx`)

| Region | Now | After |
|---|---|---|
| Back link | local | **D** (header trail) |
| Identity | Card + auth/status badges | `LayerCard` + `DescriptionList` + `Badge` |
| Lanes | `LaneChips` multi + Save | same composition; Save disabled when not dirty / submitting |
| Metadata form | notes `Textarea`, tags `Input` | `Field` + `InputArea` + `Input` + `Button` |
| Toasts | local | Basalt `toast` |

### 5.9 Map (`routes/map.tsx` + `components/map/*`)

| Region | Now | After |
|---|---|---|
| Title | local h1 | `PageHeader` |
| 4 KPIs | `Card` | `LayerCard` unstructured |
| Filters | native select/input/button | `PageHeader.filters` → `FilterBar` + `ToggleGroup` + `Select` + `Checkbox` |
| Legend | local spans | **K** restyle |
| Canvas | React Flow in bordered `div.bg-background` | **K** wrap in unstructured `LayerCard` (L2 via `data-basalt-surface`). **Do not** add `bg-basalt-card` — that paints L1 on an L2 card. Canvas is transparent on the card. |
| Node drawer | `aside` + native close | `LayerCard` + `DescriptionList` + `Button` close + `LinkButton`/`Button asChild` for detail |
| Nodes | `bg-card` / `text-muted-foreground` / status dots | Nested `LayerCard` (`data-basalt-surface` L3 on canvas L2). HostNode `overflow-visible` so the source Handle is not clipped. Agent/DS keep LayerCard `overflow-hidden` (lane bars). Keep Handles, lane bars, click/select, `LANE_COLORS`. No `bg-basalt-card` (that paints L1). |
| Lazy + Suspense | keep | keep; fallback `SkeletonLine` |

### 5.10 LaneChips (kept composition)

Wrap Basalt `ToggleGroup`:

- `mode="single"` → `type="single"` (allow empty = unassigned)
- `mode="multi"` → `type="multiple"`
- labels Work / Life / Learning unchanged
- `disabled` forwarded
- tests stay behavior tests (toggle, aria, disabled), not “renders a button className”

Why not delete: LaneId domain, null-as-unassigned, and shared use on two forms. Basalt has no Lane control. This is the one allowed product widget.

---

## 6. Dependencies

### 6.1 Add

In `apps/web/package.json` only:

```json
"@nocoo/basalt": "2.1.7"
```

Install via company mirror, never `registry.npmjs.org`:

```bash
BUN_CONFIG_REGISTRY=https://packagefeedproxy.microsoft.io/npm/ \
  bun add @nocoo/basalt@2.1.7 --cwd apps/web
```

Then force the specifier to exact `2.1.7` if bun wrote `^`. Before commit: `rg -c --include-zero '", "https' bun.lock` prints `0`. If the lock picked up mirror URLs, strip them (do **not** `rm bun.lock`).

`lucide-react` already present. Do not add a second icon pack.

### 6.2 Remove only after the last caller is gone

| Package | When |
|---|---|
| `radix-ui` | no remaining `from "radix-ui"` in `apps/web/src` |
| `class-variance-authority` | no remaining `cva(` in `apps/web/src` |
| `sonner` | after `Toaster`/`toast` come from Basalt |
| `tw-animate-css` | after `index.css` rewrite |

Keep `clsx` + `tailwind-merge` for `cn()` used by map nodes / LaneChips.

Do not add React Flow alternatives. Do not add a Basalt “copy” folder.

### 6.3 Versions that must not change

| File | Stay |
|---|---|
| `apps/web/package.json` `"version"` | `0.0.1` |
| root `package.json` | no `"version"` key |
| `packages/api|shared|worker` | `0.0.1` |
| `packages/cli` | `0.1.0` |
| `apps/web_legacy/package.json` | untouched |

---

## 7. Tests and quality gates

### 7.1 Policy

- Do **not** add tests whose only assertion is “Basalt Button rendered”.
- Delete tests that existed solely to cover local primitives (`avatar`, `separator`, `button`, `card`, `badge`, `skeleton`, `tooltip`, `sonner`) **together with those files**.
- Keep / retarget **interaction** tests: collapse, mobile drawer + body overflow, breadcrumbs click vs static, theme class on `documentElement`, form dirty/disable/submit/error toast, dialog cancel/confirm, map filters, empty/error/loading on each page.
- Viewmodel tests are out of visual scope; do not rewrite them except import path for `toast` mocks.
- Agent/DS detail tests mock `@/components/ui/sonner` — retarget to `@nocoo/basalt`.

### 7.2 Gates (unchanged)

| Hook | Command | Threshold |
|---|---|---|
| pre-commit | `typecheck` ‖ `lint` ‖ `test` then `check-coverage` | root 95/95/95/90 |
| pre-push | `test:e2e` ‖ osv ‖ gitleaks | unchanged |
| `apps/web` vitest | 90/85/85/90 | unchanged |

Do not skip hooks. Do not push. Do not publish. Do not deploy. Do not laptop-`wrangler deploy`.

### 7.3 Interaction regression matrix (must remain meaningful)

| Area | Cases |
|---|---|
| Sidebar | expanded logo+name+version; collapsed logo only; collapse/expand; active nav; groups Dashboard + Infrastructure |
| Logo | same `alt="Steed"` image in both states; no extra padding on collapsed header |
| Mobile | `<768` menu button; Sheet open; body `overflow: hidden`; pathname change closes; desktop hides menu |
| Breadcrumbs | `/overview` no ancestor links; `/agents/:id` Agents is a link, id is not; `/data-sources` Data Sources is title not a link |
| Theme | toggle changes root class / `data-mode`; prehydrate script present |
| Overview | loading skeletons; numbers; error card |
| Hosts / Agents / DS lists | loading, empty copy, error, load-more disabled while loading |
| Agent detail | save disabled until dirty; Saving…; toast success/error; add dialog cancel; confirm disabled without selection; unbind |
| DS detail | lanes save disabled until dirty; metadata save |
| Map | lane toggle, host select, orphans checkbox, drawer close, detail link for agent/DS, host has no detail link |

Keyboard / focus: Basalt controls already ship focus rings. Frame tests should tab to skip link and menu button. Do not screenshot-only.

Light/dark: AppFrame theme test plus one page render under `.dark` (e.g. Overview heading still present). No visual snapshot library in-repo; jsdom class assertions are the gate. Root does real browser review.

Forms: do not hit production data. Tests use `createMockApiClient`. Manual verify on 17035 may read local D1 via existing `env.dev` token already in wrangler — **read-only**. No writes against production.

---

## 8. Atomic commit plan

Every commit is on `main`, Conventional Commits, imperative, lowercase, ≤50 chars. Stage **named files only**. Each commit must pass pre-commit and be **runnable** (old CSS tokens stay until the last consumer is gone).

Root review: do not delete tokens in the providers commit; fewer complete commits beat twelve half-migrations.

| # | Subject | Files (intent) | Done |
|---|---|---|---|
| C0 | `docs: add basalt component migration plan` | plan + index | ✅ `0f851cb` |
| C0b | `docs: apply basalt migration review fixes` | this file (logo slot, surfaces, commits, GitHub, forms, version) | ✅ `690029c` |
| C1 | `chore: add @nocoo/basalt 2.1.7 dependency` | `apps/web/package.json`, `bun.lock` | ✅ `aa16657` |
| C2 | `feat: replace app shell with basalt chrome` | providers + CSS **keeping old tokens**, AppFrame/Sidebar, 68px logo slot, crumbs, version from `package.json`, GitHub `LinkButton` to nocoo/steed; delete old layout modules | ✅ `3f9bdb4` |
| C3 | `feat: migrate product pages to basalt` | all 7 pages, LaneChips, map filters/drawer/nodes; forms `type=submit`; unused local ui removed with last consumers | ✅ `6ff691b` |
| C4 | `chore: drop leftover tokens and unused ui deps` | old HSL tokens, `radix-ui`/`cva`/`sonner`/`tw-animate-css` | ✅ `9cafcd4` |
| C5 | `docs: mark basalt migration complete` | status → ✅ | ✅ `28aeb4d` Root ✅ |
| S1/S2 | `fix: restore nav focus and drop body lock` | SheetTrigger asChild; no hand-written body overflow lock; close sheet on desktop | ✅ `3743d9f` Root ✅ |
| S3 | `fix: restore map node l3 surfaces` | Host/Agent/DS nodes nested `LayerCard` L3; keep Handles and lane bars | ✅ `533ee9c` Root ✅ (L3) |
| S4 | `fix: unclip host node source handle` | HostNode public `overflow-visible`; Agent/DS unchanged | ✅ `8dd3af5` Root ✅ |
| S6 | `fix: drop remove button sr-only span` | bindings Remove `aria-label`; delete absolutely positioned `sr-only` | ✅ `2a67590` Root ✅ |
| S7 | `fix: restore full-width skeleton blocks` | map/agent/DS large `SkeletonLine` `minWidth={100} maxWidth={100}`; overview text lines unchanged | ✅ `f69960c` Root ✅ |

---

## 9. Acceptance matrix (upgrade command §7)

| ID | Check | How | Status |
|---|---|---|---|
| A1 | No in-app login invented; Access still gates `/api/*` | code review of router + worker | ✅ |
| A2 | Logo does not move while collapsing | desktop 260↔68, 300ms; same 24px asset, centered collapsed | ✅ Root browser |
| A3 | Every crumb with a target is a link; no href if none | matrix in §3.2 | ✅ Root browser |
| A4 | `PageHeader` title `text-2xl`, description `text-sm`, actions row aligned | Overview + details | ✅ Root browser |
| A5 | Map filters on their own row; other pages have none | | ✅ Root browser |
| A6 | Surfaces brighten inward: L0 shell → L1 island → L2 cards → L3 wells | no `bg-card` wells inside island | ✅ Root browser (S3 L3) |
| A7 | Zero leftover native `select/button/input/textarea` on product pages | rg scan §4.4 | ✅ |
| A8 | No leftover local `components/ui` except `lane-chips` | | ✅ |
| A9 | Mobile drawer, desktop rail | 768px | ✅ Root browser (S1/S2) |
| A10 | Light and dark | ThemeToggle + prehydrate | ✅ Root 28 shots |
| A11 | Keyboard: skip link, menu, dialog focus, form submit | | ✅ Root 6 interaction groups |
| A12 | Real form states: dirty, disabled, saving, cancel, error toast | agent + DS detail tests | ✅ Root browser |
| A13 | Empty / loading / error on list pages | existing tests retargeted | ✅ unit tests passed |
| A14 | Brand teal via `paletteOverrides`, not a global token override | | ✅ Root browser |
| A15 | Original logo files unchanged | git | ✅ |
| A16 | Versions unchanged except the new exact Basalt dep | | ✅ |
| A17 | Coverage and lint not lowered | pre-commit | ✅ 97.23 / 97.00 / 96.21 / 90.04 |
| A18 | No push / publish / deploy / Caddy edit / port 7035 | | ✅ Agent did not bind 7035/8787/17035; ports stay Root-managed. Final Caddy starts after Wooly |
| A19 | Isolated verify on **17035** if this agent serves | tell Root | ✅ Root served; this agent did not bind |
| A20 | No durable extra auth bypass | | ✅ |
| A21 | P0–P3 from `/su-review-fix` all fixed before sign-off | Root Codex `w2F:p1` | ✅ Root Codex sign-off includes S7 `f69960c`; no open P0–P3 |

---

## 10. Out of scope

- `apps/web_legacy` (including its `/login` card)
- Pinning Vite to 7035
- Playwright L3 (none in-repo; Root owns real browser)
- Changing CF Access AUD/team, D1, Worker API, CLI
- Adding user email, logout, command palette, FAB, accent picker
- Copying `RECIPES.md` into the app
- Chart / DataTable / DatePicker / LoadingScreen / BasaltMark
- Inventing Agents list filters that Phase F mentioned but the SPA never shipped

---

## 11. Isolated port

| Port | Owner | This agent |
|---|---|---|
| 7035 | Caddy `steed.dev.hexly.ai` / Root | **do not bind** |
| 8787 | `apps/web` wrangler `dev:worker` | do not start unless Root asks |
| **17035** | this agent, verify-only | `vite --port 17035 --strictPort` if a local preview is needed |

---

## 12. Status log

| Date | Event |
|---|---|
| 2026-09-11 | Inventory + numbered plan. |
| 2026-09-11 | Root P1/P2: 68px logo slot, no forced L1 bg, runnable commits, LinkButton+nocoo/steed, submit types, package.json version. Implementing. |
| 2026-09-11 | Implementation complete on `main`. Waiting Root P0–P3 review. |
| 2026-09-11 | Root S1/S2: Esc focus + desktop overflow unlock. `3743d9f`. |
| 2026-09-11 | Root S3: map nodes were transparent after dropping `bg-card`. Nested `LayerCard` L3 on canvas L2. `533ee9c`. |
| 2026-09-11 | Root final browser: 6 interaction groups pass; 28 light/dark × desktop/mobile shots; Vite build pass; S3 L3 correct. Remaining P3: HostNode Handle clipped by LayerCard `overflow-hidden`. |
| 2026-09-11 | S4 HostNode `overflow-visible` `8dd3af5`. Sign-off waits Root recheck of that handle. |
| 2026-09-11 | Root S6: mobile `/agents/agent_1` scrollHeight 1020 from Remove `sr-only` span. `aria-label` instead. `2a67590`. |
| 2026-09-11 | Root Codex sign-off at `0aee3c0`. S4 Host overflow-visible light/dark; L0–L3 238/246/252/255 and 23/27/31/36; S6 mobile 390×844; mobile/map regression pass. 28 shots are the normal-state matrix, not empty/loading/error. No open P0–P3. Caddy after Wooly. |
| 2026-09-11 | S7: large SkeletonLine blocks defaulted to 65%. Restored full width via `minWidth={100} maxWidth={100}` on map/agent/DS blocks. Overview text percentages kept. `f69960c`. S1–S6 sign-off unchanged. Root rechecks forced-loading sizes. |
| 2026-09-11 | Root S7 sign-off: 12 loading-dimension cases (map, agent detail, data-source detail × desktop/mobile × light/dark) passed. Production Vite build passed. Caddy `https://steed.dev.hexly.ai` TLS + real local D1 nickname edit/reload/restore passed. No open P0–P3. |

Basalt `Button` defaults to `type="button"`. Every real submit control inside a `<form>` must set `type="submit"`. Cancel, Add, row pickers, unbind, and dialog actions stay the default (non-submit).
