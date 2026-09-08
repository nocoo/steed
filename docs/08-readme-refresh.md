# README refresh and current entry points

## Purpose and scope

This documentation pass describes the implementation at `bcab1f113b9b7cde65898bbd23705c7dac339634`, inspected after `git pull --ff-only` on 2026-09-08. The original root README offered dependency installation but no working startup, feature or test guide.

The root README now uses Chinese, with a matching English version at `docs/README.en.md`. Both retain the adopted logo and show the website before the language link. No package versions, runtime code, deployment configuration or agent instructions are changed by this documentation pass.

The cross-project comparison and detailed evidence live in [hexly.ai's README refresh records](https://github.com/nocoo/hexly.ai/tree/main/docs/readme-refresh).

## Current implementation to describe

| Area | Current entry / evidence |
| --- | --- |
| Web UI | `apps/web/src/router.tsx`: overview, hosts, agents, data sources and relationship map |
| Deployment | `.github/workflows/release.yml`: build `apps/web` and deploy its Worker with the `production` environment |
| Web gateway | `apps/web/worker/index.ts`: serve assets, route `/api/v1/*` to the Hono API in process, authenticate the browser API with Access |
| Database API | `packages/worker/src/index.ts`, `packages/worker/src/routes/`, `packages/worker/migrations/` |
| API client / handlers | `packages/api/src/client/`, `packages/api/src/server/` |
| CLI | `packages/cli/src/index.ts`, `commands/`, `service/`, `config/` |
| Unit / UI tests | Root `vitest.config.ts` includes the current packages and `apps/web`; the latter uses jsdom and React Testing Library |
| HTTP tests | `scripts/run-e2e.ts` starts the API Worker and an isolated local D1 database on port 8787 |

The active deployment is Vite / React with Workers, D1 and Access. `apps/web_legacy` preserves the previous Next.js implementation. Earlier architecture documents and CLAUDE.md still contain the older Railway / Google OAuth design; they are historical context for this README pass.

## Behavior boundaries

- Agents are explicitly registered and then checked through configured process, file or custom-command probes. Scanning does not invent managed Agent records or Agent–Data Source bindings.
- The data-source scanner currently scans configured CLI tools. The `mcp_scanners` configuration is present but its scan implementation is deferred.
- Some authentication observations only check that a configuration path exists; they do not establish that a credential is still accepted by the remote service.
- `service start` runs in the foreground and sends periodic snapshots. The default interval is ten minutes; this is an inventory view, not live remote control.
- `login` still targets the legacy `/api/auth/cli` route. The current web API router does not provide that flow. The README documents initialization with an existing Host API key.
- `test:e2e` tests the database API over HTTP. There is no checked-in Playwright browser suite for the current web entry.

## Local development details

The Vite dev server forwards `/api` to port 8787. Use the **web** package's `dev:worker` script for that port so browser routes, Access development handling and database routes are all available. The root `dev:worker` script starts only the lower-level API Worker.

The SQL migrations live in `packages/worker/migrations`. Apply them from that package with `--local`, pointing `--persist-to` to the same state directory used by the web dev Worker: `../../apps/web/.wrangler/state/web`. Then start `apps/web`'s Worker and Vite in separate terminals. Build the SPA once before starting the Worker, because its assets binding points at `dist`.

The `dev` environment includes local-only Access bypass and a development service token in checked-in configuration. It needs no production credentials for local use. Production uses the `production` environment and the account's own Access / D1 configuration.

## Atomic delivery plan

1. Record current entry points, boundaries and source evidence in this numbered document.
2. Rewrite `README.md` and add `docs/README.en.md`, with corresponding sections and examples.
3. Verify relative links, CLI help, the SPA build, the local HTTP setup and repository checks; store concrete results in hexly.ai's investigation record.
4. Commit this documentation as one change, pull again and push main. Keep versions unchanged.

## Validation

The web build, typecheck and lint passed on 2026-09-08, along with all 1009 unit/component tests and 59 HTTP tests. A fresh temporary D1 state was migrated and shared with the complete web Worker; its document, browser host/lane APIs and API health endpoint all returned HTTP 200. The temporary state and owned server process were removed afterward. Each README has eight corresponding sections and twelve valid local references; executable examples match between languages.

The current repository has no configured browser end-to-end suite. This pass did not exercise production business operations through an authenticated browser. Final commit, hook and CI results are recorded in the linked cross-project investigation.
