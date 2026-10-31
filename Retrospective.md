# Retrospective

Accident narratives belong here. Keep only recurring project rules in `AGENTS.md`; cross-project lessons belong in global rules and deterministic checks in hooks/tests.

## 2026-10-31: Bound rule-file searches to approved roots

While locating the commit rules, the controller searched under the home
directory instead of limiting the search to known instruction roots. This could
traverse the excluded work workspace; no results from it were returned and no
files were changed there. Future searches must name only approved roots, with
the exclusion checked before running the command.

A continuation repeated the same mistake while looking for the commit rules:
it included the home directory in an `fd` search. No results from the excluded
workspace appeared and no files there were intentionally opened or changed,
but the search could have traversed it and read ignore files. Before searching,
use the known rule-file path or explicitly list only approved instruction
directories, never a parent that contains excluded workspaces.

## 2026-10-31: Target Herdr panes explicitly

While arranging the Phase 1 work panes, a resize using `--current` resolved to
another workspace instead of the controller's pane. Herdr reported no change,
and the intended resize succeeded using the explicit pane ID. The command's
target resolution differed from the controller's assumed caller context; use
verified workspace-qualified pane IDs for subsequent control commands.

## 2026-10-05: Resolve exact dependency issue targets

The first uncommitted ESLint installation used a caret range and selected 10.12.0 instead of the requested 10.11.0. The lockfile delta review caught this before any commit or push. The coordinator preserved the attempt, restored only its two uncommitted files, then pinned 10.11.0 and verified the resolved graph. For target-bound maintenance, use exact versions and compare actual lock resolutions before committing; a compatible range can still exceed the authorized target.

## 2026-10-13: Avoid competing full validation runners

Running full coverage and the filesystem/security/HTTP gate simultaneously on a
shared machine caused existing five-second UI tests to time out. A second run
with default CPU-derived parallelism still failed; the complete suite passed
with two workers. Bound Vitest concurrency without changing timeouts, assertions,
coverage or isolation, and run expensive gates sequentially. Inspect every
parallel gate result independently: the HTTP rate-limit fixture also seeded only
historical minute windows, and OSV found two unrelated publication blockers.

## 2026-10-13: Inspect redirected registry slots before pushing

The initial lock normalization matched the requested Microsoft proxy hostname
only. Newly patched packages returned tarball URLs on a redirected Visual Studio
feed hostname, leaving 28 mirror slots in local commits. The final pre-push
review caught this before any remote write. Normalize registry URL slots rather
than one hostname, require zero `\", \"https` lock entries, and prove a frozen
install preserves the cleaned lock before publication. Versions and integrity
hashes remain unchanged.
