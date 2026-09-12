# 15 — Local development through Caddy

## Design and review

The local entry point is `https://steed.dev.hexly.ai`. On 2026-09-12, nmem's
infrastructure record `25b22d6b-1df5-4491-ae4d-269a556f6442` and both the active
Caddyfile and its workflow copy confirmed Steed's existing port 7035 reservation.
The previous Vite process used 24680, leaving the Caddy domain returning 502.

Use Vite on loopback port 7035, the active `apps/web` Worker on 37035
(dev + 30000), and its inspector on 38035. nmem searches found no conflicting
reservation; IPv4 and IPv6 bind checks passed for all three ports. Record these
ports in nmem before starting them. Preserve the existing Caddy mapping,
certificates, other projects, and local architecture database/keyring.

The coordinated reservation is nmem memory
`b37cb56b-ab97-4fd1-8207-e9e1645acea8`.

`apps/web/vite.config.ts` must use a strict port, allow the exact dev hostname,
and preserve the browser Host when proxying `/api`. `apps/web/wrangler.toml`
must bind locally and forward the HTTPS request origin to the Worker even though
Caddy's internal transport is HTTP. Share the exact local-origin check between
`worker/access-jwt.ts` and `worker/connect.ts`: the explicit development bypass
may recognize the HTTPS Steed dev origin, alongside existing loopback addresses.
Production and unrelated hostnames must still require authentication. Keep the
same-origin mutation checks intact.

The web typecheck must exclude its Node-only `worker/__tests__` SQLite fixture,
just as it excludes test files; the runtime build does not include that fixture.

`CLAUDE.md` must require nmem lookup, Caddy/port checks, the dev-domain entry point,
and HTTP/browser verification for future local starts. Update the current README
and documents 13/14 so their startup instructions use the coordinated ports.
Historical screenshots and reports remain the evidence from their original runs.

## Atomic commit plan

One commit, `fix: use the coordinated local dev domain`, contains this plan,
the startup rules and current instructions, dev configuration, the shared local
origin check, and focused authentication regression coverage. Pass mandatory
hooks and the active web build. Do not push or deploy this local configuration.

## Verification plan

- Preserve the canonical architecture revision and normalized source hash.
- Restart only the two identified Steed processes using the existing ignored
  Connect env file and `apps/web/.wrangler/state/architecture` persistence.
- Verify trusted HTTPS through Caddy, HTTP redirection, the diagram workspace,
  the actual-network diagram, and Connect in a real browser, including a
  same-origin write on a temporary diagram and a rejected cross-origin request.
- Verify the exact dev-origin auth allowance, production rejection, and existing
  diagram/Connect isolated HTTP tests. Inspect the resulting diff and commit
  with the required hooks.

## Verified result, 2026-09-12

- The dev domain redirects HTTP to HTTPS (301); the workspace, actual network,
  Connect, health, identity, and browser API endpoints return 200 with successful
  TLS verification. An unrelated Host sent to Vite returns 403.
- Real Chrome renders all 279 components and connects Vite HMR through WSS.
  Connect loads the local manager and opens its form. A separate generic diagram
  was created, edited, saved, reloaded, and deleted through the HTTPS origin.
  Cross-origin writes remain rejected. No browser page errors occurred.
- Canonical architecture revision 4, its 279 nodes / 377 edges / 18 groups /
  14 views, and source SHA-256
  `12d82ba310a269a4ae1ba70e1cab40939f34630dbcfcecbd6870ff82f7538e0c`
  remain unchanged. No credentials were created; both temporary smoke diagrams
  were removed using their last verified revisions.
- Focused Access/Connect regression tests: 37 passed. The active web typecheck
  passed after excluding the Node-only test fixture. Full HTTP regressions:
  108 passed (59 legacy, 25 diagrams, 24 Connect), including SPA builds.
- Private evidence is in `.wrangler/architecture-proof-5nn5vq9g/`:
  `caddy-before.json`, `caddy-smoke.json`, and `caddy-e2e.log`.
  Chrome and system curl trusted the existing certificate. Playwright's separate
  Node HTTP client needed the existing public mkcert CA via process-local
  `NODE_EXTRA_CA_CERTS`; no certificate or trust-store changes were made.

Only the identified Steed processes were restarted. The original temporary ports
are no longer listening; 7035, 37035, and 38035 are bound on loopback. Existing
Caddy configuration, other repositories, local D1, and the Connect keyring were
preserved.
