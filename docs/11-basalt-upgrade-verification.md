# 11 — Basalt upgrade verification

Status: In progress. Baseline: `fb48cff` on `main`.

## Published version and safe synchronization

The 2026-09-12 execution of `su-basalt-upgrade` started at `0db8775` with a
clean index and worktree. After `git fetch origin`, `git rev-list --left-right
--count main...origin/main` returned `0 5`. `git merge --ff-only origin/main`
advanced `main` to `fb48cff`; the five incoming commits changed only CI workflows.

The npm Tencent mirror and jsDelivr package metadata both report **2.1.7** as
the latest published `@nocoo/basalt` version. Tencent reports publication at
`2026-09-10T09:33:41.630Z`. The Microsoft mirror still reports 2.0.3 and is stale.
`apps/web/package.json`, `bun.lock`, and the installed package already use exact
2.1.7. The lockfile integrity matches the published package:

```text
sha512-iZyVhwfgvEQsqU2FH2iEaSXz20B39EaaEkngbw5Xzb5QLOkUqNBYGuqyeXlxyYngFvIReXUgWxsn7bjHexP6vA==
```

Sources:

- `https://mirrors.tencent.com/npm/@nocoo%2fbasalt`
- `https://data.jsdelivr.com/v1/package/npm/@nocoo/basalt`
- `~/workspace/personal/basalt/INTEGRATION.md`
- Installed `@nocoo/basalt/ai/RECIPES.md` and public declarations
- [09 — Original migration](./09-basalt-component-migration.md)

## Design and scope

The live frontend is `apps/web`. The previous migration already replaced its
shell, sidebar, page headings, cards, filters, forms, dialogs, and common
controls with the public package. This execution retains the latest dependency
and completes the integration checks and repairs below.

| Region | Current implementation and acceptance |
|---|---|
| Login | Cloudflare Access gates the SPA and `/api/*`; there is no application login card. Preserve `apps/web/worker/access-jwt.ts` and the existing authentication boundary. |
| Providers / CSS | `components/layout/shell-providers.tsx` and `index.css` use one Basalt provider tree and the required Tailwind source/import order. |
| Brand | Keep `AccentProvider.paletteOverrides.primary`, light `175 70% 38%`, dark `175 65% 45%`, default `primary`, and `persist={false}`. |
| Frame / sidebar | `app-frame.tsx` uses `AppShell`, `AppMain`, `AppSkipLink`, `AppHeader`, `ContentIsland`, and a mobile `Sheet`. `app-sidebar.tsx` retains the same 24px logo in a 68px slot throughout collapse. |
| Navigation | `lib/navigation.ts` supplies linked ancestors and a static current page. `app-link.tsx` matches the installed `LinkProvider` contract. |
| Pages / controls | All seven routes use `PageHeader` and `LayerCard`; map filters use `FilterBar`, `Select`, `ToggleGroup`, and `Checkbox`. Forms retain explicit submit buttons, dirty/pending state, and mutation handling. |
| Product widgets | Keep the componentized React Flow graph/nodes/drawer/legend and `LaneChips`; these represent domain behavior rather than another primitive library. |
| Surfaces | Check L0 shell → L1 island → L2 card → L3 nested content in both themes, with no native common controls or obsolete color tokens in product source. |

Shell integration gaps found during verification:

1. `hooks/use-mobile.ts` begins with `undefined`, causing the first mobile render
   to reserve a desktop rail. Initialize from the same media query used by its
   change listener, as required by the integration guide's first-render rule.
2. `app-frame.tsx` reads/writes sidebar preferences without guarding storage
   failures, while `index.html` abandons theme initialization when storage reads
   fail. Resolve the initial sidebar preference in its state initializer and
   retain working navigation and system theme when browser storage is denied.
3. The browser keyboard check found that `AppSkipLink` changes the URL fragment
   without focusing `AppMain`. Add `tabIndex={-1}` as in the installed AppFrame
   recipe so the existing fragment target accepts focus without entering the
   normal Tab sequence.

Application versions remain root 0.1.1 and web 0.1.0. `apps/web_legacy`, backend
code, authentication, D1 data, and other repositories are outside this change.
The command requires local atomic commits on `main`; it does not request push,
publication, or deployment. No Worker implementation change is planned.

## Atomic commit plan

| Step | Commit intent | Validation |
|---|---|---|
| C0 | `docs: plan basalt upgrade verification` | Review this plan against current code and published contracts; mandatory pre-commit gates. |
| C1 | `fix: initialize basalt shell preferences safely` | Reproduce first-render and denied-storage failures, repair the shell, run mandatory gates and production build. |
| C2 | Atomic fixes for browser or P0/P1/P2/P3 review findings | Repeat relevant regression checks and mandatory hooks for each logical fix. |
| C3 | `docs: record basalt upgrade sign-off` | Record final verification evidence and independent Codex sign-off through `su-review-fix`. |

Stage named files only. Never skip hooks or lower test thresholds.

## Verification plan

- Confirm the exact published package with a frozen Bun install through the
  current Tencent mirror; retain the registry-independent lockfile.
- Run the existing G1/L1 pre-commit gates: strict TypeScript, zero-warning ESLint,
  Vitest, and coverage at 95% lines/statements/functions and 90% branches.
- Run the web package's own typecheck and coverage gates and the production Vite
  build. Preserve its 90/85/85/90 coverage thresholds.
- Exercise the local HTTP E2E suite and security scanners without pushing.
- Use an isolated local preview on port 17035 and browser-intercepted fixture
  responses for UI checks. No production writes or authentication bypass changes.
- Browser checks: all seven routes in light/dark at desktop/mobile sizes;
  logo coordinates during collapse/expand; ancestor breadcrumb clicks; mobile
  drawer navigation, Escape focus, and breakpoint changes; theme initialization;
  form save/disabled/error behavior; map filters, node details, and nested paint.
- Follow `su-review-fix`: use a separate Codex in a Herdr pane in this repository,
  fix all P0/P1/P2/P3 findings with atomic commits, and obtain explicit sign-off.

## Results

Pending implementation, verification, and review.
