# 11 — Basalt upgrade verification

Status: Complete; implementation verified and independently signed off at `204f926`.
Baseline: `fb48cff` on `main`.

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

| Check | Result |
|---|---|
| Dependency | Exact published 2.1.7 retained; frozen install checked 531 installs across 630 packages with no changes. No manifest or lockfile diff. |
| G1 | Root strict TypeScript, web TypeScript, and zero-warning ESLint passed. |
| L1 | 89 files / 957 tests passed. Coverage: lines 97.23%, statements 97.00%, functions 96.21%, branches 90.02%. |
| Web package | 38 files / 268 tests passed. Coverage: lines 98.00%, statements 97.13%, functions 98.90%, branches 89.82%. |
| Production build | Passed. Vite retains its existing advisory for a main chunk above 500 kB. |
| L2 / D1 | 59 HTTP E2E cases passed against local port 18787 and isolated `.wrangler/state/e2e`; the runner stopped its server afterward. |
| G2 | OSV scanned 965 lockfile packages with no issues; Gitleaks scanned the working directory with no leaks. No exclusions were added. |
| Source audit | No native `button`, `select`, `input`, `textarea`, or `dialog`, obsolete UI imports, or duplicate color-token declarations remain in active product source. |
| L3 views | 28 captures: seven routes × desktop/mobile × light/dark; no browser exceptions. |
| L3 interactions | Six groups passed: shell/logo/theme, mobile drawer, agent editing, metadata/lanes, bindings, and map filters/drawer. All writes used browser fixtures. |
| L3 shell regressions | Six cases passed: pre-React theme under denied storage in both modes, plus desktop/mobile × light/dark with denied storage, skip-link focus, navigation, and nested surfaces. |
| Codex review | Explicit Sign Off for `204f926`; no actionable P0/P1/P2/P3 findings in `fb48cff..204f926`. |

The new regression checks first failed against the prior implementation:
mobile state was `undefined` on its first render, storage errors replaced the
shell with React Router's error boundary, and the bootstrap omitted the theme
when storage reads failed. The targeted 25 checks passed after C1. Browser
validation then reproduced the missing main-content focus target; adding the
native `tabIndex` fixed it in all four viewport/theme cases.

Computed L0/L1/L2/L3 background values were `238/246/252/255` (red channels in
light mode) and `23/27/31/36` (dark mode). Raw accent swatches remained the
configured Steed HSL values in both modes. Logo motion samples remained within
0.5px through collapse and expansion.

Browser scripts, fixture responses, captures, and JSON results are preserved at:

```text
/private/tmp/steed-basalt-upgrade-20260912.mxg6b48e/
```

The independent Codex reviewer, Herdr agent `steed-basalt-review` in pane
`w33:p4`, reported:

> Sign Off for 204f926. No actionable P0/P1/P2/P3 findings in fb48cff..204f926,
> covering 8da4157, 22e007d, and 204f926.

The reviewer independently passed both TypeScript checks, strict lint, 957 root
tests with coverage gates, 268 web tests with coverage gates, and a production
build. Its additional checks passed 22 browser scenarios, all six core
interaction groups, and 12 JWT/authentication cases. It also confirmed that
Basalt 2.1.7 is still latest and that the public integration contracts are met.
The review changed no tracked files. This final documentation update records
the result of the review of the committed implementation.

Independent browser and authentication results, scripts, and screenshots are at:

```text
/private/tmp/steed-codex-review-204f926.z6l3e2/
```

Only this repository's web shell, regression checks, and numbered documentation
changed. Every commit passed the mandatory pre-commit hook. No push, publication,
deployment, or other repository modification was performed.

| Commit | Change |
|---|---|
| `8da4157` | Numbered plan and documentation index. |
| `22e007d` | Initialize mobile/sidebar preferences and retain theme/navigation when storage is denied; regression checks. |
| `204f926` | Make the main-content skip target focusable. |
