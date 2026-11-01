# 19 — Phase 1 (+2): topology model v2, normalized storage, read-only web, topology Connect

## Scope and decisions

Phase 1 replaces the per-diagram JSON documents with one canonical topology
stored in normalized D1 tables, defines data model v2 and its validation, and
makes the browser read-only. This document also decides how Phase 2
(topology-scoped Connect tokens and the topology machine API) is delivered.
The work starts from `main` at `72d2298` (v0.4.0, Phase 0 accepted and applied
to production on 2026-10-31). Implementation starts only after this document
is reviewed.

Inputs: the roadmap (sections 3, 7 Phase 1/2, 9 and 11, kept privately by the
requirements owner) and the requirements owner's Phase 1 brief.
Owner decisions (2026-10-31) that constrain this phase:

- One canonical topology (`main`); every existing diagram is deleted, not
  migrated. The roadmap's "convert diagrams to v2" step is therefore dropped.
- Layers are vendors or providers (Cloudflare, each VPS provider, Apple,
  NAS vendor, Microsoft, Tailscale, GitHub, Railway, Grok Bot, …), not
  functional tiers. Home, office and other locations are trust domains
  (boundaries).
- The browser is read-only. All structure is written by the topology owner
  agent through the Connect API.
- Satellite data is static specification only. No bat or other live
  monitoring dependency; nothing in this phase polls or stores live metrics.
- Production Access already bypasses `/api/live` and `/api/v1/*` (verified in
  document 18); the owner approved issuing a token to the topology owner.

Requirements owner constraints for this phase:

1. Layers by vendor or provider; locations as `trust`/`site` boundaries.
2. Host specification attributes live in `attrs` and render as satellite
   badges. Things that must be linked to other nodes (services, subdomains)
   are separate satellite nodes attached to the host by `parentId`. All
   attributes are static.
3. Capacity designed for 1000 nodes and 5000 edges.
4. Validation rejects attribute values that look like secrets.

### Phase 2 decision: deliver Phase 1 and Phase 2 in one PR

Phase 2 (token scopes `topology:read`/`topology:write` and the
`/api/v1/topology*` endpoints) is folded into the same PR and release
(`0.5.0`). Reasons:

1. **No writer otherwise.** A read-only browser plus Phase 1 storage without
   Phase 2 leaves the canonical topology with no supported write path. The
   only alternative is to keep the v1 `/api/v1/diagrams*` endpoints writing a
   table the new UI no longer reads, which is throwaway code with its own
   migration and tests.
2. **The token schema must change anyway.** `connect_tokens.diagram_id`
   references `diagrams(id)` and `connect_requests.diagram_id` is `NOT NULL`.
   Retiring `diagrams` forces the Connect table rebuild that Phase 2 needs.
3. **One code path.** The operations engine and the secret-like value
   detector are Phase 1 deliverables whose only production callers are the
   Phase 2 endpoints; write-path L2 tests can only exercise them through the
   machine API.
4. **One production window.** Connect tables are empty in production after
   `0008` (verified 2026-10-31 15:05 CST), so one backup, one deploy and one
   migration run cover both phases.

Size is controlled by commit order rather than PR count: the first commits
are pure Phase 1 (model, detector, engine, tables, store, read-only browser),
each green on its own; the Connect switch, revert and v1 removal follow. The
two acceptance checklists stay separate below, and the PR description maps
commits to phases.

## Current-state evidence

- Tables after `0008`: `diagrams` (empty), `connect_tokens`,
  `connect_confirmations`, `connect_requests`, `connect_rate_limits` (all
  empty), `connect_audit` (13 rows, kept), `d1_migrations` (0001–0008).
- v1 model: `packages/api/src/shared/diagram.ts` — `schemaVersion: 1` JSON
  document per row, 11 node kinds, 5 edge kinds, groups, views; limits 500
  nodes / 2000 edges / 1 MiB. Every write re-serializes the whole document.
- Connect: `packages/api/src/shared/connect.ts` (operation batch, 100 ops,
  operation registry), `apps/web/worker/connect*.ts` (Bearer auth, hashed
  tokens, AES-GCM ciphertext, reveal/rotate/revoke challenges, idempotency
  receipts, ETag, audit, rate limits). Write guards are SQL `WHERE` clauses
  inside one `db.batch()`; the test D1 helper runs batches in a transaction.
- Browser: `routes/diagrams.tsx` is an editor (new/import/delete diagram,
  node/edge dialogs, JSON source editor, drag to move, save).
  `routes/connect.tsx` binds tokens to one diagram or "all diagrams".
- Root coverage excludes `apps/web/worker/**` (gap carried from document 18).
- D1 limits that shape the design (Cloudflare docs, 2026-10-30): statement
  length 100 KB, 100 bound parameters per statement, 2 MB per string/row,
  1000 queries per Worker invocation on Workers Paid with one `db.batch()`
  counting as one query, 50 MB result size from 2026-11-04, six concurrent
  connections per invocation.

## Data model v2

Shared zod schemas live in `packages/api/src/shared/topology.ts`
(`schemaVersion: 2`). All objects are strict (unknown keys rejected). IDs use
`^[a-z0-9][a-z0-9_.-]{0,95}$` (lowercase, so IDs are stable keys for
`If-Match`, URLs and layout caches).

```text
Topology   schemaVersion: 2, title, description, revision (read-only),
           layers[], types[], boundaries[], nodes[], edges[], views[], provenance?
Layer      id, label, provider, order (int, unique), color?, icon?, url?,
           description, provenance?
TypeDef    id, label, defaultLayerId?, shape, icon?, color?, description,
           attrs: AttrDef[], provenance?   (badge template and validation)
AttrDef    key, label, valueType (string|number|boolean|enum|public_key|
           fingerprint|identifier), unit?,
           enumValues?, badge (bool), order, required (bool), provenance?
Boundary   id, label, kind (trust|site|network|account), parentId?,
           style?, description, provenance?
Node       id, type, label, layerId, boundaryIds[] (≤8), parentId?,
           role? (service|subresource; required iff parentId),
           lifecycle (active|planned|deprecated|retired, default active),
           url?, description, tags[] (≤20), attrs{} (≤32), style?, provenance?
Edge       id, source, target, kind, label, protocol?, port?,
           direction (uni|bi), evidence (documented|inferred), description,
           tags[], style?, provenance?
View       id, label, description, filter {layerIds[], typeIds[],
           boundaryIds[], tags[]}, focusLayerId?, pins {nodeId: {x,y}}, provenance?
```

- **Node kinds** become open `type` IDs that must reference a `TypeDef`, so
  the topology owner can add `vps`, `mac`, `nas`, `domain`, `subdomain`,
  `worker`, `d1`, `r2`, `durable-object`, `tailnet`, `repo`, `bot`, … without a
  release. Edge `kind` stays a closed enum: `traffic`, `dns`, `binding`,
  `deploy`, `auth`, `monitor`, `uses`, `tunnel`.
- **Layers by provider.** `layerId` is required on every node. `order` gives
  the lane order for Phase 3 layout. `provider` is a display name.
- **Boundaries** express home, office, tailnet, account and network trust
  domains. They nest (`parentId`, acyclic) and are independent of layers, so
  one boundary can span several provider layers. Nodes join boundaries
  through `boundaryIds`.
- **Satellite badges** come from `attrs`: a flat map of keys
  (`^[a-z][a-z0-9_]{0,47}$`) to a string (≤256), finite number, boolean, or an
  array of ≤16 strings. The node's `TypeDef.attrs` lists which keys are
  badges, their label, unit and order (for example `cpu` → `4C`,
  `memory_gb` → `8G`, `region` → `jp`). Keys missing from the TypeDef are
  allowed and shown only in the inspector. Declared keys must match
  `valueType`/`enumValues`; `required` keys must be present.
- **Allowlisted attr types.** `public_key`, `fingerprint` and `identifier`
  exist so that legitimately high-entropy, non-secret values can be stored.
  They have strict formats:
  - `public_key`: OpenSSH (`ssh-ed25519|ssh-rsa|ecdsa-sha2-nistp256|384|521
    <base64> [comment]`), age (`age1…`) or WireGuard (44-character base64).
  - `fingerprint`: `SHA256:<base64>`, `MD5:` colon-separated hex, or 40/64
    hex characters.
  - `identifier`: `^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$`, covering commit
    SHAs, ARNs, resource IDs and similar.

  The secret-scan exemption applies only to attrs whose key is declared in
  the node's TypeDef with one of these types. Even there, only the
  `high_entropy` rule is skipped: `private_key`, `known_prefix`, `jwt` and
  `url_credentials` still apply. The same value in an undeclared key, a
  label, a description, a tag or any other field is rejected as usual.
- **Satellite nodes** are ordinary nodes with `parentId` and `role`:
  `service` (for example a Docker service on a VPS) or `subresource` (for
  example a subdomain under a domain, or a port). They can be edge endpoints.
  The maximum depth is 2: host → satellite → sub-satellite. Examples:
  domain → subdomain, or VPS → Docker service → port or sub-service.
  - **Parent.** The parent exists, and the chain to the root host has at most
    two `parentId` hops. Parent cycles are rejected.
  - **Layer.** Every satellite's `layerId` equals its root host's. Any
    cross-layer relationship is an edge, never a parent link.
  - **Boundaries.** A satellite's `boundaryIds` are empty; it inherits the
    root host's.
  - **Edges.** There are no edges between a satellite and any of its
    ancestors (the attachment is implicit).
  - **DNS records** normally go in the subdomain's `attrs` (for example
    `dns_a`, `dns_cname`). Make one a node only when something must link to
    it.
- **Static only.** There is no `status`/health field. `lifecycle` is a
  declared state, not monitoring. Live metrics are out of scope until the
  owner decides otherwise.
- **Style** is a whitelist: `shape` (`rect|rounded|pill|hexagon|cylinder|
  diamond|circle|cloud`), `size` (`s|m|l`), `color`/`border.color`
  (`#rrggbb` or a palette token `^[a-z][a-z0-9-]{0,31}$`), `border.style`
  (`solid|dashed|dotted|double`), `border.width` (0–4), `icon` (icon key),
  edge `dash`, `width` (1–4), `animated`. Rendering of style is Phase 3; the
  fields are stored and validated now.
- **provenance** (`^[a-z][a-z0-9-]{0,31}$`, optional) marks who owns a record
  (for example `manual`, `cloudflare-sync`) for later automated syncs.
- **Limits** (enforced; design target is 1000/5000 with 2× headroom):
  layers 64, types 128, boundaries 256, nodes 2000, edges 10 000, views 64,
  pins per view 2000, request body 4 MiB, operations per batch 1000.

### Validation rules

Applied to the whole resulting topology on every write (`superRefine`), each
failure returned with a JSON path and a stable code:

- unique IDs per collection; node and boundary IDs distinct;
- references exist: `node.type`, `node.layerId`, `node.boundaryIds`,
  `node.parentId`, `edge.source/target`, `type.defaultLayerId`,
  `boundary.parentId`, view filter IDs, `view.focusLayerId`, pin node IDs;
- boundary hierarchy acyclic; satellite rules above; no self-loop edges;
- layer `order` unique;
- attrs match their TypeDef declarations;
- every string passes the secret-like value detector (below);
- warnings (returned, not blocking): edge crossing a `trust` boundary without
  a description; duplicate `(source, target, kind)` edges; node with no edges
  and no parent.

### Secret-like value detection

`packages/api/src/shared/secret-scan.ts` exports a pure
`findSecretLike(value, path)` used by the schema for every string field:
labels, descriptions, tags, URLs, attr keys and values, edge labels,
protocol, style tokens and the topology title. It fails closed; the topology
is an attack map and must never carry credentials.

Rules, each with a stable rule id:

| Rule id | Rejects |
|---|---|
| `key_name` | attr keys containing `password`, `passwd`, `passphrase`, `secret`, `token`, `apikey`/`api_key`, `private_key`, `credential`, `cookie`, `session`, `mnemonic`, `otp` |
| `private_key` | `-----BEGIN … PRIVATE KEY-----` blocks (any type) |
| `known_prefix` | known credential formats: `steedc_…`, GitHub `ghp_/gho_/ghu_/ghs_/ghr_/github_pat_`, `sk-…`/`sk_live_`/`rk_live_`, Slack `xox[abprs]-`, AWS `AKIA/ASIA` + 16, Google `AIza` + 35, `ya29.`, GitLab `glpat-`, npm `npm_` + 36, Tailscale `tskey-` |
| `jwt` | three base64url segments starting `eyJ` |
| `url_credentials` | URLs or connection strings with userinfo (`scheme://user:pass@`), and query parameters named like `token`, `key`, `secret`, `sig`, `signature`, `password`, `auth` |
| `high_entropy` | any whitespace-free run of ≥24 characters with Shannon entropy ≥4.0 bits/char and ≥3 character classes, or pure hex ≥40 characters, or base64 ≥40 characters |

Allowed explicitly (checked before `high_entropy`): IPv4/IPv6 and CIDR,
UUIDs, 32-character hex IDs (Cloudflare account/zone/database IDs), DNS
names, plain URLs without credentials, semver, ISO dates and numbers.
Public keys, fingerprints and commit SHAs are rejected by `high_entropy` unless
they sit in a TypeDef-declared attr of type `public_key`, `fingerprint` or
`identifier` and match that type's format (see allowlisted attr types).

Errors are `422 invalid_topology` with issues
`{ path, code: "secret_like_value", rule }`. The value is never echoed in
the response, the audit log, the change log or Worker logs, and a rejected
request stores no idempotency receipt body beyond the error. Test fixtures
are built at runtime (string concatenation) so gitleaks never sees a
literal credential in the repository.

## Storage: normalized tables and indexes

Migration `0009_create_topology.sql`:

```sql
CREATE TABLE topology_meta (
  id TEXT PRIMARY KEY CHECK (id = 'main'),
  title TEXT NOT NULL, description TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision >= 0),
  request_id TEXT, updated_at TEXT NOT NULL
);
INSERT INTO topology_meta VALUES ('main', 'Steed topology', '', 0, NULL, '1970-01-01T00:00:00.000Z');

CREATE TABLE topo_layers (
  id TEXT PRIMARY KEY, label TEXT NOT NULL, provider TEXT NOT NULL,
  sort_order INTEGER NOT NULL UNIQUE, color TEXT, icon TEXT, url TEXT,
  description TEXT NOT NULL, updated_rev INTEGER NOT NULL
);
CREATE TABLE topo_types (
  id TEXT PRIMARY KEY, label TEXT NOT NULL,
  default_layer_id TEXT REFERENCES topo_layers(id),
  shape TEXT NOT NULL, icon TEXT, color TEXT, description TEXT NOT NULL,
  attrs_schema TEXT NOT NULL CHECK (json_valid(attrs_schema)),
  updated_rev INTEGER NOT NULL
);
CREATE TABLE topo_boundaries (
  id TEXT PRIMARY KEY, label TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('trust','site','network','account')),
  parent_id TEXT REFERENCES topo_boundaries(id),
  style TEXT CHECK (style IS NULL OR json_valid(style)),
  description TEXT NOT NULL, updated_rev INTEGER NOT NULL
);
CREATE TABLE topo_nodes (
  id TEXT PRIMARY KEY, type_id TEXT NOT NULL REFERENCES topo_types(id),
  label TEXT NOT NULL, layer_id TEXT NOT NULL REFERENCES topo_layers(id),
  parent_id TEXT REFERENCES topo_nodes(id),
  role TEXT CHECK (role IN ('service','subresource')),
  lifecycle TEXT NOT NULL, url TEXT, description TEXT NOT NULL,
  tags TEXT NOT NULL CHECK (json_valid(tags)),
  attrs TEXT NOT NULL CHECK (json_valid(attrs)),
  style TEXT CHECK (style IS NULL OR json_valid(style)), provenance TEXT,
  updated_rev INTEGER NOT NULL,
  CHECK ((parent_id IS NULL) = (role IS NULL))
);
CREATE TABLE topo_node_boundaries (
  node_id TEXT NOT NULL REFERENCES topo_nodes(id) ON DELETE CASCADE,
  boundary_id TEXT NOT NULL REFERENCES topo_boundaries(id),
  PRIMARY KEY (node_id, boundary_id)
) WITHOUT ROWID;
CREATE TABLE topo_edges (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES topo_nodes(id),
  target_id TEXT NOT NULL REFERENCES topo_nodes(id),
  kind TEXT NOT NULL, label TEXT NOT NULL, protocol TEXT,
  port INTEGER CHECK (port IS NULL OR port BETWEEN 1 AND 65535),
  direction TEXT NOT NULL CHECK (direction IN ('uni','bi')),
  evidence TEXT NOT NULL CHECK (evidence IN ('documented','inferred')),
  description TEXT NOT NULL, tags TEXT NOT NULL CHECK (json_valid(tags)),
  style TEXT CHECK (style IS NULL OR json_valid(style)), provenance TEXT,
  updated_rev INTEGER NOT NULL, CHECK (source_id <> target_id)
);
CREATE TABLE topo_views (
  id TEXT PRIMARY KEY, label TEXT NOT NULL, description TEXT NOT NULL,
  filter TEXT NOT NULL CHECK (json_valid(filter)),
  focus_layer_id TEXT REFERENCES topo_layers(id),
  pins TEXT NOT NULL CHECK (json_valid(pins)), updated_rev INTEGER NOT NULL
);
CREATE TABLE topo_changes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  revision INTEGER NOT NULL UNIQUE, request_id TEXT NOT NULL UNIQUE,
  actor TEXT NOT NULL, token_id TEXT, provenance TEXT,
  kind TEXT NOT NULL CHECK (kind IN ('operations','replace','revert')),
  reverts_change_id INTEGER REFERENCES topo_changes(id),
  summary TEXT NOT NULL CHECK (json_valid(summary)), created_at INTEGER NOT NULL
);
CREATE TABLE topo_change_items (
  change_id INTEGER NOT NULL REFERENCES topo_changes(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL, collection TEXT NOT NULL, entity_id TEXT NOT NULL,
  PRIMARY KEY (change_id, seq)
);
CREATE TABLE topo_change_images (
  change_id INTEGER NOT NULL, seq INTEGER NOT NULL,
  side TEXT NOT NULL CHECK (side IN ('before','after')),
  image_json TEXT NOT NULL CHECK (json_valid(image_json)),
  PRIMARY KEY (change_id, seq, side),
  FOREIGN KEY (change_id, seq) REFERENCES topo_change_items(change_id, seq) ON DELETE CASCADE
) WITHOUT ROWID;

CREATE INDEX idx_topo_nodes_layer ON topo_nodes(layer_id, id);
CREATE INDEX idx_topo_nodes_type ON topo_nodes(type_id, id);
CREATE INDEX idx_topo_nodes_parent ON topo_nodes(parent_id) WHERE parent_id IS NOT NULL;
CREATE INDEX idx_topo_node_boundaries_boundary ON topo_node_boundaries(boundary_id, node_id);
CREATE INDEX idx_topo_boundaries_parent ON topo_boundaries(parent_id) WHERE parent_id IS NOT NULL;
CREATE INDEX idx_topo_types_layer ON topo_types(default_layer_id) WHERE default_layer_id IS NOT NULL;
CREATE INDEX idx_topo_views_focus ON topo_views(focus_layer_id) WHERE focus_layer_id IS NOT NULL;
CREATE INDEX idx_topo_edges_source ON topo_edges(source_id, id);
CREATE INDEX idx_topo_edges_target ON topo_edges(target_id, id);
CREATE INDEX idx_topo_edges_kind ON topo_edges(kind, id);
CREATE INDEX idx_topo_change_items_entity ON topo_change_items(collection, entity_id, change_id);
CREATE INDEX idx_topo_changes_created ON topo_changes(created_at);
```

- Everything that other records reference (layers, types, boundaries,
  parents, edge endpoints, boundary membership) is a column or join row with
  a foreign key, so D1 enforces integrity in addition to the schema. Value
  objects that nothing references (`tags`, `attrs`, `style`, view `filter`
  and `pins`, type `attrs_schema`) stay JSON columns; tag filtering uses
  `json_each` over at most 2000 nodes.
- Every foreign key has an index on the referencing column (SQLite scans the
  child table on parent deletes otherwise).
- `updated_rev` records the revision that last changed a row; it powers
  `?since=<rev>` incremental reads and history lookups.
- `topology_meta.revision` is the single counter; the ETag is
  `"topology:<revision>"`.

Migration `0010_rebuild_connect_for_topology.sql` (Phase 2 part; Connect
tables are empty in production, see the runbook precondition):

- drop `connect_requests`, `connect_confirmations`, `connect_tokens`
  (child-first);
- recreate `connect_tokens` without `diagram_id`, with
  `scope CHECK (scope IN ('topology:read','topology:write'))` and the
  existing hash, ciphertext, owner, version, expiry and revocation columns;
  recreate `connect_confirmations` unchanged; recreate `connect_requests`
  without `diagram_id`;
- `ALTER TABLE connect_audit RENAME COLUMN diagram_id TO target` (13 rows
  kept; new rows write `topology`); the existing index follows the rename.

Migration `0011_drop_diagrams.sql`: `DROP TABLE IF EXISTS diagrams` once no
code reads it (last code commit).

### Write path

1. Parse the request (operations batch, single-entity PUT/DELETE, or full
   replace) and check `If-Match`, `Idempotency-Key` and confirmation headers
   as today.
2. Load the current topology in one `db.batch()` of seven `SELECT`s (meta +
   six collections + memberships), explicit columns only.
3. Apply operations in memory and validate the whole result with the v2
   schema (references, cycles, satellites, attrs, secret scan).
4. Diff old and new per entity (canonical JSON compare). Only changed rows
   are written.
5. Write in one `db.batch()` (one D1 transaction, one query against the
   invocation limit):
   - `UPDATE topology_meta SET revision = revision + 1, request_id = ?,
     updated_at = ? WHERE id = 'main' AND revision = ?`;
   - every following statement carries the guard
     `WHERE (SELECT request_id FROM topology_meta WHERE id = 'main') = ?`, so
     a lost race changes nothing (same pattern as the current guard clauses);
   - deletes child-first (edges, memberships, satellites, nodes, views,
     boundaries, types, layers), then upserts parent-first;
   - bulk statements bind one JSON array and expand it with `json_each`
     (`INSERT … SELECT … FROM json_each(?) ON CONFLICT(id) DO UPDATE …`),
     chunked so each bound string stays under 1 MB and each statement under
     the 100 KB SQL length limit, with at most a few bound parameters;
   - `topo_changes` row plus chunked `topo_change_items` and separate
     `topo_change_images` (before/after images) for history and revert;
   - idempotency receipt and audit row, as today.
6. Return a receipt `{ revision, counts, changed: {collection: n}, warnings }`
   with the new ETag.

Full replace (`PUT /api/v1/topology`) uses the same diff, so re-sending an
unchanged topology writes only the meta row and an empty change.

History retention: keep the most recent 500 changes and anything newer than
90 days; pruning runs with the existing `pruneConnect` sweep.

## API shape

Common: JSON responses `{ data, requestId }`; errors
`{ error: { code, message, issues?, requestId } }`. ETag
`"topology:<revision>"` (history paging: `"topology-changes:<revision>:<oldest_retained_revision>"`, decision 12); reads accept `If-None-Match` and return 304.

### Browser API (Cloudflare Access, read-only)

| Method | Path | Result |
|---|---|---|
| GET/HEAD | `/api/topology` | full snapshot + ETag; 304 on match |
| GET | `/api/topology/changes?cursor&limit` | change summaries (no item bodies) |
| other | `/api/topology*` | 405 with `Allow: GET, HEAD` |
| any | `/api/diagrams*` | removed → 404 |

`/api/connect*` management stays; token creation drops `diagramId` and takes
`scope: topology:read | topology:write`; `/api/connect/diagrams` is removed;
audit listing drops the diagram filter.

### Machine API (`/api/v1`, Connect Bearer)

| Method | Path | Scope | Notes |
|---|---|---|---|
| GET | `/capabilities`, `/openapi.json`, `/requests/{key}` | read | as today, regenerated for v2 |
| GET | `/topology` | read | full snapshot; `?since=<rev>` returns entities with `updated_rev > rev` plus deleted IDs from the change log; `rev` below `oldest_retained_revision - 1` or above the current revision → `410 resync_required`, malformed → `400 invalid_since` (decision 9) |
| GET | `/topology/{collection}` | read | `collection ∈ layers, types, boundaries, nodes, edges, views`; stable ID order, `cursor`, `limit ≤ 500`; nodes filter `layer`, `type`, `tag`, `boundary`, `parent`; edges filter `node`, `kind` |
| GET | `/topology/{collection}/{id}` | read | one entity + topology ETag |
| PUT | `/topology/{collection}/{id}` | write | upsert one entity |
| DELETE | `/topology/{collection}/{id}` | write | remove; dangerous |
| POST | `/topology/operations` | write | ≤1000 ops, atomic |
| PUT | `/topology` | write | full replace (sync style); dangerous when it removes entities |
| POST | `/topology/validate` | write | dry run of a full topology or an operations batch; returns issues, warnings and diff counts; never writes |
| GET | `/topology/changes`, `/topology/changes/{id}` | read | history with before/after items |
| POST | `/topology/changes/{id}/revert` | write | dangerous; see below |

Operations: `set_metadata`, `put_layer|type|boundary|node|edge|view`,
`remove_layer|type|boundary|node|edge|view`. Remove semantics:

- `remove_node` removes its edges; it fails with `node_has_satellites`
  unless `cascade: true`, which also removes the whole satellite subtree
  (satellites and sub-satellites) and their edges;
  view pins and filters referencing it are dropped.
- `remove_boundary` re-parents child boundaries to its parent and drops
  memberships (as `remove_group` does today).
- `remove_layer` and `remove_type` fail with `layer_in_use` / `type_in_use`
  while referenced.

Writes require `If-Match: "topology:<rev>"` (428 without, 412 on mismatch),
`Idempotency-Key` (428 without, 409 `idempotency_conflict` on reuse with a
different body) and, for dangerous requests, `X-Steed-Confirm: topology`
(428). Revert applies the stored before-images of one change as a new
`revert` change; it fails with 409 `revert_conflict` if any entity it touches
changed in a later revision, and it is re-validated like any write. Other
statuses: 400 malformed input, 401/403 auth and scope (unchanged rules), 404,
413 body over 4 MiB, 422 `invalid_topology` with `issues[]`, 429 rate limit.
Rate limits stay 120 reads and 30 writes per minute per token.

## Read-only web

- Routes: `/topology` shows the canonical topology (no list, no `:id`);
  `/topology/:id`, `/diagrams` and `/diagrams/:id` redirect to `/topology`.
  Sidebar unchanged (Topology, Connect).
- Removed: new/import/delete diagram, node and edge dialogs, JSON source
  editor, drag-to-save, Save button and the dirty-state logic. React Flow
  runs with `nodesDraggable`, `nodesConnectable` and `elementsSelectable`
  set for viewing only (select to inspect, no mutation).
- Kept and adapted: search, upstream/downstream trace
  (`lib/diagram-graph.ts` reach traversal, renamed `topology-graph`), JSON
  export download, revision and updated-at display.
- New `lib/topology-client.ts` (GET with ETag/304 cache) and
  `viewmodels/use-topology-viewmodel.ts`; filters for view, layer, type,
  boundary and tag applied client-side.
- Interim layout until Phase 3 (ELK): a deterministic pure function places
  layers as horizontal lanes in `order`, nodes inside a lane sorted by first
  boundary then ID on a fixed grid. Each host forms a composite block: its
  satellites sit in a column beside it, and each sub-satellite sits indented
  under its satellite. The satellite and its sub-satellites move as one block.
  Block size is computed before lanes are packed, so adding satellites never
  shifts other hosts' blocks into overlap. View pins move a whole block when
  set on a host, or a satellite block within its host. Boundaries appear as chips on nodes and as a
  filter; boundary frames are Phase 3.
- Satellite badges: the node card shows up to six badge attrs from its
  TypeDef (`label` + value + unit); the inspector lists all attrs, tags,
  boundaries, satellites, edges and `provenance` (labelled "Provenance").
- Inspector and empty state: an empty topology explains that structure is
  written through the Connect API and links to `/connect`.
- Connect page: no target picker; scope choice is "Topology read" or
  "Topology write"; copy updated.
- Rendering budget: default view shows all layers but uses React Flow
  `onlyRenderVisibleElements`; semantic zoom and aggregation are Phase 3.

## Capacity and performance

Design point: 1000 nodes (≈30% satellites), 5000 edges, 30 layers,
100 boundaries, 60 types, 20 views.

- Size estimate: node ≈600 B (attrs included), edge ≈250 B → snapshot
  ≈0.6 MB + 1.25 MB ≈ 2 MB JSON, ≈300 KB compressed on the wire. Hard caps
  (2000/10 000) keep the snapshot near 4 MB, far under the 50 MB result
  limit; no single row approaches 2 MB.
- Read: seven `SELECT`s in one batch, full table scans by primary key order;
  ≈6200 rows read per snapshot. 304 responses skip the body; the browser
  caches by ETag.
- Write: a 100-operation batch writes ≈100–300 rows. A full replace of the
  design point writes ≈6000 entity rows plus ≈6000 change items, expanded
  through `json_each` in ≈25 chunked statements inside one batch, well under
  the 1000-queries limit and within the 100 KB statement limit.
- CPU: whole-topology validation is linear (maps and sets); budget < 50 ms
  for the design point. Diffing is linear over IDs.
- Targets, measured by `scripts/bench-topology.ts` on local Wrangler D1 with a
  synthetic 1000/5000 dataset (p95 of 20 runs): snapshot read < 300 ms;
  100-operation write < 300 ms; validate < 300 ms; full replace < 1 s
  (decided). Incremental writes are < 300 ms. Production is spot-checked once after the topology owner's
  first bulk load.
- Row-billing check: a full snapshot read costs ≈6200 rows; even 10 000
  reads a month are ≈62 M rows, inside the Workers Paid allowance.

## Test plan

L1 (Vitest, root gate 95/90/95/95 unchanged):

- `secret-scan.test.ts`: every rule positive and negative, every allowlist
  class, path reporting, no value echo; fixtures assembled at runtime.
- `topology.test.ts`: every validation branch (duplicates, each reference
  type, boundary cycle, satellite depth 1/2 accepted and 3 rejected, parent
  cycle, layer/boundary/ancestor-edge rules, allowlisted attr types (format,
  exemption only when TypeDef-declared, rejection elsewhere),
  self-loop, layer order, attr type/enum/required, limits, strict keys,
  style whitelist, warnings).
- operations engine: each op, remove semantics (`cascade`, re-parenting,
  in-use failures), batch atomicity, diff output, revert inverse.
- store (in-memory SQLite helper): load, chunked bulk upsert/delete at chunk
  boundaries, guard makes a lost race a no-op, change items and pruning,
  `?since` reads.
- `migrations.test.ts`: 0001–0011 apply to empty and seeded databases;
  topology tables, indexes and seed row exist; Connect tables rebuilt with
  new scopes; `connect_audit` rows kept and column renamed; `diagrams` gone.
- worker routing, browser API (304, 405), management API without diagrams.
- web: client, viewmodel, interim layout (deterministic, lane order, no
  overlap, satellite and sub-satellite blocks contained and moved
  together), read-only page (no edit controls
  rendered), Connect page scopes, router redirects.
- coverage: count `apps/web/worker/**` in the root gate (gap from document
  18), excluding `bindings.d.ts` and test helpers.

L2 (real HTTP, local Wrangler, temporary D1, process-group cleanup):

- `scripts/run-topology-e2e.ts` replaces `run-diagram-e2e.ts`: browser
  `/api/topology` read, 304, 405 on writes, `/api/diagrams` 404.
- `scripts/run-connect-e2e.ts` rewritten: 100% of `/api/v1` operations from
  the registry, auth matrix (none, malformed, revoked, expired, read token
  writing, manager removed), 412/409/428/422 (including
  `secret_like_value`)/413, idempotent replay, full replace, revert and
  `revert_conflict`; asserts the registry and OpenAPI list match.
- Topology owner acceptance flow (roadmap Phase 2): build ≥7 layers and
  ≥200 nodes from zero through the API, then revert one change.

Capacity: `bun run bench:topology` (manual lane, results recorded in the PR).

L3: manual check on `https://steed.dev.hexly.ai` with a synthetic seeded
topology (no real IPs): read-only page, filters, inspector, badges, Connect
page. Playwright stays Phase 3.

G2 unchanged (OSV + gitleaks on pre-push and CI).

## Atomic commits

Every commit is one logical change, uses Conventional Commits with a
lowercase subject of at most 50 characters, and passes the pre-commit hook
(typecheck, lint, tests with coverage, coverage gate). The branch passes
pre-push (local HTTP E2E, OSV, gitleaks) before every push. Hooks are never
bypassed, no force-push, no autofix.

Phase 1:

1. `docs: add phase 1 topology model plan` — this document and the docs
   index, followed by `docs: resolve phase 1 open questions` (both already on
   the branch).
2. `feat(api): add secret-like value detector` — `shared/secret-scan.ts`,
   rules, allowlist and the format checkers for `public_key`, `fingerprint`
   and `identifier`, with the exemption hook (`high_entropy` only); tests.
3. `feat(api): add topology v2 schema` — `shared/topology.ts` (entities,
   limits, depth-2 satellite rules, attr types and the TypeDef-scoped
   exemption, validation, warnings) and tests.
4. `feat(api): add topology operations engine` — ops, remove semantics
   (subtree cascade over two satellite levels), diff, revert inverse with
   409 conflicts, tests.
5. `feat(db): add normalized topology tables` — `0009_create_topology.sql`
   and migration tests.
6. `feat(worker): add topology store` — load, diff writer with guarded
   chunked batch, change log, pruning, `since` reads, tests.
7. `feat(worker): serve read-only topology api` — `/api/topology` and
   `/changes`, routing, `run-topology-e2e.ts` added to `test:e2e`.
8. `feat(web): add topology client and viewmodel` — client with ETag
   cache, viewmodel, tests.
9. `feat(web): render read-only topology page` — page, interim lane
   layout with nested host/satellite/sub-satellite blocks, badges,
   inspector, filters, router redirects; tests.

Phase 2:

10. `feat(connect): move machine api to topology` —
    `0010_rebuild_connect_for_topology.sql`, scopes, operation registry and
    OpenAPI, `/api/v1/topology*` handlers, management without diagrams,
    Connect page scopes, `run-connect-e2e.ts` rewrite, tests.
11. `feat(connect): revert topology changes` — revert endpoint, conflict
    detection, unit and E2E cases.

Cleanup and release:

12. `refactor: remove v1 diagram model` — `shared/diagram.ts`,
    `diagram-store`, `diagram-api`, `routes/diagrams.tsx`, v1 client,
    `run-diagram-e2e.ts`, `examples/service-platform.json` (replaced by a
    synthetic `examples/topology-sample.json`), `0011_drop_diagrams.sql`.
13. `test: add topology capacity benchmark` — synthetic generator and
    `bench:topology` script.
14. `test: count worker code in root coverage` — include
    `apps/web/worker/**`, exclusions for generated types and helpers;
    thresholds unchanged.
15. `docs: update readme and agents for topology v2` — README (Chinese and
    English), `AGENTS.md` current plan, API and invariants.
16. `chore(release): bump version to 0.5.0` — manifests, version
    assertions, `CHANGELOG`.

Implementation path (jev-judge, 2026-10-31 about 15:10 CST, caller `repo-steed`):
one request per candidate path. Direct edit on the box and a cloud agent were
not supported; the herdr flow on an allocated Mac had the strongest support
(`proceed_inline` 0.54, information sufficient 0.75, high risk 0.10, request
`bb43c880-51a8-434c-9875-5393bdf44fb2`), but every gate returned `ask_user`
because confidence was below 0.70. Decided by the requirements owner
(2026-10-31): implementation goes through the herdr flow on a Mac allocated by
机器管家. One Codex controller works on the PR #104 branch. It picks its own
workers and runs a review loop at reasoning `xhigh`: implement, then review
until APPROVE, then rebase onto `origin/main` and re-review. All hooks stay
on. There is no production deploy or release from the controller; the repo
steward runs the production steps after merge.

## Risks

- PR size: mitigated by phase-ordered commits, each green, and per-phase
  acceptance lists; the PR description maps commits to phases.
- Coverage: adding `apps/web/worker/**` to the root gate may need extra
  worker tests; it is its own commit and can be split out if it blocks.
- Secret detection false positives (long IDs, public keys): fail closed, with
  stable rule ids so the topology owner can see why and the allowlist can be
  extended in a reviewed change.
- Interim layout looks plain until Phase 3; it is deterministic and never
  scatters nodes.
- Production migration `0010` drops Connect tables; it must run only while
  they are empty (runbook precondition) and after a backup.

## Acceptance checklist

Phase 1:

- [ ] Gates green on every commit; `bun run test:e2e`, OSV and gitleaks clean;
      CI green.
- [ ] Schema and detector tests cover every validation branch and rule.
- [ ] Migrations `0009`–`0011` apply cleanly to empty and seeded local D1.
- [ ] Benchmark meets the targets on 1000 nodes / 5000 edges.
- [ ] Browser shows the canonical topology read-only; no edit controls; old
      routes redirect; `/api/topology` writes return 405.

Phase 2:

- [ ] `/api/v1` E2E covers every registered operation, the auth matrix and
      412/409/428/422/413.
- [ ] Secret-like values are rejected with rule ids and never echoed.
- [ ] Topology owner builds ≥7 layers and ≥200 nodes from zero and reverts
      one change (local, then production with real data).
- [ ] Production `/api/live` returns `0.5.0`; `/api/v1/capabilities` 401
      without a token and 200 with the issued token.

## Post-merge production steps

Executed by the repo steward after merge and a green release run:

1. Back up production D1 to the private box path (SELECT dump, mode 600) and
   record a time-travel bookmark.
2. Precondition: `connect_tokens`, `connect_requests`,
   `connect_confirmations` and `diagrams` have 0 rows. If not, stop and ask
   the requirements owner (tokens issued in the meantime would be dropped).
3. Confirm `/api/live` reports `0.5.0` (the release workflow deploys first).
   Deploy-before-migrate leaves the topology API failing until step 4
   (tables missing), which is acceptable with no live users; run step 4
   immediately.
4. `bunx wrangler d1 migrations apply DB --env production --remote` from
   `apps/web` (0009–0011); verify tables, `topology_meta` revision 0,
   `connect_audit` rows kept.
5. Verify `/api/live`, `/api/v1/capabilities` 401, `/` 302 to Access, and the
   empty topology page behind Access.
6. The owner (a Connect manager) issues a `topology:write` token at
   `/connect` and hands it to the topology owner privately; no Access change
   is needed. Tag `v0.5.0` and publish the GitHub Release.

`CONNECT_MANAGERS` is a production Worker secret (`wrangler secret put
CONNECT_MANAGERS --env production`). Its value is a comma-separated list
whose entries are `email:<lowercase address>` or `subject:<Access sub>`.
Entries are trimmed and matched exactly against the verified Access JWT,
whose email is lowercased first; a bare email or a mixed-case entry never
matches and `/connect` answers `manager_required`. The secret cannot be read
back, so record who is listed whenever it changes.

## Decisions (requirements owner, 2026-10-31)

The former open questions, answered in order:

1. **Satellite depth 2.** host → satellite → sub-satellite (for example
   domain → subdomain, or VPS → Docker service → port or sub-service). DNS
   records normally live in the subdomain's `attrs`; they become nodes only
   when something must link to them. In layout a sub-satellite moves with
   its satellite as one composite block.
2. **Same layer.** Satellites stay in their host's layer; cross-layer
   relationships are edges.
3. **Status.** `lifecycle` (active/planned/deprecated/retired) is the only
   status field.
4. **Allowlisted attr types.** `public_key`, `fingerprint` and `identifier`
   (commit SHAs and similar). The exemption applies only to attrs that a
   TypeDef explicitly declares with one of these types; every other field is
   still rejected.
5. **Performance.** Full replace < 1 s; incremental writes < 300 ms.
6. **Revert.** No forced revert. A conflict returns 409 `revert_conflict`,
   and the caller writes a corrective change.
7. **History UI** waits for Phase 4; Phase 1 ships only the read API.
8. **Audit column.** Rename `connect_audit.diagram_id` to `target`.
9. **Resync and `since` validation.** Applies to `GET /api/topology?since=`,
   `GET /api/v1/topology?since=` and `/changes?since=`:
   - `since < oldest_retained_revision - 1` (pruning removed a change the
     delta needs: a delta from `since` replays every revision after it, so it
     is complete while the oldest retained change is `since + 1` or earlier;
     with no retained changes only `since` equal to the current revision is
     complete) → `410 resync_required`. For example, with history retained
     from revision 1, `since=0` is a complete delta, not a resync;
   - `since` greater than the current revision → `410 resync_required`;
   - malformed `since` (not a non-negative integer) → `400 invalid_since`;
   - `since` equal to the current revision → empty delta (the only case that
     is empty; stale, future and malformed values never are).

   The 410 body carries `current_revision` and `oldest_retained_revision`;
   the client then does a full snapshot read. Never return a partial delta.
   E2E covers a stale rev, a future rev and a malformed value.
10. **Model contract details.**
    - Arrays (≤16 strings) are allowed only for attr keys the TypeDef does not
      declare; a declared key takes only the scalar matching its `valueType`.
    - The attr string limit is 256 characters, except `public_key` values,
      which may be up to 1024 (fits RSA-4096 OpenSSH keys).
    - A read-only `revision` in a full replace or validate body (for example
      from an export) is accepted and ignored; concurrency is enforced only by
      `If-Match`.
    - Trust-boundary crossing warning: each endpoint's set is its
      `boundaryIds` plus all their ancestors, filtered to `kind = trust`; a
      satellite uses its root host's set; the warning fires when the two
      sets differ.
    - `edge.style.dash` is `solid|dashed|dotted`. `Boundary.style` allows only
      `color`, `border.color`, `border.style`, `border.width` and `icon`.
11. **`provenance`, not `source`.** The optional provenance marker is named
    `provenance` everywhere: the JSON field `provenance?` on every entity,
    the DB column `provenance` (entity tables and `topo_changes`), and the
    inspector label "Provenance". `Edge.source` and `Edge.target` are node
    IDs only (DB `source_id` / `target_id`).
12. **History ETag.** History paging (`/api/topology/changes` and
    `/api/v1/topology/changes`) uses its own ETag
    `"topology-changes:<revision>:<oldest_retained_revision>"`, so pruning
    invalidates cached pages even when the revision is unchanged. The snapshot
    and entity reads keep `"topology:<revision>"`. Both accept
    `If-None-Match` and return 304 on match.

### Implementation decisions (detector)

- Malformed URLs with extra slashes are still scanned for credentials. After
  the scheme delimiter, leading `/` characters are discarded only for userinfo
  inspection; an embedded `@` in that authority remainder is credential-like.
  Embedded tabs and line breaks are ignored only for credential parsing and
  are not treated as valid plain-URL allowlist characters.
- The high-entropy allowlist accepts a URL only when the complete string has
  exactly one extracted URL candidate, an authority begins immediately after
  the scheme, `URL` accepts it with a non-empty hostname, and it has no
  whitespace, backslashes or credential indicators. Other URL-like strings
  fail closed and remain subject to the normal secret rules.
- Error-path sanitization removes any string segment that contains the scanned
  value, is contained by the scanned value, shares a credential substring of
  at least four characters, or names a sensitive key for a `key_name` issue.
  The same rule also applies to string paths.
- Known credential prefixes are matched even when embedded in surrounding
  alphanumeric text; ordinary hyphenated and similarly named words are not
  prefixes without the declared marker syntax. Declared `identifier` values do
  not bypass a prior known-prefix match.
- Embedded `sk-` prefixes require at least 24 payload characters when preceded
  by an alphanumeric character. A standalone or separator-delimited `sk-`
  retains the existing credential-format match; `task-runner` and
  `disk-backed` are not embedded `sk-` credentials.
- URL extraction includes apostrophes, double quotes, backticks and angle
  brackets in candidate URLs; only whitespace terminates candidates. This
  intentionally keeps quoted query and userinfo text observable to credential
  checks, while the plain-URL allowlist rejects double quotes and backticks.
  Single-slash, extra-slash and backslash URL forms are not treated as plain
  URLs; backslashes are always fail-closed as credential-like URL syntax.
  URL components and query values are percent-decoded for up to three passes
  before the entropy allowlist; each pass result is inspected. Query-name
  decoding is also capped at three passes and stops safely on malformed
  encoding. Component decoding replaces malformed valid-looking percent
  escapes when such a pass fails, so private-key markers, known prefixes and
  JWTs remain detectable even after a malformed `%A` prefix. Four or more
  encoding levels leave every decoding stage as evidence: they are not
  URL-allowlisted and therefore remain subject to normal entropy detection.
- Nested raw and encoded URLs are inspected recursively for userinfo and
  sensitive query names. Every intermediate decoded stage is checked for
  private-key markers, known prefixes and JWTs; matching stages are also added
  to safe issue-path redaction, including string paths and array segments.
  Malformed percent escapes use byte-safe replacement rather than echoing the
  original encoded value in an issue. These URL and encoding checks are
  fail-closed safety-net heuristics, not a complete secret parser; unusual
  protocol-specific obfuscation outside the rules above is a known limitation.
- Fingerprint detection removes whitespace only for substring inspection, but
  the declared `fingerprint` exemption remains format-exact. SHA256, MD5 and
  40/64-character hex fingerprints embedded in text therefore remain subject
  to the `high_entropy` rule; valid standalone fingerprints are exempt only in
  a matching declared attr type.
- IPv6 validation counts an IPv4-mapped tail as two 16-bit units. IPv4 tails
  are accepted only at the final segment, are rejected in compressed left-hand
  text, and must keep the complete address within 8 units (or the specified
  IPv6 CIDR limit of 128).
- OpenSSH comments are optional text separated by a space or tab and may not
  contain CR/LF. RSA `ssh-rsa` blobs require canonical positive MPINT exponent
  and modulus values, with exponent at least 3 and odd and modulus odd. ECDSA
  blobs require the matching NIST curve name and an uncompressed SEC1 point
  with the exact curve-coordinate width that satisfies the curve equation.
  For P-521, coordinate widths are 66 bytes and the encoded point is 133 bytes.

### Implementation decisions (topology schema)
- Labels and descriptions use conservative fixed limits matching existing
  schema conventions: labels 160 characters, descriptions 4000 (topology
  description 12000), providers 160, URLs 2048, tags 100, and icons 64.
- `revision` is accepted as a non-negative integer in full replace or validate
  input and is preserved by parsing for export compatibility; the writer still
  owns revision and concurrency uses `If-Match` only.
- View filter arrays must contain unique IDs; duplicate layer, type, or
  boundary filter IDs are rejected rather than de-duplicated in storage.
- Structural validation issue codes are `custom` Zod issues carrying
  `params.topologyCode`; secret-like issues additionally carry
  `params.rule`. Paths and messages are redacted through the detector and never
  echo the scanned value.
- Arrays are allowed in attrs only for keys not declared by the node TypeDef;
  declared keys use the scalar type or enum matching their AttrDef.
- Provenance is an optional marker on the topology document and each top-level
  entity, including AttrDef: the value uses `^[a-z][a-z0-9-]{0,31}$` and every
  provenance string passes the same secret-like scanner as all other strings;
  entity IDs, references and view pin keys also pass the same string scanner.
  Every node attr map has at most 32 keys. Ordinary strings and unknown/declared
  non-public-key strings are limited to 256 characters; a declared `public_key`
  string may use up to 1024 characters. Arrays remain limited to 16 strings of
  256 characters each. Edge `source` and `target` remain node IDs; provenance is only the separate
  `provenance` field.
- Validation indexes incident edges for ancestor checks and caches only
  secret-scan results that are safe, scoped to one validation and the exact
  attr-key/declared-type mode. Rejected values are always rescanned at their
  own paths, so issue redaction and per-field reports remain unchanged.
  Warning calculation indexes nodes and memoizes trust sets per node; it does
  not change warning order or the trust-boundary rule.

### Implementation decisions (topology operations)

- Batches execute in order and validate the final graph. Removing an absent
  entity is a no-op; an empty batch is rejected. Layer and type removal checks
  all references that would otherwise become invalid, including view filters.
- `set_metadata` changes only supplied fields; a null provenance clears it.
- Diff compares object keys canonically while preserving array order and uses
  collection plus ID as the change identity. Metadata uses `metadata/main`;
  revision is not part of its image. Revert checks later change identities,
  restores before-images without implicit cascades, then validates the graph.

### Implementation decisions (topology storage)

- The topology metadata and all six entity tables have a nullable provenance
  column. AttrDef provenance is stored in the type's JSON schema. The change
  revert foreign key also has an index for retention and delete checks.
- Snapshot collections are returned in ID order, and node boundary memberships
  are returned in boundary ID order; membership order has no independent meaning.
- The guarded batch defers foreign-key checks until commit so valid reparenting
  and removals can be applied together. Changed layer orders temporarily use
  negative rowid-derived values inside that transaction to permit order swaps.
  JSON batch arguments are capped at 900,000 UTF-8 bytes; larger individual
  entities or images are bound as UTF-8-safe segments and concatenated in SQL.
  Before and after images use separate rows to stay within D1's row limit.
  Boundary memberships are sorted before diffing and recording. Each write
  attempt gets its own guard ID in topology metadata, distinct from the
  request ID recorded in history, so a failed repeat cannot reuse a guard.
- History pages use descending change IDs as cursors. Retention removes only
  a contiguous prefix and extends the retained boundary until every revert in
  that suffix keeps its ancestors, so an accepted `since` can never silently
  cross a pruned history gap. A `since` value is ASCII decimal digits within
  JavaScript's safe integer range; leading zeroes are accepted.
- A delta returns `since`, `revision`, per-collection `changed` entities and
  `deleted` IDs. It also returns complete metadata when revision advanced,
  including for an empty replacement; at the current revision metadata is
  omitted and all collection arrays are empty. A later recreation cancels an
  earlier deletion of the same ID in the delta.
- Browser snapshots return the topology in `data`, with `updatedAt` alongside
  it; change pages return `data.changes` and `data.nextCursor`. Query integers
  are decimal, history pages default to 50 and accept at most 500 entries.
  A resync response puts `current_revision` and `oldest_retained_revision` at
  the top level beside the standard error object. Legacy diagram routes remain
  available only until the planned v1 removal commit.

### Implementation decisions (topology browser client)

- Browser mutation transport preparation: `browserRequest` in the neutral
  `browser-request` module owns JSON response handling, 204 handling, request
  headers, same-origin credentials and HTTP error formatting. Diagram and
  Connect clients share it; the topology snapshot client keeps its independent
  ETag/304 cache. No Connect scope, database, route or machine API behavior
  changes in this preparation split.
- Snapshot caching is in memory per client instance; a 304 reuses its cached
  snapshot captured when that request was sent. Newer requests cannot have
  their cache entries overwritten by older completions, and clearing the cache
  invalidates pending writes. Filters intersect across dimensions and match any
  selected value within a view dimension. Boundary filters include a satellite's
  root host's memberships. Search results are independent of the canvas projection.
- Bidirectional edges are traversed in either direction by relationship traces.
  A view's focus layer is exposed separately rather than hiding other layers.

### Implementation decisions (Connect collection reads)

- Collection cursors are exclusive IDs, matching existing Connect pagination;
  filters intersect. A satellite matches the boundary memberships of its root
  host, while the boundary filter does not expand ancestor memberships.
  Collection projections use a validated snapshot and preserve its ID order.
- Collection page size defaults to 50 and is limited to 1–500; unknown or
  repeated query keys and malformed cursors are rejected. Mutation If-Match
  accepts one exact strong `"topology:<revision>"` ETag, including revision
  zero; a conflicting If-None-Match is rejected.
- Machine collection and history pages return `data` arrays and `nextCursor`
  alongside `requestId`; a history detail includes its change items. History
  detail and its revision are read in one batch, so its snapshot ETag and
  images describe the same database state.

### Implementation decisions (local Connect acceptance)

- The real-HTTP runner uses a per-run owned local D1 directory, synthetic
  credentials, loopback ports and process-group cleanup. It checks every
  registered machine endpoint and graph operation, then builds 201 nodes
  across seven layers and reverts the last node to leave 200.
- The capacity benchmark uses loopback HTTP and a fresh local Wrangler D1,
  with 30 layers, 60 types, 100 boundaries, 20 views, 1000 nodes (300
  satellites), and 5000 edges. After warmup, it measures 20 sequential
  samples per lane, including response consumption; incremental samples
  change 100 nodes and replacements change all 1000 nodes and 5000 edges.
  It asserts the change counts and fails if any p95 misses its target.

### Implementation decisions (root coverage)

- Root coverage includes all Worker implementation files, including its
  entrypoint; only declarations and test helpers are excluded. Existing root
  95/90/95/95 thresholds stay unchanged.

### Implementation decisions (Connect mutation plans)

- Operation batches containing any removal require confirmation, including a
  no-op removal. A replacement requires confirmation only if its diff removes
  an entity. Planning ignores the submitted revision, normalizes boundary
  membership order, and reports whole-result warnings and per-collection diffs.
- Single-entity DELETE returns 404 for an absent entity; batch removals retain
  their documented no-op behavior. DELETE of a node without a cascade option
  rejects nodes with satellites; subtree removal uses the operation batch.
  Malformed operation envelopes and entity shapes return a generic
  `invalid_topology` without reflecting user-supplied values or keys.
- The Connect write batch reserves its idempotency key before the guarded
  topology write, then derives the receipt outcome from the unique write guard
  in metadata rather than SQLite's last-statement `changes()`. The receipt,
  history, topology and audit commit together; token hash, write scope,
  revocation and expiry are checked again in the batch.
- The prepared machine handler returns `valid: true`, warnings and change
  counts for a successful dry run; invalid graphs return 422 with redacted
  issues. Every 422 `invalid_topology`, whether from a full document, an
  operations batch or an entity write, carries one `{ path, code, message }`
  issue per schema failure: batch paths start at the operation
  (`["operations", 0, "value", "style", "dash"]`), entity-write paths are
  relative to the body, and the message is generic, never the value. In-use and satellite-removal conflicts return 409 with their
  operation code. An invalid idempotency-key format returns 400. A stored
  matching receipt is checked before the revision precondition for replay.
- Revert takes no request body and always requires explicit topology
  confirmation. It uses the same revision guard and idempotent receipt as
  other writes; invalid or missing change IDs fail before any write.

### Implementation decisions (Connect operation registry)

- The topology registry is prepared separately from the active diagram
  registry; discovery remains unchanged until the atomic Connect switch.
  The revert operation is registered with its endpoint in the following commit.
- The prepared OpenAPI document derives paths and scopes from that registry,
  describes 304 and resync responses, and exposes the actual Zod input schemas.
  Capabilities for a read token list only read operations; a write token lists
  both read and write operations. Active discovery changes with the switch.

### Implementation decisions (Connect authentication)

- Topology token encryption binds deployment, token ID, scope, owner and
  expiry as associated data; the removed diagram ID is not included. The
  existing manager and Bearer checks remain separate. Audit entries use the
  fixed target `topology`, including failed authentication attempts. The
  existing Connect sweep also prunes topology history under its retention rule.
- The existing 50 non-revoked token limit now applies to the single topology.
  Token listing is global, audit listing has no diagram filter, and token
  version ETags retain their existing format. Old scope and diagram fields are
  rejected rather than translated. The switch is routed with migration 0010.
- The Connect page lists topology tokens globally, preserving the existing
  confirmation and secret-hiding behavior. Its instructions show the canonical
  topology endpoint and never place credentials in URLs or browser storage.

### Implementation decisions (read-only topology page)
- The canvas background grid uses the Basalt border token so it remains
  defined in both light and dark themes after removing legacy diagram CSS.
- Layout the complete canonical snapshot before applying view/client filters; canvas projection then uses only visible node IDs and edges whose endpoints remain visible, so a visible satellite keeps its canonical host/block geometry. The selected view supplies layout pins.
- Search is independent of canvas filtering; selecting a search result selects it but does not add a filter, and relationship trace is explicit. Satellite boundary chips and inspector boundaries include inherited root-host memberships and boundary ancestors.
- Badge cards show at most six declared `badge` attributes in attr definition order; string, number, boolean, and array values are rendered, so numeric zero and boolean false remain visible. Provenance displays `Not set` only when absent.
- Card display budgets are finite and fixed: host and satellite cards use 152px height; each card shows at most six badge chips in a two-column grid and one boundary chip, followed by a `+N boundaries` accessible summary when more boundaries are inherited. Badge text uses an accessible tooltip/title rather than expanding the card; boundary summaries expose the complete comma-separated labels through `title` and `aria-label`. Enter/Space on the card and React Flow selection callbacks select the same inspector node. Selection changes pass only React Flow selection/dimension changes; position/remove/add changes are ignored, so keyboard selection never writes topology geometry. Fit is recomputed only when topology revision/view/pins/visible business-node geometry or canvas size change; ordinary node selection preserves pan/zoom. Automatic and explicit fit calculate bounds directly from the current projected visible business nodes, then call `setViewport(getViewportForBounds(...))` so stale React Flow store coordinates cannot drive a fit. Lane nodes and hidden pinned nodes are excluded. The inspector renders `↔` for every endpoint of a bidirectional edge and keeps source→target / target←source arrows for unidirectional edges.

### Implementation decisions (interim layout)

- Lanes begin at `(0, 0)` with 32-pixel padding and pack host blocks in four
  columns. Host cards are 240 by 152 pixels and satellite cards 220 by 152, so
  badge and boundary content has consistent finite geometry; cards keep
  horizontal and vertical gaps of 24 and 16 and a 32-pixel sub-satellite indent.
- Pins are absolute canvas coordinates. A sub-satellite pin moves its complete
  satellite block, placing the pinned node at its requested coordinate. If
  pins within a block conflict, the host pin takes precedence, then the
  satellite pin, then the lowest-ID sub-satellite pin. Pinned blocks can overlap
  one another; unpinned blocks scan the grid to avoid reserved geometry.

Delivery: Phase 1 and Phase 2 in one PR (#104), release `0.5.0`, developed
through herdr (see the implementation path above).
