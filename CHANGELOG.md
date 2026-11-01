# Changelog

## [0.5.7] - 2026-11-01

### Changed

- Connect auth is a read-only D1 batch (token lookup + rate-limit count).
  Mutations fold the rate-limit increment into their existing write batch so
  writes pay one durable commit instead of two; reads and write paths that
  never reach that batch (412/422/validate/replay) defer the same increment
  via `waitUntil`. Over-limit requests still get 429 before any topology I/O.
  Expected to bring incremental write server p95 from ~280 ms to ~240 ms
  (#118).

### Documentation

- docs/21 records the v0.5.6 N=100 PASS (p95 280), 拓扑大师's decisions on
  proposals A (done) and B (deferred), and the check-vs-increment semantics
  including the brief concurrent overshoot window (#118).

## [0.5.6] - 2026-11-01

### Fixed

- Connect writes no longer fail with 412 for clients that request gzip.
  Cloudflare compressed the response and weakened its ETag to
  `W/"topology:N"`; Connect responses now send
  `Cache-Control: no-store, no-transform`, and mutation `If-Match` also
  accepts the weak form, which names the same revision (#116).

### Changed

- `scripts/prod-write-latency.ts` runs 100 writes by default (up to 200),
  reports p90 and p99, and derives `auth-net`, `read-net` and `write-net`
  (segment minus D1 SQL time) (#116).

### Documentation

- docs/21 records the v0.5.5 production write measurement and findings: the
  D1 primary is in NRT next to the Worker, a mutation is already one D1 batch
  including its audit row, and the write and auth tails come from D1 commit
  latency outside SQL. It also records the owner decision allowing `test-`
  data in production for latency tests (#116).

## [0.5.5] - 2026-11-01

### Added

- API responses carry a `Server-Timing` header with per-segment durations
  (`auth`, `read`, `validate`, `write`, `audit`, the D1-reported `*-sql`
  execution time, the `colo` lookup, `total`) and a `cold` flag on the first
  request of an isolate. It is fail-soft and carries no identities (#114).
- `scripts/prod-write-latency.ts` measures incremental `put_node` latency
  against an empty production topology using `test-` data and clears it
  afterwards (#114).

## [0.5.4] - 2026-11-01

### Fixed

- `X-Steed-Colo` now reports the data center the Worker executed in, read
  once per isolate from Cloudflare's `/cdn-cgi/trace` inside the Worker and
  omitted when that lookup fails. In 0.5.3 it carried the ingress colo,
  which with targeted placement is near the caller, not Tokyo. The ingress
  value is now `X-Steed-Ingress-Colo` (#111).

## [0.5.3] - 2026-11-01

### Changed

- Semantic topology errors, such as a dangling `layerId` or a secret-like
  attr, are reported at the request position of the operation that wrote the
  entity (`["operations", i, "value", ...]`), and entity writes report
  body-relative paths, consistent with structural errors. Issues on entities
  the batch did not write keep their graph path (#109).
- A validation 422 whose issues are all secret-like hits now has top-level
  `error.code` `secret_like_value`; other validation failures keep
  `invalid_topology`. Status and the `issues[]` shape are unchanged (#109).

### Added

- `/api/*` responses carry `X-Steed-Colo` and, when placement is enabled,
  `X-Steed-Placement`, so callers can confirm where the Worker ran (#109).

## [0.5.2] - 2026-11-01

### Fixed

- The topology page no longer crashes with React error #185: selection no
  longer feeds an update loop, and an error boundary keeps a render failure
  from blanking the page (#107).
- Long low-entropy text, such as repeated characters or long words, is no
  longer rejected as `high_entropy`. Random base64 and hex runs are still
  rejected (#106).
- `?since=0` and any `since` one revision before the oldest retained change
  now return a complete delta instead of `410 resync_required` (#106).
- Structural errors in operation batches and entity writes now carry
  per-issue `{ path, code, message }`, for example
  `["operations", 0, "value", "style", "dash"]`, without echoing values (#106).

### Changed

- Connect API requests make fewer D1 round trips: authentication and rate
  limiting share one batch, audit and last-used writes are deferred, and the
  idempotency lookup joins the topology load. Production runs with targeted
  placement in `aws:ap-northeast-1`, next to the D1 primary (#106).
- The topology map is laid out as one section per layer, with boundary frames
  and semantic zoom, in a compact full-height workspace with a floating
  inspector (#107).

### Added

- `bun run latency:prod`: a read-only production latency probe (#106).
- A browser E2E lane that seeds the 245-node acceptance topology and clicks
  every node in headless Chromium (#107).

## [0.5.1] - 2026-11-01

### Fixed

- The sidebar avatar now loads: the Worker fetches the lizheng.blog author
  profile through a wrapped fetch with manual redirects (the previous call
  always failed in the Workers runtime), and caches it in `caches.default`
  for 24 h when found, 1 h when empty and 5 min after a failure.

### Added

- Avatars may also be base64 PNG data URLs.
- A topology E2E check that fetches a stubbed author profile through the real
  Workers runtime and confirms the cache.

### Changed

- Documented the `CONNECT_MANAGERS` format: comma-separated, exact
  `email:<lowercase address>` or `subject:<Access sub>` entries.

## [0.5.0] - 2026-11-01

Phase 1 and 2 introduce the canonical topology and its Connect API. See
`docs/19-phase1-topology-model.md` for the model and API contract.

### Added

- Layers, types, boundaries, nodes with two satellite levels, edges and views,
  with schema validation and a secret-like value safety net.
- Normalized D1 topology storage, guarded writes, change history and
  conflict-checked revert.
- Topology-scoped Connect reads, validation, operations and replacement, with
  revisions, idempotency, confirmation and auditing.
- Local topology and Connect HTTP acceptance tests and a capacity benchmark.

### Changed

- The browser renders a read-only topology with filters and an interim lane
  layout; structural writes use Connect.
- Migrations `0009`-`0011` create topology tables, rebuild Connect scopes and
  remove the retired diagrams table. Root coverage now counts Worker code.

### Removed

- The v1 diagram model, editing UI and diagram APIs.

## [0.4.0] - 2026-10-31

Phase 0 of the topology platform: Steed no longer inventories agent assets.
See `docs/18-phase0-topology-cleanup.md`.

### Added

- Migration `0007` drops the inventory tables (`lanes`, `hosts`, `agents`,
  `data_sources`, `data_source_lanes`, `agent_data_source_bindings`).
- Migration `0008` clears every diagram and all Connect tokens, requests,
  confirmations and rate-limit windows; `connect_audit` is kept.

### Changed

- The Diagrams entry is now Topology at `/topology`; `/diagrams` links
  redirect, and the root opens Topology.
- `/api/v1/*` is served only by the Connect API with Bearer authentication;
  unknown browser API paths return a JSON 404.
- D1 migrations move to `apps/web/migrations`.
- README and `AGENTS.md` describe the topology platform.
- HTTP E2E runners stop the whole Wrangler process group, so pre-push no
  longer hangs on orphaned children.

### Removed

- The Overview, Hosts, Agents, Data Sources and Map pages.
- `packages/cli` (CLI and Host Service), `packages/worker` (Hono API and Host
  API), `packages/shared`, and the inventory client and server in
  `packages/api`.
- The `DASHBOARD_SERVICE_TOKEN` binding, the root `dev:worker` and
  `deploy:worker` scripts and the legacy API E2E runner.
- Dependencies `react-hook-form`, `@hookform/resolvers`, `hono`,
  `commander`, `chalk`, `ora`, `cli-table3` and `urlpattern-polyfill`.

## [0.3.6] - 2026-10-31

### Changed

- Override `minimatch` to 11.0.1 (GHSA-g3hv-75wg-m249).
- Upgrade `react-router` to 8.5.1.
- Upgrade `typescript-eslint` to 8.72.1.
- Upgrade `hono` to 4.13.14.

## [0.3.5] - 2026-10-24

### Changed

- Override `undici` to 7.30.1 so the dependency scan no longer reports the
  advisories published against 7.29.1.
- Upgrade `react-hook-form` to 7.91.0.

## [0.3.4] - 2026-10-24

### Added

- Collapsible sidebar groups driven by the shared Basalt sidebar template.

### Changed

- Standardize every page shell: pages no longer add their own padding, centering
  or max width, use `PageHeader` and `SectionRule` for their titles and regions,
  and separate sections with the 24px layout gap.
- Adopt the Basalt sidebar header, rail and footer geometry, and render the
  account row with `SidebarUser`.
- Use `LayerCard.Empty` for the diagrams and Connect empty states.
- Upgrade `@nocoo/basalt` to 3.2.1, Wrangler to 4.152.0 with Workers types
  5.20261023.1, `@types/node` to 26.6.5, jsdom to 30.1.3,
  `@testing-library/jest-dom` to 7.0.1, `chalk` to 6.0.1,
  `@hookform/resolvers` to 6.0.0 and React Router to 8.5.0.
- Run the native TypeScript 7 compiler for typecheck and build, keeping the
  TypeScript 6 API available to typescript-eslint through
  `@typescript/typescript6` until it supports TypeScript 7.

## [0.3.1] - 2026-10-13

### Added

- Hexly project link and accessible header tooltips.
- Existing automated release helper and root release command.

### Changed

- Remove the retired Next.js web workspace, obsolete Railway Docker build,
  browser OAuth CLI login and their exclusive dependencies and configuration.
- Preserve Host API-key initialization and current Worker/Access/Connect authentication.
- Bound full-suite Vitest concurrency to two workers without changing checks.
- Update Basalt to 2.2.0, Vitest to 5.0.3, ESLint to 10.11.0 and
  typescript-eslint to 8.71.0 from commits since v0.3.0.
- Normalize the agent handbook, retrospective and dependency verification notes.
- Synchronize the root-derived web, Worker and CLI version at v0.3.1.

### Fixed

- Patch dependency security advisories, including sharp 0.35.5 and source-map-js 1.2.2.
- Replace native selects with Basalt and add accessible header icon labels.
- Disable default Worker and preview URLs.
- Seed the current and next minute in the isolated HTTP rate-limit fixture,
  retaining the exact 429 and Retry-After checks across minute boundaries.

## [0.3.0] - 2026-09-12

### Added

- Architecture diagram workspace with interactive canvas, nodes, edges, boundaries, layout, and export (`/diagrams`)
- Scoped diagram connection management (`/connect`) with cryptographic token issuance, validation, and revocation
- Signed-in user profile display in sidebar footer with Cloudflare Access JWT resolution
- Dedicated database migrations for architecture diagrams (`0005`) and Connect access tokens (`0006`)
- Automated integration test suites for diagrams (`run-diagram-e2e.ts`) and Connect (`run-connect-e2e.ts`)

### Changed

- Coordinated local development domain routing through Caddy

## [0.2.0] - 2026-09-12

### Changed

- Synchronize all workspace package versions with the root release version.
- Display the sidebar version badge in a monospace font.
- Use pinned shared CI and production deployment workflows with deployment provenance checks.

### Fixed

- Render mobile navigation and the saved sidebar preference correctly on the first render.
- Keep theme initialization and sidebar controls usable when browser storage is unavailable.
- Move keyboard focus to main content when activating the skip link.

## [0.1.1] - 2026-09-11

### Fixed

- Add `Cache-Control: no-store` header to `GET /api/live` health endpoint

## [0.1.0] - 2026-09-11

First tagged release. Root `package.json` is the version source of truth (`0.1.0`).

### Added

- Inventory dashboard for hosts, agents, data sources, lanes, and bindings
- Relationship map filtered by host, lane, or unbound resources
- Host CLI and foreground Host Service with periodic heartbeat snapshots
- Vite SPA on Cloudflare Workers with Access at the edge and D1-backed Worker API
- `GET /api/live` and `GET /api/v1/health` report the root package version

### Changed

- Consume published `@nocoo/basalt@2.1.7` for `apps/web` chrome and product pages
- Read app, CLI, and legacy version strings from the root manifest instead of local copies

### Fixed

- Keep navigation focus and scrolling stable after the Basalt shell migration
- Restore map node surface contrast and keep host connection handles visible
- Correct accessible labels on remove actions
- Restore full-width skeleton blocks
