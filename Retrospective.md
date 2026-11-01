# Retrospective

Accident narratives belong here. Keep only recurring project rules in `AGENTS.md`; cross-project lessons belong in global rules and deterministic checks in hooks/tests.

## 2026-11-01: Verify hook installation before resolving a merge

During Phase 3 setup, the main-branch merge conflicted before the requested
dependency installation. The controller resolved and committed the merge while
the configured Husky launcher was still absent, so the commit hook did not run.
The exact merge snapshot later passed the pre-commit and pre-push checks in an
isolated copy, but that does not make the hook execution retroactive. Before
finishing a conflicted merge, verify that the configured launcher exists and
install the required dependencies first when necessary.

The controller also placed a downloaded browser under `.p3-local/`, where
ESLint scanned its JavaScript and failed. Moving the owned browser to an
isolated temporary directory restored the unchanged lint gate. Keep downloaded
test tools outside the lint traversal and clean up their owned directories.

Several parallel staging copies inside `.p3-local/` later caused ESLint to
exhaust its Node heap, and the style commit hook correctly rejected the commit.
The controller paused the workers, moved the owned copies to a temporary
directory, and resumed them through symlinks. The unmodified lint and complete
commit hook then passed. Keep parallel staging copies outside the project lint
traversal from the start.

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
