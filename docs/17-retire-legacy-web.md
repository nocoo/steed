# 17 — Retire the legacy web application

## Scope and evidence

The authorized maintenance task starts from remote `main` at
`51e86a655974e64d7239b1662fa0ee6f5fc02066`. Production uses `apps/web` with
Vite, Cloudflare Workers, Access and D1; see [the handbook](../AGENTS.md),
[the migration record](features/07-phase-f-vite-web-cf-access.md) and
[the current architecture](13-architecture-diagrams-and-connect.md).

The reference graph includes the legacy workspace, root exclusions, the release
version targets, Next dependencies and overrides, and the obsolete Railway
Docker build. The CLI browser-login command calls `/api/auth/cli`, whose only
implementation is in the retired application. Host API-key initialization is
the maintained path. Remove that dead command and its exclusive dependency;
do not introduce another authentication flow or alter API authorization. Source
inspection confirms `packages/cli/src/commands/login.ts` only calls the browser
OAuth helper with `loginPath: "/api/auth/cli"`; its sole server implementation
was `apps/web_legacy/src/app/api/auth/cli/route.ts`. The current
`apps/web/worker/index.ts` and `packages/api/src/server` expose no such endpoint.
Keep `packages/cli/src/lib/http.ts`, `init`, Host key verification and configuration
storage, and all Worker dashboard/Host/Access/Connect authorization unchanged.

Historical design documents and release records retain their original evidence.
Current handbooks and README instructions must no longer promise legacy code or
browser login. Label the old deployment instructions as historical.

## Atomic commits

1. `refactor: remove retired next web app`: delete the application and dead
   deployment/login paths, remove active configuration and dependency references,
   prune the existing Bun lock without unrelated upgrades, update current docs,
   and verify the remaining Vite app, CLI and existing quality/security gates.
2. `fix: patch release security blockers`: patch only OSV-reported `sharp` to
   `0.35.5` and `source-map-js` to `1.2.2`, preserving every unrelated resolution.
3. `test: seed current rate limit windows`: correct the existing real-HTTP
   fixture to seed the tested token in the current and next minute, preserving
   the exact 429/Retry-After assertions and production rate limiting.
4. `chore: release v0.3.1`: explicitly increment patch from authoritative `0.3.0`,
   synchronize maintained workspace versions and assertions, refresh the lock,
   and update the changelog from `v0.3.0..HEAD`.

Full coverage passed all 1,144 tests with two workers; default CPU-derived
parallelism caused existing UI tests to exceed the unchanged five-second limit
under shared machine load. Bound root Vitest concurrency to two while preserving
every test, coverage threshold and file isolation.

Use explicit staging and normal hooks. The existing release helper broadly stages
files, so perform its publication steps manually. Push fast-forward `main`, create
immutable `v0.3.1`, and publish one GitHub Release without npm publication. Verify
CI and the production Worker deployment for the exact release commit; pending
or failed results do not constitute a completed release.
