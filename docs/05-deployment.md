# 05 - Deployment & Local End-to-End Setup

> Phase goal: bring one host online against a real Cloudflare Worker + D1,
> so the Dashboard (running locally) can render real data.

## Current layout

| Component | Location | Environment |
|---|---|---|
| Worker | `https://steed.<subdomain>.workers.dev` | Cloudflare (prod) |
| D1 database `steed` | region APAC | Cloudflare (prod) |
| Dashboard | `https://steed.dev.hexly.ai` (local Caddy → 127.0.0.1 → `bun run dev`, port 7035) | local |
| Host CLI / Service | this machine | local |
| L2 E2E tests | `wrangler dev --local --persist-to .wrangler/state/e2e` | local-only, isolated |

The Dashboard's server code proxies every call to the prod Worker using
`DASHBOARD_SERVICE_TOKEN`; the browser never carries Worker credentials.

## One-time deployment (done for `steed.nocoo.workers.dev`)

```bash
# 1. Create the prod D1
wrangler d1 create steed
#   → write the returned database_id into packages/worker/wrangler.toml

# 2. Apply migrations (includes lane seed data)
cd packages/worker
wrangler d1 migrations apply DB --remote

# 3. Generate and publish the dashboard service token
TOKEN=$(openssl rand -base64 32)
echo "$TOKEN" | wrangler secret put DASHBOARD_SERVICE_TOKEN
#   → put the same $TOKEN into packages/dashboard/.env.local

# 4. Deploy
wrangler deploy

# 5. Smoke-test
curl https://steed.<subdomain>.workers.dev/api/v1/health
```

## Registering a new host

The Worker's `POST /api/v1/hosts/register` endpoint requires the dashboard
role. Until the Dashboard gains a "Register host" UI, admins curl directly
with the dashboard service token:

```bash
curl -X POST https://steed.<subdomain>.workers.dev/api/v1/hosts/register \
  -H "Authorization: Bearer $DASHBOARD_SERVICE_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"name\":\"$(hostname -s)\"}"
# → { "id": "host_...", "name": "...", "api_key": "sk_host_..." }
```

Write the returned `api_key` into the host's `~/.steed/config.json` under
`api_key`. The key is shown only once.

## Host CLI configuration

`~/.steed/config.json` (must be `chmod 600`):

```json
{
  "worker_url": "https://steed.<subdomain>.workers.dev",
  "api_key": "sk_host_...",
  "agents": [],
  "data_sources": {
    "cli_scanners": [...],
    "mcp_scanners": []
  }
}
```

Until the CLI is published to npm, invoke it via source:

```bash
cd <repo>
bun packages/cli/src/bin/steed.ts scan      # show local detection
bun packages/cli/src/bin/steed.ts report    # upload one snapshot
bun packages/cli/src/bin/steed.ts status    # local service state
```

## Running the Dashboard locally

```bash
bun run dev    # next dev --port 7035
```

Then open `https://steed.dev.hexly.ai` (Caddy terminates TLS and proxies to
127.0.0.1:7035; the dev domain is configured to resolve locally). Google
OAuth signs you in against the `ADMIN_EMAILS` allow-list.

## L2 E2E tests

E2E uses `wrangler dev --local --persist-to .wrangler/state/e2e` with an
in-process D1, so it never touches the prod database:

```bash
bun run test:e2e
```

## Railway Deployment (Dashboard)

Dashboard deploys to Railway using a multi-stage Dockerfile. Key lessons learned:

### 1. Must use Dockerfile builder, not Nixpacks/Railpack

Railway's auto-detect (Railpack) doesn't handle bun workspaces correctly — it runs `npm install` which fails on `workspace:*` protocol. Force Dockerfile:

```bash
railway environment edit --json <<'JSON'
{"services":{"<service-id>":{"source":{"rootDirectory":""},"build":{"builder":"DOCKERFILE","dockerfilePath":"Dockerfile"}}}}
JSON
```

**Critical**: `rootDirectory` must be empty string `""` (not `null`), otherwise Railway looks for Dockerfile in the wrong place.

### 2. Next.js standalone mode requires node, not next start

```dockerfile
# Wrong — fails with "next start does not work with output: standalone"
CMD ["bun", "run", "start"]

# Correct — use node directly
CMD ["node", "packages/dashboard/server.js"]
```

### 3. Build-time env vars needed for Next.js

Next.js reads env vars at build time for static page generation. Pass them via Docker ARG:

```dockerfile
ARG WORKER_API_URL
ARG DASHBOARD_SERVICE_TOKEN
ENV WORKER_API_URL=$WORKER_API_URL
ENV DASHBOARD_SERVICE_TOKEN=$DASHBOARD_SERVICE_TOKEN
# ... then RUN next build
```

Railway automatically passes service env vars as Docker build args.

### 4. All workspace packages must be in Dockerfile

Even if you only build one package, bun.lock references all workspace packages. Include all `package.json` files:

```dockerfile
COPY packages/shared/package.json packages/shared/
COPY packages/dashboard/package.json packages/dashboard/
COPY packages/cli/package.json packages/cli/
COPY packages/worker/package.json packages/worker/
RUN bun install --frozen-lockfile --ignore-scripts
```

### 5. Don't copy non-existent directories

If `public/` doesn't exist, Docker build fails. Only copy what exists:

```dockerfile
COPY --from=builder /app/packages/dashboard/.next/standalone ./
COPY --from=builder /app/packages/dashboard/.next/static ./packages/dashboard/.next/static
# Skip public/ if it doesn't exist
```

### Current Dockerfile (reference: pew project)

```dockerfile
FROM oven/bun:1 AS base

FROM base AS deps
WORKDIR /app
COPY package.json bun.lock ./
COPY packages/shared/package.json packages/shared/
COPY packages/dashboard/package.json packages/dashboard/
COPY packages/cli/package.json packages/cli/
COPY packages/worker/package.json packages/worker/
RUN bun install --frozen-lockfile --ignore-scripts

FROM base AS builder
WORKDIR /app
ARG WORKER_API_URL
ARG DASHBOARD_SERVICE_TOKEN
# ... other build-time vars
ENV WORKER_API_URL=$WORKER_API_URL
ENV DASHBOARD_SERVICE_TOKEN=$DASHBOARD_SERVICE_TOKEN
COPY --from=deps /app ./
COPY . .
RUN bun run --filter @steed/shared build 2>/dev/null || true
RUN bun run --filter @steed/dashboard build

FROM node:22-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/packages/dashboard/.next/standalone ./
COPY --from=builder /app/packages/dashboard/.next/static ./packages/dashboard/.next/static
EXPOSE 3000
CMD ["node", "packages/dashboard/server.js"]
```

## Notes

- `wrangler.toml` contains only the prod D1 binding. Do not add a remote
  test database — E2E's local-persist covers that role.
- `DASHBOARD_SERVICE_TOKEN` lives in two places that must match: Worker
  secret (via `wrangler secret put`) and `packages/dashboard/.env.local`.
- D1 `database_id` is not a secret; `api_key` and `DASHBOARD_SERVICE_TOKEN`
  are. `.dev.vars` and `.env.local` are both gitignored.
