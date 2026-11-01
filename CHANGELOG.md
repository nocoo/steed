# Changelog

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
