<p align="center">
  <img src="../assets/brand/icon-rounded.png" alt="Steed" width="128" height="128" />
</p>

<h1 align="center">Steed</h1>

<p align="center">A personal system topology platform: hosts, services, agents and providers in one graph.</p>

<p align="center">
  <a href="https://steed.hexly.ai">Website</a> ·
  <a href="../README.md">简体中文</a>
</p>

## What it does

Steed is a personal system topology platform. Hosts, services, agents, data sources and external providers sit in one graph, layered by vendor or provider and marked with trust domains. The web UI is for browsing; the graph structure is written through the token-scoped Connect API.

Version 0.4.0 removed the earlier agent asset inventory and cleared the old diagrams and Connect state. The new canonical model is described in the [Phase 1 and Phase 2 design](19-phase1-topology-model.md).

## Features

- Topology page: browse layers, nodes, satellites, boundaries and relationships on a read-only React Flow canvas, filter by view or attributes, and inspect details.
- Connect page: issue, reveal, rotate and revoke tokens with `topology:read` or `topology:write` scope.
- Connect API (`/api/v1/topology*`): machines use Bearer tokens to read, validate, replace or incrementally change topology, read history and revert conflict-free changes; writes use revisions, idempotency keys and audit records.

## Usage

The [website](https://steed.hexly.ai) pages and browser API sit behind Cloudflare Access and require an authorized identity. `/api/live` bypasses Access; `/api/v1/*` also bypasses Access and the Worker verifies Connect tokens instead. The browser `/api/topology` is read-only; structural writes use the Connect API. A separate deployment needs its own Access application, D1 database and Connect keyring. See the [design](19-phase1-topology-model.md#api-shape) for routes and preconditions.

## Development

Install Bun and Node.js 22.12+. Node runs tools such as Vite and Wrangler. All examples start at the repository root.

```bash
git clone https://github.com/nocoo/steed.git
cd steed
bun install --frozen-lockfile
bun run build
```

Initialize the local database used by the web Worker. Migrations live in `apps/web/migrations`:

```bash
cd apps/web
bunx wrangler d1 migrations apply DB --env dev --local --persist-to .wrangler/state/web
cd ../..
```

Start these processes in separate terminals:

```bash
# Terminal one: complete web Worker on loopback port 37035
bun run --cwd apps/web dev:worker
```

```bash
# Terminal two: Vite on port 7035, through https://steed.dev.hexly.ai
bun run dev
```

Vite proxies `/api` to the local web Worker. Use `https://steed.dev.hexly.ai` through the existing Caddy proxy. Query nmem for port reservations and check the Caddy mapping and listeners before starting; the Worker inspector uses 38035. The Access development bypass permits loopback and this exact HTTPS origin. For local Connect configuration see [architecture diagrams and Connect](13-architecture-diagrams-and-connect.md#local-configuration-and-future-enablement).

`bun run build` builds the web assets. Use `bun run typecheck` and `bun run lint` for types and code style.

```text
apps/web/              React pages, web Worker, Access verification, Connect API
apps/web/migrations/   D1 migrations
packages/api/          Shared topology, Connect and profile contracts (zod)
```

The production workflow builds `apps/web` and deploys its `production` environment to Cloudflare Workers.

## Tests

Run from the repository root:

| Layer | Command |
| --- | --- |
| All unit and component tests | `bun run test` |
| Web component and view-model tests | `bun run --cwd apps/web test` |
| Topology and Connect HTTP integration tests | `bun run test:e2e` |
| Local topology capacity and latency benchmark | `bun run bench:topology` |

`bun run test` writes a coverage report including the Worker, and `bun run check-coverage` checks its thresholds; `bun run test:watch` runs in watch mode. Web tests use jsdom and React Testing Library. `test:e2e` runs the topology and Connect HTTP runners in turn; each starts local Wrangler, applies migrations in a temporary D1 state directory and uses an ephemeral loopback port. The benchmark measures operation p95 over local HTTP and D1 using a synthetic 1000-node, 5000-edge topology.

There is no configured browser end-to-end test command; complete browser journeys still need manual verification.

## Stack

![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)
![Bun](https://img.shields.io/badge/Bun-14151A?logo=bun&logoColor=white)
![React](https://img.shields.io/badge/React-20232A?logo=react&logoColor=61DAFB)
![Vite](https://img.shields.io/badge/Vite-646CFF?logo=vite&logoColor=white)
![Cloudflare Workers](https://img.shields.io/badge/Cloudflare_Workers-F38020?logo=cloudflareworkers&logoColor=white)
![D1](https://img.shields.io/badge/D1-F38020)
![React Flow](https://img.shields.io/badge/React_Flow-1A192B)
![Cloudflare Access](https://img.shields.io/badge/Cloudflare_Access-F38020)

| Area | Implementation |
| --- | --- |
| Web interface | React, React Router, Vite, Tailwind CSS, Radix UI |
| Topology graph | React Flow |
| Services and storage | Cloudflare Workers, D1; Cloudflare Access for the browser entry |
| Verification | Vitest, React Testing Library, jsdom, TypeScript, ESLint |

Dependency versions are recorded in the [workspace package manifests](../package.json) and [bun.lock](../bun.lock).

## Documentation

- [Documentation index](README.md)
- [Phase 0: topology platform cleanup](18-phase0-topology-cleanup.md)
- [Phase 1 and Phase 2: topology model and Connect](19-phase1-topology-model.md)
- [Architecture diagrams and Connect](13-architecture-diagrams-and-connect.md)
- [Local development domain](15-local-dev-domain.md)

## License

[MIT](../LICENSE) © 2026 Zheng Li
