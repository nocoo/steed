# Retrospective

Accident narratives belong here. Keep only recurring project rules in `AGENTS.md`; cross-project lessons belong in global rules and deterministic checks in hooks/tests.

No accident narratives have been recorded yet.

## 2026-10-05: Resolve exact dependency issue targets

The first uncommitted ESLint installation used a caret range and selected 10.12.0 instead of the requested 10.11.0. The lockfile delta review caught this before any commit or push. The coordinator preserved the attempt, restored only its two uncommitted files, then pinned 10.11.0 and verified the resolved graph. For target-bound maintenance, use exact versions and compare actual lock resolutions before committing; a compatible range can still exceed the authorized target.
