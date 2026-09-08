<p align="center">
  <img src="../assets/brand/icon-rounded.png" alt="Steed" width="128" height="128" />
</p>

<h1 align="center">Steed</h1>

<p align="center">See the agents, tools and relationships across your hosts in one place.</p>

<p align="center">
  <a href="https://steed.hexly.ai">Website</a> ·
  <a href="../README.md">简体中文</a>
</p>

## What it does

Steed is an asset inventory for autonomous agents. A CLI and Host Service report resource snapshots from each machine. The web dashboard brings hosts, agents, data sources and their bindings together so you can review status, ownership and business categories.

The current scope is inventory, status display and manually managed relationships. Agents are registered explicitly, then checked using configured detection methods. Users establish agent–data source bindings. Status comes from periodic snapshots, with a default interval of ten minutes.

## Features

- View host availability, last heartbeat, agent runtime status and versions.
- Scan configured CLI tools for versions and authentication observations. Default scanners cover Wrangler, Railway, GitHub CLI and Vercel CLI.
- Edit agent nicknames, roles and business categories, and maintain data-source notes, tags and categories. The preset categories are Work, Life and Learning.
- Bind agents to data sources on the same host. Filter the relationship map by host, business category or unbound resources.
- Scan, report snapshots and inspect status through the CLI, or run the Host Service in the foreground for periodic reporting.

Automatic data-source discovery currently covers CLI tools; MCP scanning is not implemented. Some authentication observations only check whether a configuration path exists, so they do not establish whether a remote credential is still valid.

## Usage

### Web dashboard

The [website](https://steed.hexly.ai) uses Cloudflare Access and requires an authorized identity. It provides Overview, Hosts, Agents, Data Sources and Map pages. A separate deployment needs its own Access application, D1 database and service credentials; see the [current entry-point notes](08-readme-refresh.md).

### Host CLI

Run the CLI from source. Install dependencies as described below, then inspect its commands:

```bash
bun run packages/cli/src/bin/steed.ts --help
```

An administrator registers the host through the Worker's `POST /api/v1/hosts/register` endpoint and obtains a Host API key. Initialize with `init --url <deployment-url> --key <host-api-key>`. Configuration is stored in `~/.steed/config.json`; local scan and service state are stored in `~/.steed/state.json`.

Common commands after initialization:

```bash
# Register an agent with its actual runtime and path
bun run packages/cli/src/bin/steed.ts register --match-key "openclaw:/path/to/agent"

bun run packages/cli/src/bin/steed.ts scan          # Save a local scan
bun run packages/cli/src/bin/steed.ts scan --json   # Print JSON
bun run packages/cli/src/bin/steed.ts report        # Scan and report
bun run packages/cli/src/bin/steed.ts status        # Inspect locally recorded state
bun run packages/cli/src/bin/steed.ts service start # Run in foreground; Ctrl+C stops
```

Registration supports process, configuration-file and custom-command detection; see `register --help`. The source still includes `login`, which depends on the legacy Dashboard's `/api/auth/cli` route. The current web entry does not implement that flow, so this guide uses Host API key initialization.

## Development

Install Bun and Node.js 22.12+. Node runs tools such as Vite and Wrangler. All examples start at the repository root.

```bash
git clone https://github.com/nocoo/steed.git
cd steed
bun install --frozen-lockfile
bun run build
```

Initialize the local database used by the web Worker. Migrations live in the API package; the state directory must match the web Worker's directory:

```bash
cd packages/worker
bunx wrangler d1 migrations apply DB --local \
  --persist-to ../../apps/web/.wrangler/state/web
cd ../..
```

Start these processes in separate terminals:

```bash
# Terminal one: complete web Worker, default port 8787
bun run --cwd apps/web dev:worker
```

```bash
# Terminal two: Vite frontend, default http://localhost:5173
bun run dev
```

Vite proxies `/api` to the local web Worker. The `dev` environment includes localhost-only Access development handling and a local service token. The root `bun run dev:worker` command starts only the lower-level API Worker; use the `apps/web` command above for the complete dashboard.

`bun run build` builds the web assets; `bun run --cwd packages/cli build` builds the CLI. Use `bun run typecheck` and `bun run lint` for types and code style.

```text
apps/web/           Current React pages, web Worker and Access verification
packages/api/       Browser API client and server handlers
packages/worker/    Hono API, D1 data access and migrations
packages/cli/       CLI, resource scanners and Host Service
packages/shared/    Shared types and utilities
apps/web_legacy/    Preserved Next.js implementation
```

The current production workflow builds `apps/web` and deploys its `production` environment to Cloudflare Workers. The Next.js / Railway architecture in earlier documents describes the previous implementation.

## Tests

Run from the repository root:

| Layer | Command |
| --- | --- |
| All unit and component tests | `bun run test` |
| Web component and view-model tests | `bun run --cwd apps/web test` |
| API HTTP integration tests | `bun run test:e2e` |

`bun run test` also writes a coverage report; `bun run test:watch` runs in watch mode. Web tests use jsdom and React Testing Library. HTTP tests start local Wrangler, apply migrations in a separate D1 state directory and use port 8787. Stop the development server on that port before running them.

There is no configured browser end-to-end test command. `test:e2e` covers real HTTP requests to the lower-level API; complete browser journeys still need manual verification.

## Stack

![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)
![Bun](https://img.shields.io/badge/Bun-14151A?logo=bun&logoColor=white)
![React](https://img.shields.io/badge/React-20232A?logo=react&logoColor=61DAFB)
![Vite](https://img.shields.io/badge/Vite-646CFF?logo=vite&logoColor=white)
![Hono](https://img.shields.io/badge/Hono-E36002?logo=hono&logoColor=white)
![Cloudflare Workers](https://img.shields.io/badge/Cloudflare_Workers-F38020?logo=cloudflareworkers&logoColor=white)
![D1](https://img.shields.io/badge/D1-F38020)
![React Flow](https://img.shields.io/badge/React_Flow-1A192B)
![Cloudflare Access](https://img.shields.io/badge/Cloudflare_Access-F38020)

| Area | Implementation |
| --- | --- |
| Web interface | React, React Router, Vite, Tailwind CSS, Radix UI |
| Relationship map | React Flow |
| Services and storage | Cloudflare Workers, Hono, D1; Cloudflare Access for the browser entry |
| CLI and Host Service | TypeScript, Bun, Commander |
| Verification | Vitest, React Testing Library, jsdom, TypeScript, ESLint |

Dependency versions are recorded in the [workspace package manifests](../package.json) and [bun.lock](../bun.lock).

## Documentation

- [Documentation index](README.md)
- [Current entry points, implementation boundaries and README evidence](08-readme-refresh.md)
- [Vite Web and Cloudflare Access migration](features/07-phase-f-vite-web-cf-access.md)
- [Host Service design](features/03-phase-c1-host-service.md)
- [CLI design](features/04-phase-c2-cli.md)
- [Relationship map design](features/06-phase-e-lane-map.md)

## License

[MIT](../LICENSE) © 2026 Zheng Li
