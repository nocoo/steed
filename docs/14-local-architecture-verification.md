# 14 — Local architecture and Connect verification

Verified on 2026-09-12. The implementation follows
[the design and operating instructions](13-architecture-diagrams-and-connect.md):
sidebar identity first, complex-diagram acceptance second, then Connect.

## Result and local entry points

The development workspace can author complex architecture documents and let an
agent maintain them through scoped Bearer credentials. Inventory pages remain
available. The application version remains 0.2.0 with Basalt 2.1.7; this feature
work has not been pushed or deployed to production.

- [Actual network diagram](https://steed.dev.hexly.ai/diagrams/cloud-services-20260912)
- [Diagram workspace](https://steed.dev.hexly.ai/diagrams)
- [Connect management](https://steed.dev.hexly.ai/connect)
- Machine API base: `https://steed.dev.hexly.ai/api/v1`

The Caddy domain proxies Vite on 7035, which proxies the active SPA Worker on
37035. [Document 15](15-local-dev-domain.md) records the correction from the
temporary proof ports and its separate domain verification. Data persists in
`apps/web/.wrangler/state/architecture`. The existing local servers are left
available for review. Test credentials were revoked; create a new token in Connect
for ongoing use.

The sidebar now resolves the verified Access identity through lizheng.blog's
author-profile service, with bounded requests, validated avatar URLs and initials
on failure. Local dev uses `dev@local` and therefore displays the fallback avatar.
The real signed-in account's photo was not exercised in this local environment.

## Architecture acceptance

The private source was `/Users/nocoo/Downloads/云端服务连接架构.md`.
Surety, Bat and Archify were read-only references. Only Steed was modified.

| Measured inventory | Count |
| --- | ---: |
| Components | 279 |
| Connections | 377 |
| Nested boundaries | 18 |
| Named views | 14 |
| Explicitly inferred connections | 50 |
| Workers / D1 / KV / R2 | 41 / 27 / 11 / 10 |
| Railway projects / VPS entries | 7 / 5 |
| Enumerated Kuma targets / public status checks | 67 / 28 |

Kuma's source headline reports 74 targets, while its enumerated groups total 67.
The discrepancy is retained; no missing targets or undocumented bindings were
invented. Full source-derived data, including layouts and route evidence, stays
in the ignored local proof directory. `examples/service-platform.json` is a
separate generic document suitable for sharing.

Chrome verification exercised overview, detailed service, storage and monitoring
views; the full 279-node graph; search and directed traversal; boundary collapse;
dragging and form edits; save/reload; invalid-source preservation; unsaved-navigation
protection; and a complete JSON export/import round trip. Named views have their
own positions and edge routes. All edits used separate copies.

Connect then validated and imported the full actual-network document through real
Bearer HTTP, updated a component and title, replayed an intent without a second
write, and rejected a stale edit. The resulting diagram rendered in the browser.
After cleanup, the canonical document still had revision 4 and the same normalized
source SHA-256 before and after the Connect acceptance:

```text
12d82ba310a269a4ae1ba70e1cab40939f34630dbcfcecbd6870ff82f7538e0c
```

## Connect acceptance

All 26 machine operations were exercised against the active SPA Worker and a real,
isolated local D1. Coverage includes discovery/OpenAPI, diagram CRUD/export/
validation, node/edge/group/view operations, pagination and receipt lookup.

Real D1 checks verified concurrent identical retries, independent competing writes,
browser-versus-agent conflicts, invalid-batch preservation, expired receipt
tombstones, scoped authorization, rate limits and audit failure rollback. The
legacy Host API still accepts its existing service credential and rejects Connect
credentials. Browser navigation headers are explicitly covered so SPA fallback
cannot replace API authentication or the OpenAPI attachment.

The real browser exercised token creation with permission/expiry, name confirmation,
repeat reveal, explicit clipboard copying, renaming, rotation and revocation. A
rotated key failed immediately; its replacement worked. A bound read token could
read its diagram, could not write, and received 404 for another diagram. A deleted
target remained discoverable after reload so its token could be revoked by keyboard.

Keys disappeared after 30 actual seconds and after blur. A deliberately delayed
real reveal response arriving after blur and cancellation did not restore a key.
No key was written to browser storage or screenshots. Screenshots mask private
fields; automatic tracing and video were not used. Temporary credentials from all
acceptance attempts were revoked and their test diagrams deleted using revision
preconditions. Revoked metadata and diagram ID tombstones remain inspectable.

Additional Chrome checks verified the settled dark theme, a 390px token dialog,
Escape/focus restoration, scrolling to agent instructions, and the mobile sidebar
identity. There were no uncaught page errors in the completed runs.

## Validation results

| Check | Result |
| --- | --- |
| `bun run typecheck` | Passed, strict TypeScript |
| `bun run lint` | Passed, zero warnings |
| `bun run test` | 1,142 tests passed in 106 files |
| Root statement / branch / function / line coverage | 97.39% / 91.54% / 96.99% / 97.69% |
| `bun run --cwd apps/web coverage` | 419 tests passed in 53 files, including the active Worker |
| Web statement / branch / function / line coverage | 97.78% / 92.71% / 98.78% / 99.09% |
| `bun run test:e2e` | 108 HTTP checks: 59 legacy, 25 diagrams, 24 Connect |
| Active SPA build | Passed in the isolated HTTP runners |
| `gitleaks detect --source . --no-git --redact` | No leaks found |
| `osv-scanner --lockfile=bun.lock` | No issues under the existing repository policy; lockfile unchanged |
| Real Chrome | Diagram, Connect and supplemental visual reports completed without errors |

Existing coverage thresholds and mandatory hooks were preserved. Regression tests
cover title-only patches retaining descriptions, empty streamed DELETE bodies,
split UTF-8/slow bodies, authored IDs matching JavaScript prototype names, token
version/focus updates, and real navigation requests to API paths.

## Evidence and commits

Private evidence is under `.wrangler/architecture-proof-5nn5vq9g/`:

- `source-audit.json`, `network.json`, `browser-smoke.json` and diagram screenshots.
- `connect-browser-smoke.json`: ten completed workflow checks, cleanup outcomes,
  and the unchanged canonical revision/hash.
- `connect-visual-smoke.json`: four completed checks for settled theme and mobile
  interactions; `connect-dark-settled.png`, `connect-mobile-dialog.png`,
  `connect-mobile-instructions.png` and `connect-mobile-sidebar.png`.
- `connect-openapi.json`: a real authenticated browser download.
- `connect-browser-attempt-1.json` and `connect-browser-attempt-2.json`: earlier
  findings retained separately from the successful run. The first exposed SPA
  navigation fallback; the second exposed an ambiguous test selector for duplicate
  titles, corrected by selecting the canonical ID.

The implementation commits after the previously released v0.2.0 are:

| Commit | Purpose |
| --- | --- |
| `7484914` | Design and atomic commit plan |
| `359ffc6` | Verified sidebar identity and avatar fallback |
| `82192c5` | Structured architecture model, persistence and workspace |
| `6d471bd` | Connect tokens, API, UI and validation |

This verification record is a separate final documentation commit. Production
enablement and its required Access/secret configuration are described in document
13 and have not been performed by this change set.
