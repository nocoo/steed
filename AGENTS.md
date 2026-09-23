# Steed

Multi-host autonomous-agent inventory, architecture diagrams and explicit relationship management.
Profile: ts-worker-web + ts CLI/service.
Direction: [current project scope](README.md). Frameworks must preserve this handbook.

## Scope and instruction sources

- This file is the only project handbook; nested files do not compete with it. Do not create a `CLAUDE.md` alias or copy.
- This file is the quality contract; hooks, CI and config are enforcement. Close implementation gaps without lowering the contract. Historical test results are not evidence of a current passing run.
- Setup/inventory workflow: [README.md](README.md) and [agent workflow](docs/16-agent-workflow.md). Current web/Connect: [architecture workspace](docs/13-architecture-diagrams-and-connect.md) and [dev domain](docs/15-local-dev-domain.md). Versions/dependencies: root and workspace manifests, `bun.lock`. Tests/deployment: `vitest.config.ts`, `scripts/run-*-e2e.ts`, `.husky`, CI/release workflows. Accidents: [Retrospective.md](Retrospective.md). Machine workflow: global `AGENTS.md` and Git rules.

## Project invariants

- Inventory scope is visibility, status and manual classification/binding, not general remote control. Host snapshots update every ten minutes; scanning alone never creates a managed Agent or binding.
- Agent identity is a user-confirmed autonomous system; IDE/dev tools are not v1 Agent entities. One Lane per Agent, multiple per Data Source; binding is independent of Lane.
- Production uses the full `apps/web` Worker with Cloudflare Access and D1; `apps/web_legacy` contains the older Next.js/Railway implementation. Keep internal dashboard and Host API-key scopes distinct.
- Connect credentials and keyring stay ignored/private; preserve explicit managers, same-origin writes, revision/idempotency and confirmation/challenge boundaries.
- Development starts with a reviewed numbered doc and atomic commit plan. Reuse healthy owned processes, existing D1 and Connect configuration; do not reset the architecture workspace.

## Setup and commands

Current UI/Worker: `apps/web`, Vite/React/React Flow + Access. API/schema: `packages/api`, `packages/worker` Hono/D1/migrations. Host/shared: `packages/cli` Bun service/CLI, `packages/shared`. Use Bun for package/scripts, Node 22.12+, gitleaks and OSV. Before starting dev, query nmem for Steed port reservations and inspect Caddy/listeners. Use document 13 for the existing dataset; tests use local Wrangler and synthetic credentials.

```bash
bun install --frozen-lockfile
bun run typecheck
bun run lint
bun run build
bun run test                    # Vitest with coverage
bun run check-coverage
bun run test:e2e                # API, diagrams, Connect over local HTTP
bun run --cwd packages/cli build
bun run packages/cli/src/bin/steed.ts --help
```

## Testing and quality contract

6DQ keeps its name with unified L1, L2/L3, G2 and D1; the owner merged former G1 into L1 on 2026-09-21. Statuses: `enforced`, `planned`, `manual`, or `N/A`; partial enforcement below does not certify the full required bar.
Unified L1 requires statements, branches, functions and lines each ≥95%, with no skipped/focused tests; strict check-only types and lint/format with zero errors/warnings; installed hooks and failure rejection. Preserve any stricter package threshold.
G2 requires dependency and secret scans, with missing required scanners failing.

| Dimension | Status | Required proof and current evidence/gap |
|---|---|---|
| L1 TypeScript | planned | Hooks/CI gate statements/functions/lines 95%, branches 90%. CLI entry exclusions and missing-report success in `check-coverage` leave all-four 95% incomplete. Hooks/CI run root strict types and ESLint `--max-warnings=0`; formatting and full index-snapshot checks remain incomplete. |
| L2 API / CLI | planned | Three local real-HTTP runners cover API, diagrams and Connect; require audited 100% endpoint/auth/error coverage plus actual CLI/service flows. The legacy migration runner can continue after init failure. |
| L3 browser / CLI | manual | No Playwright gate is configured. Verify full pages, rendered diagrams and Connect through trusted dev HTTPS with disposable data; prove CLI workflows separately. |
| G2 | enforced | Pre-push and shared CI run OSV on Bun lock plus gitleaks; missing scanners must fail. |
| D1 | planned | Diagram/Connect use mkdtemp/local persist directories; legacy API uses fixed `.wrangler/state/e2e`. Full marker/canonical-path cleanup guards and fail-closed initialization are incomplete. |

Pre-commit runs types/lint/coverage in parallel, then the coverage-summary check. Pre-push runs local HTTP E2E and security in parallel; build happens inside newer E2E runners and in CI. Existing gates operate on the working tree rather than index/pushed refs.

Target hooks: pre-commit checks unified L1 against the index snapshot (`git checkout-index`) in <30s; pre-push checks L2 and G2 in parallel against every stdin push ref/commit in <3min, plus build where applicable. L3 runs in CI or an explicit manual lane.
Never bypass commit/push hooks, force-push, or use autofix in checks. Documentation changes do not authorize deploying or implementing new gates.

## Resources and isolation

Dev entry must be `https://steed.dev.hexly.ai`: Caddy → Vite 7035 → full Web Worker 37035, inspector 38035; preserve Host/HTTPS origin, exact allowlist, loopback binds and strict ports. Root `dev:worker` is the historical API Worker. L2 API defaults to 18787 (`TEST_PORT`), newer runners reserve ephemeral loopback ports. Tests must use unique per-run local D1, `NODE_ENV=test`, checked markers and owned cleanup; no remote test resources.

## Operations / release

Keep authorized development releases prompt through the existing CI → `apps/web --env production` workflow. Root `deploy:worker` targets the historical Worker; use current release docs for production. Verify trusted HTTPS, `/api/live`, actual diagrams and Connect before claiming dev ready; record new reservations in nmem.

## Retrospective

Move accident narratives to [Retrospective.md](Retrospective.md); keep at most about ten concise recurring project rules here. Put architecture and operational detail in linked docs.

- Config-file presence is an observation, not proof that remote credentials remain valid.
- User metadata/bindings and scan observations have different ownership.
- Deployment failures identify missing test coverage; record the incident and add a regression test.
