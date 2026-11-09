# 18 — Phase 0: topology platform cleanup

## Scope and decisions

Steed becomes the owner's personal system topology platform: one flat graph in
which an agent is only one node type, layers grouped by vendor or provider,
satellite nodes, trust domains, a read-only web UI, structure written through
the token API, and dark and light sci-fi themes. Phase 0 removes the legacy
agent-asset inventory and keeps the diagrams and Connect code as the Phase 1
base. The work starts from remote `main` at
`17bd208` (v0.3.6).

Owner decisions (2026-10-31) recorded by the requirements owner:

- Discard all legacy inventory data. No machine runs the Host Service; remove
  `packages/cli`, the Host API and every inventory page.
- Delete every existing diagram without migration; Phase 1 introduces a single
  canonical topology.
- Clear all Connect state (tokens, requests, confirmations, rate-limit windows)
  together with the diagrams; keep only `connect_audit`.
- Clear the local development D1 the same way. The former "do not reset the
  architecture workspace" invariant is retired.
- Keep the name `steed` and the `steed.hexly.ai` domain.
- Read-only browser rework is deferred to Phase 1; Phase 0 keeps the existing
  diagram page behind the renamed Topology entry.

## Current-state evidence

- Inventory tables (migrations `0001`–`0004`): `lanes`, `hosts`, `agents`,
  `data_sources`, `data_source_lanes`, `agent_data_source_bindings`.
- Kept tables: `diagrams` (`0005`); `connect_tokens`, `connect_confirmations`,
  `connect_requests`, `connect_audit`, `connect_rate_limits` (`0006`).
- Foreign keys: `connect_tokens.diagram_id → diagrams(id)` and
  `connect_requests.token_id`, `connect_confirmations.token_id →
  connect_tokens(id)`, all without `ON DELETE`. D1 enforces foreign keys, so
  deletes must run child-first. `connect_audit` and `connect_rate_limits` have
  no foreign keys.
- Migrations live in `packages/worker/migrations` and are referenced by
  `apps/web/wrangler.toml`, `apps/web/worker/__tests__/db.ts` and
  `scripts/run-e2e.ts`. They must move before `packages/worker` is deleted.
  File names stay unchanged, so production `d1_migrations` history still
  matches.
- The release workflow only runs `wrangler deploy --env production`; it does
  not apply D1 migrations. `0007` and `0008` are applied manually after deploy.
- `scripts/release.ts` commits to and pushes `main` and tags directly, so the
  version bump is made by hand inside this PR and the tag follows the merge.
  `apps/web` and `packages/api` manifests still read `0.3.4`; they are
  synchronized to the new version.
- Root coverage counts `apps/web/src/test-setup.ts` (the `apps/web` project
  config already excludes it). With the inventory removed, functions coverage
  is projected at 94.7%, below the 95% gate; excluding the test helper projects
  about 97.7%. Root coverage does not include `apps/web/worker/**`; that
  pre-existing gap is out of scope and tracked for Phase 1.
- Production Access already bypasses `/api/live` and `/api/v1/*`: those paths
  return the Worker's own JSON 401 with `WWW-Authenticate: Bearer
  realm="steed-connect"`, while `/`, `/connect`, `/api/me`, `/api/connect` and
  `/api/diagrams` redirect to the Access login. No Access change is needed.
  The Worker enforces its own Bearer authentication (`apps/web/worker/connect.ts`:
  hashed opaque tokens, revocation, expiry, manager re-check, write scope,
  rate limits, audit, cross-origin denial).

## Target routing after Phase 0

- `/api/live`: unauthenticated liveness.
- `/api/v1/*`: Connect Bearer handler only; no token → 401, unknown route → 404.
- Other `/api/*`: Access-verified `/api/me`, `/api/diagrams*`, `/api/connect*`;
  unknown routes → 404.
- Everything else: SPA assets.
- Sidebar: Topology (`/topology`, `/topology/:id`, rendering the existing
  diagram page) and Connect. `/` and `/diagrams*` redirect to `/topology`.
  Browser `/api/diagrams` and machine `/api/v1/diagrams` stay unchanged until
  Phase 1/2.

## Atomic commits

Every commit is one logical change, uses Conventional Commits with a lowercase
subject of at most 50 characters, and passes the pre-commit hook (typecheck,
lint, tests with coverage, coverage gate). The branch passes pre-push (local
HTTP E2E, OSV, gitleaks) before every push. Hooks are never bypassed.

1. `docs: add phase 0 topology cleanup plan` — this document and the docs index.
2. `test: exclude test setup from coverage` — add `**/test-setup.ts` to the root
   coverage exclusions, matching `apps/web`; thresholds unchanged.
3. `refactor(web): remove inventory pages` — delete `routes/{overview,hosts,map}`,
   `routes/agents/*`, `routes/data-sources/*`,
   `components/map/{lane-map,map-filters,map-legend,node-drawer,layout}`,
   `components/map/nodes/*`, `components/ui/lane-chips`,
   `lib/{map-data,schemas}`, the agent, agents, agent-bindings, data-source,
   data-sources, hosts, map and overview viewmodels, `contexts/api-client` and
   `viewmodels/__tests__/test-utils` with their tests; update `router.tsx`,
   `App.tsx`, app/router tests, `navigation.ts` (single Workspace group, no
   Overview breadcrumb), `app-frame` and `app-sidebar` tests.
4. `build(web): drop unused form deps` — remove `react-hook-form` and
   `@hookform/resolvers`; refresh `bun.lock` without unrelated upgrades.
5. `feat(web): rename diagrams nav to topology` — Topology nav item and routes,
   redirects from `/` and `/diagrams*`, internal links, header trail, tests.
6. `refactor(worker): route v1 only to connect` — drop `@steed/worker`,
   `@steed/api/server` and the dashboard router from `apps/web/worker/index.ts`;
   send all `/api/v1/*` to the Connect handler and return 404 for unknown
   Access-verified `/api/*`; remove `DASHBOARD_SERVICE_TOKEN` from the Env type,
   `wrangler.toml` (comment, production required secrets, dev vars) and the
   regenerated `bindings.d.ts`; update `index.test.ts` and
   `connect-entry.test.ts`; change `run-connect-e2e.ts` to expect 401 for
   `/api/v1/hosts` with `dev-token` and 404 with a valid Connect token; delete
   `scripts/run-e2e.ts` and drop it from `test:e2e`; remove the `@steed/worker`
   dependency.
7. `refactor(db): move migrations to apps/web` — `git mv` the directory, set
   `migrations_dir = "migrations"` for both environments, update the test
   database helper path.
8. `refactor: remove packages/worker` — delete the package, root
   `dev:worker`/`deploy:worker` scripts, Vitest project, tsconfig include and
   release targets; refresh `bun.lock`.
9. `refactor: remove packages/cli` — delete the package, Vitest project and
   `cli/src/bin` coverage exclusion, tsconfig include and release targets;
   refresh `bun.lock`.
10. `refactor(api): drop inventory client and server` — delete
    `packages/api/src/{client,server}` and `shared/{lane-map,schemas}` with
    tests, rewrite `smoke.test.ts`, keep only the `./shared` export, drop the
    `@steed/shared` dependency.
11. `refactor: remove packages/shared` — only `generateId` remains and nothing
    else uses it; delete the package and its tsconfig paths/include, Vitest
    project, release targets and lock entries.
12. `feat(db): drop inventory tables` — `apps/web/migrations/0007_drop_inventory.sql`
    with `DROP TABLE IF EXISTS` child-first: `agent_data_source_bindings`,
    `data_source_lanes`, `agents`, `data_sources`, `hosts`, `lanes`. Test that
    the six tables are absent and the diagram and Connect tables remain.
13. `feat(db): clear diagrams and connect state` —
    `apps/web/migrations/0008_clear_diagrams_connect.sql`, foreign-key order:
    `DELETE FROM connect_requests`, `connect_confirmations`,
    `connect_rate_limits`, `connect_tokens`, then `diagrams`. `connect_audit`
    is kept. Test by applying `0001`–`0007`, seeding every table, applying
    `0008` and asserting empty tables plus retained audit rows.
14. `docs: reposition readme and agents` — README (Chinese and English) and
    `AGENTS.md` describe the topology platform; remove CLI/Host invariants and
    commands; replace the workspace-reset invariant; update the 6DQ L2 row for
    the two remaining runners; mark historical documents in the index.
15. `chore(release): bump version to 0.4.0` — root, `apps/web` and
    `packages/api` manifests, version assertions in `version.test`,
    `worker/index.test` and `app-sidebar.test`, remaining `release.ts` targets,
    and a hand-written `CHANGELOG` entry.

## Risks

- Coverage drops when covered code is deleted together with tests that also
  exercised kept files; every commit re-checks the gate locally.
- Lockfile changes may conflict with open dependency PRs. Merge order is
  coordinated; issue #96 becomes obsolete once its package is removed.
- `DASHBOARD_SERVICE_TOKEN` must leave the production required-secrets list
  and be deployed before the production secret is deleted.
- L2 shrinks to the diagram and Connect runners; endpoint coverage is
  re-audited against the remaining routes.
- No Playwright gate exists; the sidebar check is a unit test plus a manual
  production check.

## Acceptance checklist

- [ ] `bun run typecheck`, `bun run lint`, `bun run test`,
      `bun run check-coverage` (95/90/95/95) green on every commit.
- [ ] `bun run test:e2e` green; OSV and gitleaks clean.
- [ ] CI quality workflow green on the PR.
- [ ] Sidebar shows only Topology and Connect; `/` and `/diagrams*` redirect to
      `/topology`.
- [ ] No references remain to `packages/{cli,worker,shared}`,
      `@steed/api/{client,server}` or `DASHBOARD_SERVICE_TOKEN` outside
      historical documents and the changelog.
- [ ] Migrations `0007` and `0008` apply cleanly to an empty and a seeded
      local D1.
- [ ] Production `/api/live` returns 200 with version `0.4.0`; Topology and
      Connect pages load behind Access.

## Post-merge production steps

Executed by the repo steward after merge and a green release run:

1. Back up production D1 to a private box path before any schema change:
   `bunx wrangler d1 export steed --env production --remote --output <private path>/steed-pre-0.4.0.sql`
   from `apps/web`; record `bunx wrangler d1 time-travel info steed` as a
   restore point.
2. Confirm the release workflow deployed `0.4.0` (`/api/live`). The new code
   does not read inventory tables, so deploy-before-migrate is safe.
3. Apply migrations from `apps/web`:
   `bunx wrangler d1 migrations apply DB --env production --remote`
   (applies `0007` and `0008`).
4. Delete the retired secret:
   `bunx wrangler secret delete DASHBOARD_SERVICE_TOKEN --env production`.
5. Verify `/api/live` 200, `/api/v1/capabilities` still 401 without a token,
   and Topology/Connect behind Access. Tag `v0.4.0` and publish the GitHub
   Release.
6. Connect tokens are re-issued from `/connect` once Phase 2 scopes land.
