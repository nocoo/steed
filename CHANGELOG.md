# Changelog

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
