# Changelog

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
