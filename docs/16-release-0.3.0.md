# 16 — Release v0.3.0

Release date: 2026-09-12. Root version: `0.2.0` → `0.3.0`.

## Policy and baseline

The release follows the standard versioning policy:
- Root `package.json` is the single source of truth (`0.3.0`).
- Increment minor version Y (0.2.0 -> 0.3.0) because the changes include major new features: structured architecture diagrams, scoped diagram connections, Connect management API, and the signed-in sidebar profile (>5,000 lines diff).
- Synchronize all package manifests (`apps/web`, `apps/web_legacy`, `packages/api`, `packages/cli`, `packages/shared`, `packages/worker`).
- Update all associated test assertions and documentation references.
- Document changes in `CHANGELOG.md`.

## Changes Included in v0.3.0

1. **Architecture Diagrams**:
   - Structured architecture diagram editor and viewer (`/diagrams`)
   - Interactive canvas with nodes, edges, boundaries, layout, and zoom/pan controls
   - Multi-format diagram storage and export
   - Backend diagram API endpoints and storage

2. **Scoped Diagram Connections (Connect)**:
   - Scoped agent and machine connection management (`/connect`)
   - Cryptographic token generation, verification, and revocation
   - Scoped agent instruction publishing with confirmation discipline
   - D1 database migrations for diagram and connect tables (`0005`, `0006`)

3. **Signed-in Sidebar Profile**:
   - Access-authenticated user profile display in sidebar footer
   - Dynamic avatar fallback and profile hooks

4. **Local Development & Quality**:
   - Coordinated Caddy dev domain routing
   - End-to-end integration tests for diagrams and connect (`run-diagram-e2e.ts`, `run-connect-e2e.ts`)

## Version Changes

| File | Change |
|---|---|
| `package.json` | `0.2.0` → `0.3.0` |
| `apps/web/package.json` | `0.2.0` → `0.3.0` |
| `apps/web_legacy/package.json` | `0.2.0` → `0.3.0` |
| `packages/api/package.json` | `0.2.0` → `0.3.0` |
| `packages/cli/package.json` | `0.2.0` → `0.3.0` |
| `packages/shared/package.json` | `0.2.0` → `0.3.0` |
| `packages/worker/package.json` | `0.2.0` → `0.3.0` |
| `apps/web/src/lib/version.test.ts` | Assert `0.3.0` |
| `apps/web/worker/index.test.ts` | Assert `0.3.0` on `/api/live` |
| `packages/worker/src/index.test.ts` | Assert `0.3.0` on `/api/v1/health` |
| `packages/cli/src/index.test.ts` | Assert `0.3.0` in CLI output |
| `CHANGELOG.md` | Add `[0.3.0]` section |
