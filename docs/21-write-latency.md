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
| `auth` / `auth-sql` | 1 batch: token lookup + current rate-limit count (read-only since v0.5.7) | Rejects with 429 when `count >= limit`. |
| `read` / `read-sql` | 1 batch: full snapshot (8 statements) + idempotency receipt | Read-only. |
| `validate` | none | CPU only; reads 0 in production because Workers clocks only advance across I/O. |
| `write` / `write-sql` | 1 batch, see below (includes rate-limit increment since v0.5.7) | Single transaction. |
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
`auth=16`, and the warm sample #25 had `auth=160`. Through v0.5.6 the auth
batch contained a write — the atomic rate-limit charge — so it paid the same
durable-commit tail as `write`. Fixed in v0.5.7 (proposal A below).

### Snapshot read (item g / proposal B)

`read` is ≈ 25% of p50 and grows with the graph, but is never in the tail.
Narrowing it to the affected entities is not small: planning an operation
validates references, parent and boundary cycles, layer/type usage and secret
values against the whole graph, and the write statements diff `before` against
`after`. **Deferred (拓扑大师, 2026-11-01):** revisit only if read p95 rises
above about 70 ms after real data is imported. A cheaper interim is to
re-measure read at ~400 nodes first.

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

## v0.5.6 production re-measure (N=100)

Run by 拓扑大师, 2026-11-01 13:51–13:56 UTC+8, stock probe, gap 2200 ms.
Revision 67 → 169, 0 entities afterwards. **PASS:** server total p95 = 280 ms.

| ms | p50 | p90 | p95 | p99 | max |
|---|---|---|---|---|---|
| total | 89 | 242 | 280 | 410 | 478 |
| auth-net | 20.7 | 76.6 | 184.6 | 247.2 | 267.7 |
| write-net | 37.1 | 56.7 | 174.9 | 358.2 | 423 |

Write-net > 100 ms in 7/100; auth-net > 100 ms in 9/100; they never co-occur.
The write-latency item is closed at the p95 target; remaining p99 is accepted
as D1 durable-commit latency with no app-level fix.

## Proposals after N=100 (拓扑大师)

| Proposal | Decision |
|---|---|
| **A.** Move the rate-limit increment off the auth critical path | **Do it** (v0.5.7), with the mutation fold below |
| **B.** Narrow the snapshot read | **Not now**; revisit if read p95 > ~70 ms after real data |

## v0.5.7 changes — proposal A

Auth is a **read-only** batch: token lookup + `SELECT` of the current window
count. If `count >= limit` the request is rejected with 429 **before** any
topology read or write.

- **Writes that reach their D1 batch:** `takeRateCharge` folds an unconditional
  `count = count + 1` into that same batch (SELECT stays last). One commit,
  count stays transactional with the mutation. Expected p95 ≈ 240 ms.
- **Reads:** the increment is deferred via `waitUntil` (or awaited in tests
  without an execution context).
- **Writes that never reach the batch** (412 / 422 / validate / idempotent
  replay): `runConnect` defers the same increment so the bucket is charged
  exactly once. Rejected tokens never arm a charge.

### Check vs increment semantics

1. Auth reads the stored count. At `count >= limit` → 429; the increment is
   never armed.
2. A request that passes the check always increments exactly once, either in
   the write batch or via the deferred path. The increment statement has no
   `WHERE count < limit`, so it cannot silently under-count.
3. **Brief overshoot on concurrent requests:** two writes can both observe
   `count = limit - 1`, both proceed, and both increment → stored count may
   reach `limit + concurrency - 1` for that window. Subsequent requests still
   see `count >= limit` and get 429. Bound by in-flight concurrency; single-
   owner tokens at 30/min make this rare in practice.
4. **Read under-count:** a deferred read increment can be dropped if the
   isolate is killed before `waitUntil` runs. That under-counts the read
   bucket only.

Manager rate limiting is unchanged (still an atomic check-and-increment).

## v0.5.7 retest and v0.5.8 fix — deferred writes start after the action

拓扑大师 re-measured v0.5.7 (2026-11-01 14:17–14:27 UTC+8, 2 × N=100, gap
2200 ms): server total p95 351 / 370 ms, **fail** against 300. Auth p95 fell
185 → 16–18 ms as planned, but a new read tail appeared.

Samples with a segment's `*-net` above 100 ms (D1 commit-tail events; SQL is
≤ 12 ms everywhere):

| Run | auth-net | read-net | write-net | Requests with any | read-net p95 / max |
|---|---|---|---|---|---|
| v0.5.5 (N=30) | 2 | 0 | 2 | 4 (13%) | 34.7 / 35.1 |
| v0.5.6 (N=100) | 9 | 0 | 7 | 16 (16%) | 36.2 / 79.3 |
| v0.5.7 run 1 | 1 | 6 | 8 | 15 (15%) | 135.5 / 797.5 |
| v0.5.7 run 2 | 0 | 6 | 7 | 13 (13%) | 152.0 / 491.7 |

- **Not noise:** read-net spikes went from 0 / 130 to 12 / 200 (at a 6% rate,
  0 in 130 has probability ≈ 3·10⁻⁴), while the per-request event rate stayed
  13–16% and write-net spikes stayed at 7–8. The tail **moved** from auth to read
  instead of disappearing.
- Spikes never share a request, are not adjacent to a write spike of the
  previous request (one coincidence in 200), are spread over the run, and are
  not on `cold` samples (cold: v0.5.6 #0/#5, v0.5.7 #0 only).
- **Cause:** `last_used_at` is stamped by a deferred `UPDATE` that was issued
  (`.run()`) at the end of auth, so it commits on the D1 primary concurrently
  with the request's snapshot read, and the read's result waits for that
  commit. Up to v0.5.6 the auth batch was itself a write, so the request's first
  commit (and its tail) landed in auth; the `UPDATE` then followed a just-made
  commit. With a read-only auth, the deferred `UPDATE` becomes the first commit
  and its tail lands in `read`. Reads are not the only victim: GET requests
  also issued their deferred rate increment before their snapshot read.

**v0.5.8:** deferred work (last use, read rate increment, 412/422 increment,
audit) is queued as thunks and started by `runConnect` only after the action
has returned, so no write is in flight while the request's critical-path D1
calls run. Critical/deferred round-trip counts are unchanged; a unit test
traces the D1 call order. A mutation now pays one commit on its critical path
(the write batch). Expected: read-net back to v0.5.6 (max < 80 ms), spikes
only in write-net (~7%), total p95 ≈ write tail.

**A/B probe:** `STEED_PROBE=read` runs N `GET /api/v1/topology` with the same
gap and no topology writes (any prod state), and every probe summary now
prints `net > 100 ms` counts per segment.

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
| 2026-11-01 13:51 UTC+8 | v0.5.6 | 100 | 67 → 169 | 0 |
| 2026-11-01 14:17 UTC+8 | v0.5.7 | 100 | 169 → 271 | 0 |
| 2026-11-01 14:22 UTC+8 | v0.5.7 | 100 | 271 → 373 | 0 |
