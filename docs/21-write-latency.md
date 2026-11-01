# 21 — Incremental write latency and production test data

## Scope

v0.5.4 acceptance measured incremental `put_node` writes at server p50 ≈ 304 ms
and p95 ≈ 1120 ms against a target of **server p95 < 300 ms**. This document
records how the latency is observed (v0.5.5), what the production measurement
found, what v0.5.6 changes, what is proposed for later, and the owner decision
that allows `test-` data to be written to and cleared from production.

## Observation: `Server-Timing` (v0.5.5)

`/api/*` responses carry `Server-Timing` (format in docs/19). For a mutation the
segments map to the request path:

| Segment | D1 work | Notes |
|---|---|---|
| `auth` / `auth-sql` | 1 batch: token lookup + rate-limit charge (`INSERT … ON CONFLICT … RETURNING`) | The charge is a write. |
| `read` / `read-sql` | 1 batch: full snapshot (8 statements) + idempotency receipt | Read-only. |
| `validate` | none | CPU only; reads 0 in production because Workers clocks only advance across I/O. |
| `write` / `write-sql` | 1 batch, see below | Single transaction. |
| `audit` | deferred work awaited inline | Appears only without `waitUntil` (tests, scripts). |
| `colo` | none | Per-isolate `/cdn-cgi/trace` lookup. |

`<segment> − <segment>-sql` is everything outside SQL execution: the round trip
to the D1 primary, queueing, and commit.

## Production measurement (v0.5.5, 2026-11-01 13:36 UTC+8)

Run by 拓扑大师 with `scripts/prod-write-latency.ts`, N=30, gap 2200 ms, from a
US client (ingress IAD → Worker NRT). Seed 245 `test-` nodes / 105 edges, 30
`put_node` writes, clear. Revision 35 → 67, 0 entities afterwards.

| Metric (ms) | p50 | p95 | max |
|---|---|---|---|
| total (server) | 85 | 316 | 562 |
| auth (auth-sql) | 19 (0.4) | 160 (0.7) | 166 (0.8) |
| read (read-sql) | 23 (3.9) | 39 (6.5) | 40 (7.5) |
| write (write-sql) | 39 (1.9) | 275 (3.5) | 511 (4.0) |
| colo | 0 | 0 | 1 |

The two slowest writes spent 511 ms (#5) and 275 ms (#27) in `write` with
2–3 ms of SQL; normal `write − write-sql` is ≈ 36 ms. Two auth samples spent
160–166 ms with 0.3–0.4 ms of SQL (#11 on a cold isolate, #25 on a warm one).

## Findings

### D1 primary location (item b)

Read-only checks with the steed production Cloudflare token:

- `GET /accounts/:id/d1/database/:uuid` → `running_in_region: APAC`,
  `read_replication.mode: disabled`.
- `SELECT 1` through the D1 query API → `served_by_colo: NRT`,
  `served_by_primary: true`.

The primary is in NRT, the same colo as the Worker (`targeted` placement in
`aws:ap-northeast-1`; `X-Steed-Colo: NRT`). Placement is already optimal; the
normal ≈ 18–36 ms outside SQL is the in-colo D1 round trip. With replication
disabled every query goes to the primary, so there is no replica lag.

### Write batch and audit (item c)

A successful mutation already runs in **one** `DB.batch()` (one round trip, one
transaction): receipt reservation, the revision bump and entity
upserts/deletes, memberships, the `topo_changes` / change items / images
history rows, the receipt outcome update, **the audit row**
(`INSERT INTO connect_audit … SELECT … FROM connect_requests`), and the final
receipt select. `ctx.audited` is then true, so `runConnect` does not schedule a
second audit insert. There is nothing left to fold in.

The only other write on a successful request is the token's `last_used_at`
stamp from `auth`. In production it is handed to `waitUntil` and runs after
the response, so it is not timed and the `audit` segment never appears. The
segment is only emitted when there is no `waitUntil` (unit tests, scripts), or
for failed requests whose audit row is not part of a write batch — in
production those audits also go to `waitUntil`.

### Write tail (primary cause)

With SQL at 2–4 ms and a single round trip, the 275–511 ms spikes are spent in
D1 outside SQL. The most likely cause is the durable commit: a D1 write is
acknowledged only after the primary's storage confirms it, and occasional slow
confirmations form the tail. Read-only
batches (`read`) never showed it: 14–40 ms across all 30 samples. There is no
contained application fix: the batch is already one round trip, and the
Worker is co-located with the primary.

### Auth tail (item d)

`auth` is not a first-connection cost: the other cold sample (#0) had
`auth=16`, and the warm sample #25 had `auth=160`. The auth batch contains a
write — the atomic rate-limit charge — so it pays the same durable-commit tail
as `write`, at a lower rate. Warming does not help, and merging auth into the
read batch would save one ≈ 18 ms round trip but keep the commit.

Proposed (not done in v0.5.6, it changes rate-limit semantics): make the auth
batch read-only by checking the current window count and moving the increment
to `waitUntil` (or into the write batch for mutations). Bursts of concurrent
requests could then briefly exceed the per-minute limit, which today is exact.

### Snapshot read (item g)

`read` is ≈ 25% of p50 and grows with the graph, but is never in the tail.
Narrowing it to the affected entities is not small: planning an operation
validates references, parent and boundary cycles, layer/type usage and secret
values against the whole graph, and the write statements diff `before` against
`after`. Proposed for later: per-operation read sets (the node, its
neighbourhood, referenced layer/type/boundaries) with plan-level fallbacks to
the full snapshot.

### ETag weakened by Cloudflare compression

The stock probe got 412 on its first write. Bun's `fetch` sends
`Accept-Encoding: gzip`; Cloudflare compressed the snapshot response and
weakened its ETag to `W/"topology:35"`, which strong-only If-Match rejected.

## v0.5.6 changes

- Connect responses send `Cache-Control: no-store, no-transform`, so Cloudflare
  leaves them uncompressed and the ETag strong.
- Mutation If-Match also accepts `W/"topology:<revision>"`. Weak comparison is
  safe because the ETag names a revision. Covered by unit tests and an L2 E2E
  case with a gzip-requesting client.
- `scripts/prod-write-latency.ts` defaults to N=100 (cap 200, gap ≥ 2000 ms
  keeps writes under 30/min), prints p50/p90/p95/p99/max, and derives
  `auth-net`, `read-net` and `write-net` (segment minus SQL).

With 30 samples p95 is the second-worst value; N=100 is needed to tell whether
the commit tail is ≈ 5% of writes or two unlucky samples.

## Production data operations

AGENTS.md requires an owner decision recorded in a numbered doc, and a D1
backup first, before production topology data is cleared.

**Decision (2026-11-01 13:15 UTC+8, reported by 拓扑大师):** 哥 agreed that
`test-` data may be written to production for latency tests and then cleared
back to an empty topology.

- Production holds no real topology data; only acceptance `test-` entities
  (`apps/web/e2e/acceptance-topology.json`) are written.
- 拓扑大师 runs the tests with its own write token. The steward does not hold a
  production write token and does not issue one.
- Before each run a snapshot backup is written to
  `shared-handoff/steed-backups/` (first run:
  `steed-prod-pre-wl055-20261101-133601.json`); D1 Time Travel is the fallback.
- The probe refuses to start unless production is empty and always clears to
  empty with the original title, description and provenance.

| Run | Version | N | Revision before → after | Entities after |
|---|---|---|---|---|
| 2026-11-01 13:36 UTC+8 | v0.5.5 | 30 | 35 → 67 | 0 |
