# Steed

> AI Hub — Asset visibility & relationship management for the multi-agent era.
> v1 scope: inventory, status display, manual classification & binding. No remote control.

## Deployment Stance (Development Phase)

- Currently in **development phase**, no external users — **do not treat deployment as a ceremonial event**.
- This is a personal tool. **Whenever the Worker has a git update, just `wrangler deploy`** — ship first, fix later if it breaks.
- If a deploy does break something, that means **our tests missed it**; note it down and backfill the missing test afterward. Don't let this slow the release cadence.

## Development Rules

### 1. Numbered Documents First

All development MUST start with a numbered document in `docs/`. Write the doc, review it thoroughly, then execute.

- File naming: `01-file-name.md` (numbered, lowercase English, hyphen-separated)
- Docs must include: design details, code references, atomic commit plan
- `docs/README.md` maintains the index of all documents
- Subdirectories (`architecture/`, `features/`, `archive/`) use independent numbering with their own `README.md`

### 2. Atomic Commits

Every change must be an atomic commit — one logical change per commit.

- Plan atomic commit steps BEFORE writing code
- Each commit must be self-contained and pass all checks
- Commit message format: imperative mood, concise, explains "why"

### 3. Git Hooks (Enforced)

Pre-commit and pre-push hooks are mandatory infrastructure.

- **pre-commit** (<30s): G1 (tsc --noEmit + ESLint strict --max-warnings=0) ‖ L1 (vitest + coverage ≥ 90%)
- **pre-push** (<3min): L2 (E2E true HTTP, D1 test isolation) ‖ G2 (osv-scanner + gitleaks)
- Hooks must NEVER be skipped (`--no-verify` is forbidden)
- All commits must pass hooks before being accepted

### 4. 6DQ Quality Framework

Six-dimension quality system: L1/L2/L3 + G1/G2 + D1.

| Dimension | Tool | Gate | Target |
|-----------|------|------|--------|
| L1 Unit | vitest + check-coverage ≥ 90% | pre-commit | Unit tests |
| L2 Integration | run-e2e.ts, true HTTP | pre-push | 100% API endpoint coverage |
| L3 System | Playwright | on-demand | Dashboard core flows |
| G1 Static | tsc strict + ESLint tseslint.configs.strict --max-warnings=0 | pre-commit | Zero warnings |
| G2 Security | osv-scanner + gitleaks | pre-push | Dependency + secret scan |
| D1 Isolation | steed-db-test D1 instance + _test_marker verification | pre-push (L2) | Test isolation |

## Tooling

- **Package manager**: Bun (all install, run, test, build via `bun`)
- **Monorepo**: Bun workspaces
- **Language**: TypeScript throughout

## Architecture

```
┌─────────────────────────────────────┐
│       Dashboard (Railway)           │
│       Web UI + metadata mgmt        │
└───────────────┬─────────────────────┘
                │ HTTPS (server-side)
┌───────────────┴─────────────────────┐
│       CF Worker (API layer)         │
│       All reads/writes via D1       │
└───────────────┬─────────────────────┘
                │ HTTPS
    ┌───────────┼───────────┐
    ▼           ▼           ▼
  Host A      Host B      Host C
 (Service     (Service     (Service
  + CLI)       + CLI)       + CLI)
```

### Monorepo Packages

| Package | Description | Runtime |
|---------|-------------|---------|
| `packages/dashboard` | Web UI for global view + metadata management | Railway |
| `packages/worker` | API layer, connects to D1 | Cloudflare Workers |
| `packages/cli` | CLI + Host Service (heartbeat every 10min) | Bun on host |
| `packages/shared` | Shared types, constants, utilities | — |

### Key Decisions

- **Dashboard** deploys to Railway, calls Worker API via server-side only (no direct DB access, browser never holds Worker credentials). User auth via Google OAuth whitelist; Worker calls use internal `DASHBOARD_SERVICE_TOKEN`
- **CF Worker** is the single API gateway, owns D1 connection
- **Host Service** runs as a resident process, heartbeat snapshot every 10 minutes; CLI for manual scan/register/debug
- **D1** is the sole persistent store
- **v1 data model**: Heartbeat snapshot. Host Service generates full resource snapshot every 10min and reports; Worker does idempotent upsert. No event stream or version history
- **Agent identification**: Auto-scan known types (including runtime_app + runtime_version) + manual registration. Agent identity is the user-confirmed management object, not the scan result itself
- **Data source detection**: PATH probe + config file scan (dual confirmation) + version collection. Scan only discovers resources, does NOT auto-establish Agent ↔ Data Source relationships
- **Lane assignment**: Agent belongs to one Lane (manual). Data Source belongs to one or more Lanes (manual, multi-select). Binding relationships are independent of Lane assignment
- **Agent boundary**: Autonomous agent systems only (OpenClaw, Hermes, etc.). Interactive dev tools (Claude Code, Codex, Cursor) are NOT Agent entities in v1
- **Two-layer auth**: Google OAuth whitelist at Dashboard (D1 stores no admin info); Worker only recognizes `DASHBOARD_SERVICE_TOKEN` (dashboard role) and Host API Key (host role). Worker never handles Google identity directly

### Core Concepts

- **Host**: A machine running the Host Service + CLI
- **Agent**: A managed autonomous agent entity on a host. Carries human-maintained metadata (nickname, role, lane) + scanned runtime info (runtime_app, runtime_version, status)
- **Data Source**: A discoverable external resource on a host (CLI, third-party platform CLI, MCP service, etc.). Belongs to one or more Lanes
- **Lane**: Business line tag — Work, Life, or Learning
