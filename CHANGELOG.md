# Changelog

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
