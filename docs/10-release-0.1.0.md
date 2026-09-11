# 10 — Release v0.1.0

> Project release: `v0.1.0` — 2026-09-11.

First tagged release. `apps/web` was `0.0.1`; a minor increment sets the project version to **0.1.0** and resets the patch component.

## Decisions

| # | Decision |
|---|---|
| D1 | Root `package.json` `"version"` is the single source of truth. Display as `v0.1.0`. |
| D2 | Every workspace `package.json` project version is `0.1.0` (`@steed/cli` already was). |
| D3 | Vite/Vitest `__APP_VERSION__`, CLI `--version`, and legacy `APP_VERSION` read the root manifest. |
| D4 | `GET /api/live` and `GET /api/v1/health` include a `version` field from the same root value. |
| D5 | Do not change auth, business routes, schema, ports, env, or deploy config. Do not rewrite historical docs. |

## Version sources

| Consumer | How it reads 0.1.0 |
|---|---|
| Root / workspaces | `package.json` `"version"` |
| `apps/web` sidebar | Vite/Vitest `define` `__APP_VERSION__` from root `package.json` |
| CLI | `import` root `package.json` |
| `apps/web_legacy` | `import` root `package.json` (optional `NEXT_PUBLIC_APP_VERSION` overlay) |
| `/api/live` | JSON `{ status: "ok", version }` from root |
| Worker health | JSON `{ status, version, timestamp }` from root |

## Files

- Root and workspace `package.json`; `bun.lock` via `bun install` (no dependency upgrades)
- `apps/web/vite.config.ts`, `apps/web/vitest.config.ts`
- `packages/cli/src/index.ts`
- `apps/web_legacy/src/lib/version.ts`
- `apps/web/worker/index.ts`, `packages/worker/src/index.ts`
- Matching test assertions only
- `CHANGELOG.md`, this document, `docs/README.md`

## Atomic release commit

`chore(release): v0.1.0` synchronizes the version metadata, consumers, lockfile, and changelog. The release uses tag `v0.1.0`; production deploys the SPA and Worker together from `apps/web`.

Local validation and post-release checks are skipped for this release at the user's explicit request.
