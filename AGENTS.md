# Steed

Personal system topology platform: one flat graph of hosts, services, agents and providers, written through the token-scoped Connect API.
Profile: ts-worker-web.
Direction: [current project scope](README.md). Frameworks must preserve this handbook.

## Scope and instruction sources

- This file is the only project handbook; nested files do not compete with it. Do not create a `CLAUDE.md` alias or copy.
- This file is the quality contract; hooks, CI and config are enforcement. Close implementation gaps without lowering the contract. Historical test results are not evidence of a current passing run.
- Setup: [README.md](README.md). Current model and API: [Phase 1 and 2 topology](docs/19-phase1-topology-model.md); local Connect configuration: [architecture workspace](docs/13-architecture-diagrams-and-connect.md) and [dev domain](docs/15-local-dev-domain.md). Versions/dependencies: root and workspace manifests, `bun.lock`. Tests/deployment: `vitest.config.ts`, `scripts/run-*-e2e.ts`, `.husky`, CI/release workflows. Accidents: [Retrospective.md](Retrospective.md). Machine workflow: global `AGENTS.md` and Git rules.

## Project invariants

- Steed is a topology platform, not an agent asset inventory or remote control. An agent is one node type in a single graph; the browser is read-only, and structure is written through the topology-scoped Connect API. Satellites have at most two nested levels.
- Production uses the full `apps/web` Worker with Cloudflare Access and D1. The retired inventory (CLI, Host Service, Host API, inventory pages and tables) and the Next.js/Railway application are removed; do not reintroduce them. `/api/v1/*` is served only by Connect Bearer authentication.
- Connect credentials and keyring stay ignored/private; preserve explicit managers, same-origin writes, revision/idempotency and confirmation/challenge boundaries.
- Development starts with a reviewed numbered doc and atomic commit plan. Reuse healthy owned processes and existing Connect configuration. Clearing local or production topology data needs an owner decision recorded in a numbered doc and, for production, a D1 backup first.

## Setup and commands

UI/Worker/Connect API: `apps/web`, Vite/React/React Flow + Access; D1 migrations in `apps/web/migrations`. Shared contracts: `packages/api` (`./shared`). Use Bun for package/scripts, Node 22.12+, gitleaks and OSV. Before starting dev, query nmem for Steed port reservations and inspect Caddy/listeners. Tests use local Wrangler and synthetic credentials.

```bash
bun install --frozen-lockfile
bun run typecheck
bun run lint
bun run build
bun run test                    # Vitest with coverage
bun run check-coverage
bun run test:e2e                # topology and Connect over local HTTP
bun run test:browser            # L3: Playwright clicks every node of the acceptance topology
bun run bench:topology          # local HTTP/D1 capacity benchmark
```

## Testing and quality contract

6DQ keeps its name with unified L1, L2/L3, G2 and D1; the owner merged former G1 into L1 on 2026-09-21. Statuses: `enforced`, `planned`, `manual`, or `N/A`; partial enforcement below does not certify the full required bar.
Unified L1 requires statements, branches, functions and lines each ≥95%, with no skipped/focused tests; strict check-only types and lint/format with zero errors/warnings; installed hooks and failure rejection. Preserve any stricter package threshold.
G2 requires dependency and secret scans, with missing required scanners failing.

| Dimension | Status | Required proof and current evidence/gap |
|---|---|---|
| L1 TypeScript | planned | Hooks/CI count Worker code and gate statements/functions/lines 95%, branches 90%. Missing-report success in `check-coverage` and the 90% branch floor leave all-four 95% incomplete. Hooks/CI run root strict types and ESLint `--max-warnings=0`; formatting and full index-snapshot checks remain incomplete. |
| L2 API | planned | Two local real-HTTP runners cover topology and Connect, each with an isolated temporary D1 and process-group cleanup; Connect exercises all registered operations. Audited 100% endpoint/auth/error coverage remains required. |
| L3 browser | enforced (CI) | `scripts/run-browser-e2e.ts` builds, seeds `apps/web/e2e/acceptance-topology.json` into an isolated local D1, then clicks every topology node in headless Chromium and fails on any crash or console error. `--screens <dir>` writes light/dark screenshots; `STEED_BROWSER_CHANNEL=chrome` uses installed Chrome. Not in pre-push. |
| G2 | enforced | Pre-push and shared CI run OSV on Bun lock plus gitleaks; missing scanners must fail. |
| D1 | planned | Topology/Connect runners use marked mkdtemp local persist directories and canonical-path cleanup checks. Full fail-closed initialization remains incomplete. |

Pre-commit runs types/lint/coverage in parallel, then the coverage-summary check. Pre-push runs local HTTP E2E and security in parallel; build happens inside newer E2E runners and in CI. Existing gates operate on the working tree rather than index/pushed refs.

Target hooks: pre-commit checks unified L1 against the index snapshot (`git checkout-index`) in <30s; pre-push checks L2 and G2 in parallel against every stdin push ref/commit in <3min, plus build where applicable. L3 runs in CI or an explicit manual lane.
Never bypass commit/push hooks, force-push, or use autofix in checks. Documentation changes do not authorize deploying or implementing new gates.

## Resources and isolation

Dev entry must be `https://steed.dev.hexly.ai`: Caddy → Vite 7035 → full Web Worker 37035, inspector 38035; preserve Host/HTTPS origin, exact allowlist, loopback binds and strict ports. L2 runners reserve ephemeral loopback ports. Tests must use unique per-run local D1, `NODE_ENV=test`, checked markers and owned cleanup; no remote test resources.

## Operations / release

Keep authorized development releases prompt through the existing CI → `apps/web --env production` workflow. The release workflow does not apply D1 migrations; back up production D1, then apply them manually after deploy. Production secret `CONNECT_MANAGERS` is a comma-separated list of exact `email:<lowercase address>` or `subject:<Access sub>` entries (a bare email never matches); see docs/19. Verify trusted HTTPS, `/api/live`, actual topology and Connect before claiming dev ready; record new reservations in nmem.

## Retrospective

Move accident narratives to [Retrospective.md](Retrospective.md); keep at most about ten concise recurring project rules here. Put architecture and operational detail in linked docs.

- E2E runners spawn Wrangler detached and stop the whole process group; orphaned children hold pipes open and hang pre-push.
- Deployment failures identify missing test coverage; record the incident and add a regression test.
