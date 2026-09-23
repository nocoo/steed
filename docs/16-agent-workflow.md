# Agent workflow and inventory constraints

Detailed project constraints and procedures. The root [AGENTS.md](../AGENTS.md) defines the quality contract and records current enforcement gaps.

## Workflow

Every development task starts with a numbered design document in `docs/`, reviewed before implementation. Use lowercase `NN-kebab-name.md`, include design/source references and atomic commit steps, and update `docs/README.md`. Architecture/features/archive directories use independent numbering and indexes. Each commit must pass checks and explain why.

This is a personal tool in development without external users. Keep authorized Worker code updates moving through the existing CI → production deployment workflow; a release failure belongs in the retrospective with a regression test. Current production is the full `apps/web` Worker, not the legacy Railway/Next.js diagram.

## Local Development

- The browser entry point MUST be **https://steed.dev.hexly.ai**, served through
  the existing Caddy HTTPS proxy to Vite on **7035**. A loopback URL alone does
  not complete a request to start dev.
- Before starting or allocating ports, query
  `nmem memories search "Steed local development ports" -n 5`
  and the latest port reservations. Inspect
  `/opt/homebrew/etc/Caddyfile`, current listeners, and candidate port bindability.
  Record new reservations in nmem; never assume an unused listener is unreserved.
- Coordinated ports: Vite **7035**, `apps/web` Worker **37035** (dev + 30000),
  inspector **38035**. Bind application servers to loopback; keep Vite's strict
  port and exact hostname allowlist. Preserve Host and HTTPS origin through the
  API proxy so same-origin writes and Connect work through Caddy.
- Reuse healthy services. Restart only identified Steed processes; preserve
  unknown changes/processes and other repositories. Existing wildcard DNS,
  certificates, and the Caddy mapping already cover this domain.
- Use [document 13's startup commands](../docs/13-architecture-diagrams-and-connect.md#local-configuration-and-future-enablement)
  for the current architecture workspace. Preserve its local D1 directory and
  ignored Connect env/keyring file across restarts. The full web backend is in
  `apps/web`; the root `dev:worker` script targets the historical API Worker.
- Verify trusted HTTPS, `/api/live`, actual diagram rendering, and Connect at
  the dev domain before reporting it ready. The port decision and verification
  record are in [document 15](../docs/15-local-dev-domain.md).


## Inventory model


- **Host**: A machine running the Host Service + CLI
- **Agent**: A managed autonomous agent entity on a host. Carries human-maintained metadata (nickname, role, lane) + scanned runtime info (runtime_app, runtime_version, status)
- **Data Source**: A discoverable external resource on a host (CLI, third-party platform CLI, MCP service, etc.). Belongs to one or more Lanes
- **Lane**: Business line tag — Work, Life, or Learning

## Inventory and identity boundaries

Host Service heartbeats provide a full snapshot every ten minutes for idempotent upsert, not an event stream/history. Auto-scan known runtime types and config/PATH/version observations; the managed Agent is user-confirmed. Detection never creates bindings automatically. Agents have one manually assigned Lane; Data Sources may have several, and bindings are independent. Interactive IDE/development tools are not autonomous Agent entities in v1.

`packages/worker` accepts dashboard service credentials and Host API keys; the current `apps/web` Worker supplies verified Cloudflare Access before internal API access. The old Next.js Google-whitelist/Railway layout remains historical in `apps/web_legacy`, not the current production entry.
