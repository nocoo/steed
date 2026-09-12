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
