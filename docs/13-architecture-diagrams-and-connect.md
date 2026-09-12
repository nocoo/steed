# 13 — Architecture diagrams and Connect

## Intent and sequence

Steed must let an agent author and maintain complex architecture diagrams. The
existing lane map only projects Host → Agent → Data Source inventory; it cannot
represent arbitrary services, infrastructure boundaries, or cross-provider paths.
Add a first-class Diagrams workspace without repurposing inventory records.

Work in this order: integrate the sidebar identity, implement and prove the
diagram workspace against the supplied network document in local development,
then expose that proven model through Connect. The local network data and browser
captures stay under ignored `.wrangler/` storage. Do not seed production or modify
the reference repositories. This work does not bump the version or push a release.

## References

- `apps/web/src/components/layout/app-sidebar.tsx`: Basalt sidebar and footer.
- `apps/web/worker/access-jwt.ts`: verified Access identity and loopback-only dev
  bypass. New browser routes reuse this verification.
- `../surety/apps/worker/src/lib/author-profile.ts` and its `/api/me` route:
  normalize the verified email, SHA-256 it, and query
  `https://lizheng.blog/api/authors/profile?hash=…` with a short timeout.
- `apps/web/src/components/map/` and `packages/api/src/shared/lane-map.ts`:
  existing React Flow dependency and the fixed inventory projection.
- `/Users/nocoo/workspace/references/archify/archify/schemas/architecture.schema.json`
  and `examples/production-deployment.architecture.json`: typed graph source,
  boundaries, authored views, labeled paths, and explicit evidence. Reference
  concepts; do not vendor its renderer or change its repository.
- `/Users/nocoo/Downloads/云端服务连接架构.md`: private local acceptance dataset,
  including the complete resource inventory and explicitly inferred bindings.
- `../bat/docs/22-connect.md`, `packages/ui/src/routes/connect.tsx`, and
  `packages/worker/src/{domain,middleware,routes}/*connect*`: credential lifecycle,
  scoped API discovery, concurrency, retry safety, and management UX.
- `apps/web/worker/index.ts`, `packages/worker/migrations/`, and
  `scripts/run-e2e.ts`: active SPA Worker, shared D1 schema, and isolated HTTP tests.

## Sidebar identity

Serve `/api/me` only after Access verification. Return the verified email and a
normalized profile; never accept an email supplied by the browser as identity.
Only the email hash goes to the fixed profile endpoint. Bound the response and
timeout; malformed or unavailable profiles fall back to the email name/initial.
Render the shared Basalt Avatar in both sidebar sizes, with name/email in the
expanded footer. Keep the version badge in the header.

## Diagram model and workspace

Use a versioned, strictly validated JSON document: title/description, stable node
and edge IDs, typed nodes, nested boundary groups, positions, labeled directed
edges, evidence (`documented` or `inferred`), and named views. Views select authored
nodes; filtering and reach traversal must never invent relationships. Validate
unique IDs, references, group cycles, finite geometry, URL protocols, and explicit
resource/body limits at every write boundary.

Persist each document in D1 with a revision. A conditional write against the
previous revision prevents browser or agent edits from overwriting unseen changes.
Keep the last valid document visible when an import fails. Graph edits are one
atomic document update; an invalid operation batch changes nothing.

Use the existing React Flow and Basalt packages. The workspace supports multiple
diagrams, create/import/export, editing nodes/edges/groups/views, saved positions,
zoom/pan/minimap, search, boundary collapse, named views, and upstream/downstream
inspection. Keep full inventory accessible even when the initial view is a smaller
overview. A JSON editor/import is also a precise authoring surface for agents.
JSON export round-trips the complete source, independently of the active view.

The local acceptance graph must account for every named Worker, D1, KV, R2,
Railway project, Docker/Vercel service, VPS and home endpoint in the source. Keep
uncertain placement/bindings as notes or inferred edges. Preserve the source's
monitoring counts and any inconsistencies rather than inventing omitted targets.
Prove both an overview and detailed service/observability paths in a real browser,
including persistence, navigation, search, and an edit/export/import round trip.

## Connect, after local diagram acceptance

Keep existing Host Service/CLI authentication separate. New diagram operations
use `/api/v1/diagrams`; authenticated discovery and OpenAPI describe only this
surface. Browser management lives under `/api/connect`, behind verified Access,
explicit manager authorization, and same-origin mutation checks.

Adapt Bat's read/write tokens to all diagrams or one canonical diagram. A bound
token cannot discover or change other diagrams. `write` includes `read`. Support
name, optional expiry, last use, repeat reveal, rotation, and revocation. Generate
256-bit credentials; store an authentication hash and AES-GCM ciphertext under a
versioned deployment secret, never plaintext. Reveal requires a short-lived,
single-use challenge. The UI clears revealed values after 30 seconds, blur,
navigation, or a target change, including delayed responses.

Expose diagram listing/detail, creation, replacement, deletion, node/edge/group/
view operations, validation, and complete JSON export. All mutating graph actions
share the same validation and conditional D1 write path as browser edits. Require
ETags and persisted idempotency keys for machine writes; use D1 transactions and
conditional updates rather than Bat's cross-product coordination infrastructure.
Return structured errors, request IDs, bounded pagination, rate limits, and
metadata-only audit records. Document precise operation limits and retry behavior.
Bearer tokens cannot manage credentials or operate the legacy asset endpoints.

Production enablement requires reviewed manager/keyring configuration and precise
Access bypass paths for the new Bearer routes. Local verification must not change
Access policy or deploy private acceptance data.

## Atomic commit plan

1. `docs: plan diagrams and connect` — this design and document index.
2. `feat: show the signed-in sidebar profile` — profile endpoint, avatar, and
   focused auth/failure/render tests.
3. `feat: add structured architecture diagrams` — validated graph document,
   persistence, editor/viewer, isolated HTTP/browser proof, and updated navigation.
4. `feat: add scoped diagram connections` — Connect tokens, API contract,
   operations, management UI, and security/concurrency/lifecycle verification.
5. `docs: record local architecture verification` — measured acceptance evidence
   and reproducible local usage, without private dataset contents.

Each logical commit passes mandatory hooks. Run relevant strict typechecks,
coverage gates, build, real isolated-D1 HTTP tests, and local Playwright flows.
Only proceed to Connect after the complex-network browser proof succeeds.

## Initial review

- Clean `main` at `2142decb879367ed84f9ecc0feeb371800706b6e`; v0.2.0 is already
  released. No uncommitted changes were present before this work.
- Do not replace the active SPA Worker with the historical standalone Worker.
- Reference repositories and the Downloads source are read-only inputs.
- A new local server must use an available port and a dedicated D1 persistence
  directory; never reset existing local databases or stop unknown processes.

## Diagram acceptance, 2026-09-12

The local reconstruction contains 279 components, 377 connections, 18 nested
boundaries and 14 named views. It accounts for all 41 Workers, 27 D1 databases,
11 KV namespaces, 10 R2 buckets, seven Railway projects and five VPS entries in
the source, alongside the named Docker, Vercel, home and monitoring inventory.
Fifty connections retain explicit inferred evidence. Source overview aggregates
are labeled separately from the individual resources. Kuma's headline says 74,
but its enumerated groups contain 67 targets; the seven unspecified targets are
not fabricated. Public status contains the source's 28 checks.

The local diagram is available at
`http://127.0.0.1:24680/diagrams/cloud-services-20260912`, using an isolated local
D1 database at `apps/web/.wrangler/state/architecture`. The private source-derived
JSON, generator and browser evidence stay in ignored
`.wrangler/architecture-proof-5nn5vq9g/`. No acceptance data was sent to production.
The committed `examples/service-platform.json` is a separate generic example.

Real Chrome checks exercised overview and service/monitoring views, the full
279-component graph, search, upstream/downstream traversal, collapsed boundaries,
mouse dragging, form edits, save/reload, invalid-source preservation, unsaved
navigation, and a complete export/import round trip. Mutating checks used a
separate imported copy and removed it afterwards. Dark mode and a 390-pixel
viewport were also checked; there were no uncaught page errors.

Visual inspection exposed labels covering paths and automatic routes crossing
unrelated nodes. The model now supports per-edge and per-view waypoints, port
directions and label positions. Views can hide boundaries; the minimap is optional,
and fit includes authored path geometry. Source replacement resets stale filters.
Node/edge deletion cleans view references. Navigation protection remains active
during a pending save, and conditional writes preserve conflicting drafts.

Validation uses strict TypeScript/ESLint, both existing coverage gates, the original
59 true-HTTP checks and 25 new checks in `scripts/run-diagram-e2e.ts`. The new runner
builds the active SPA Worker and uses its own temporary local D1 and ports. It
verifies concurrency, body and graph validation, same-origin protection, pagination,
tombstone behavior, and storage of 500 nodes with 1,999 edges. The normalized JSON
document is limited to 1 MiB so export remains importable; counts are capped at
500 nodes, 2,000 edges, 100 groups and 40 views.

This acceptance completes the diagram prerequisite for Connect. Production
remains v0.2.0; this work has not been pushed or deployed.

## Connect implementation contract

The machine surface is `/api/v1/diagrams` plus `/api/v1/capabilities`,
`/api/v1/openapi.json` and `/api/v1/requests/{key}`. Existing asset/host routes
continue using their existing authentication. The Connect operation manifest
drives both routing and OpenAPI discovery. GET/HEAD reads support stable-ID
pagination. Static Assets runs the Worker first for `/api/*`, including browser
navigations, so the SPA fallback cannot replace API responses or OpenAPI downloads.
PUT on a canonical diagram ID creates with `If-None-Match: *` or
replaces with `If-Match`; entity PUT replaces that node, edge, group or view.
POST `operations` applies at most 100 typed operations with one final graph
validation. Removing a boundary reparents its contents; removing a node or edge
cleans its derived references. POST `validate` does not persist a document.

Machine changes require a write token, an ETag/create precondition and a persisted
8–128 character `Idempotency-Key`. Deletes and batches containing removals also
require `X-Steed-Confirm: {diagramId}`. One D1 batch reserves the key, conditionally
writes the graph, and records the outcome/audit. It checks the active token again
inside the transaction. Retries return the original small mutation receipt, not
another copy of the diagram; GET reads the resulting source. An expired receipt
leaves a permanent key tombstone. No pending job or cross-service coordinator is
needed because every graph mutation is a single D1 transaction.

Management uses verified `email:{address}` or `subject:{sub}` principals explicitly
listed in `CONNECT_MANAGERS`; an Access login alone grants nothing. This personal
deployment has global managers and diagram-scoped credentials, without an extra
membership product. Only the existing loopback dev bypass can use
`local:developer`. Removing a manager invalidates its issued tokens on the next
request. A token bound to a deleted diagram can still inspect its own retry receipt
but cannot recreate the tombstoned ID. Management target discovery retains deleted
diagrams with issued tokens so their credentials can still be revoked after a page
reload; new credentials cannot target deleted diagrams. The UI creates metadata only and uses a
version-bound, single-use 60-second challenge for reveal, rotate and revoke.

`CONNECT_TOKEN_KEYS` is a versioned 32-byte base64url keyring. HKDF/AES-GCM binds
ciphertext to the deployment, token ID, target, scope, issuer and expiry. The
authentication fingerprint is deployment-bound SHA-256. Token names cannot contain
credential prefixes. There are at most 50 non-revoked tokens per target; D1 limits
each token to 120 reads or 30 writes per minute and each manager to 60 requests per
minute. Audit stores only operation/status/identity metadata. Expired confirmations,
rate windows, seven-day receipts and 90-day audit records are pruned when management
is loaded. Keys and local test configuration remain in ignored mode-0600 files.

## Connecting an agent

Open `/connect`, choose all diagrams or one existing diagram, and create a read or
write token. Creation shows metadata; use Reveal and type the token name to obtain
the credential. Put it in the agent's secret store. The page provides curl examples,
copyable agent instructions and an authenticated OpenAPI download. A write token
also grants read access. Expired tokens still occupy a slot until revoked.

The API base is `<origin>/api/v1`. Start with `GET /capabilities` and
`GET /openapi.json`. List diagrams, retain their canonical IDs, then read a complete
diagram and its ETag. `PUT /diagrams/{id}` imports complete source;
`POST /diagrams/{id}/operations` performs graph edits with one final validation.
The four entity collections are `nodes`, `edges`, `groups` and `views`; collection
GETs paginate, item GETs inspect, PUTs replace and DELETEs remove. Validation and
JSON export preserve named views, nested boundaries, layout geometry and evidence.

Persist the idempotency key before a mutation. If the connection drops, inspect
`GET /requests/{key}` and retry the exact request with that key. A 404 receipt
means no receipt was committed yet; reusing the original key is safe. On 412, read
the latest document and reconsider the edit under a new intent. Never reuse a key
for a different request. Receipts expire after seven days, but their key tombstones
remain and prevent a delayed retry from reapplying the edit. A revoked or expired
credential cannot read its receipts; managers can inspect activity separately.

## Local configuration and future enablement

The current local proof uses ports 24680 (Vite) and 24681 (the active SPA Worker),
with inspector port 24682. Its persistent D1 directory is
`apps/web/.wrangler/state/architecture`. Local Connect configuration lives in
`.wrangler/architecture-proof-5nn5vq9g/connect-dev.env`, is ignored and mode 0600,
and is passed through Wrangler's `--env-file` option. It contains an explicitly
local manager and a randomly generated keyring. Preserve that file across restarts.

For another local instance, create a fresh ignored env file without overwriting an
existing one. `CONNECT_MANAGERS=local:developer` applies only to the loopback dev
identity. `CONNECT_TOKEN_KEYS` must have this shape, with a newly generated
32-byte, unpadded base64url value replacing the placeholder:

```json
{"active":"local-1","keys":{"local-1":"<32-byte-base64url-key>"}}
```

From `apps/web`, build assets, apply migrations locally to the chosen persistence
directory, and start the same Worker configuration:

```sh
bun run build
bun x --no-install wrangler d1 migrations apply DB --env dev --local \
  --persist-to .wrangler/state/architecture
bun x --no-install wrangler dev --env dev --local \
  --env-file ../../.wrangler/architecture-proof-5nn5vq9g/connect-dev.env \
  --persist-to .wrangler/state/architecture \
  --ip 127.0.0.1 --port 24681 --inspector-port 24682
```

Use a second terminal in `apps/web` for Vite:

```sh
STEED_API_PROXY=http://127.0.0.1:24681 bun run dev \
  --host 127.0.0.1 --port 24680 --strictPort
```

Production enablement is a separate release. It needs migration `0005` and `0006`
on the production D1, a production-specific keyring, and explicitly authorized
`email:normalized@example.com` or `subject:verified-sub` manager principals.
Keep `/api/connect` and `/api/connect/*` behind Access. Machine clients must reach
the Bearer handler without an interactive Access login for these paths:

- `/api/v1/capabilities`
- `/api/v1/openapi.json`
- `/api/v1/diagrams` and `/api/v1/diagrams/*`
- `/api/v1/requests/*`

Review existing path rules before changing Access. This implementation did not
change any production Access policy, production secrets or production data.
Deploy the `apps/web` Worker; the historical `packages/worker` deploy target does
not serve the SPA.

When rotating the encryption keyring, retain old key versions while their tokens
need repeat reveal. New tokens and explicit token rotations use the active key.
Removing an encryption key version prevents reveal; token revocation removes its
authentication hash and ciphertext. Changing `CONNECT_DEPLOYMENT_ID` invalidates
all credentials from the previous deployment identity.

## Implementation review

- Metadata patches unwrap the description default before making it optional.
  Updating only a title must preserve existing notes.
- View geometry uses Map lookups for authored IDs. Valid names such as
  `constructor` and `valueOf` must not resolve to inherited JavaScript properties.
- Successful token mutations update visible metadata before closing the dialog,
  so keyboard focus can move to a usable control after revocation.
- HTTP DELETE checks actual bounded body bytes. Workerd can supply an empty
  stream for a bodyless request; stream presence alone must not reject deletion.
- `/api/*` uses selective `assets.run_worker_first`. A real browser download
  exposed the default SPA navigation fallback returning HTML for the OpenAPI URL.
  The HTTP regression includes `Sec-Fetch-Mode: navigate` and verifies both the
  attachment response and authentication on public-host requests.

The Static Assets setting was verified against Wrangler 4.100.0's installed
configuration schema and Cloudflare's current
[Worker script routing documentation](https://developers.cloudflare.com/workers/static-assets/routing/worker-script/)
on 2026-09-12. Binding types are generated in `apps/web/worker/bindings.d.ts`.
