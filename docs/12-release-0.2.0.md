# 12 — Release v0.2.0

Release date: 2026-09-12. Root version: `0.1.1` → `0.2.0`.

## Policy and baseline

The user explicitly requested a minor increment: keep X, increment Y, and reset
Z to zero. The global `su-release` command makes root `package.json` the single
source of truth. There is no `scripts/release.ts`, so use its manual release
workflow and the repository's mandatory Git hooks.

After fetching `origin`, `main` is clean at `898ccaf` and
`git rev-list --left-right --count origin/main...main` returns `0 4`.
Preserve the four reviewed commits without rewriting them:

- `8da4157` — Basalt verification plan.
- `22e007d` — First-render and unavailable-storage fixes.
- `204f926` — Focusable main-content skip target.
- `898ccaf` — Verification evidence and independent Codex Sign Off.

The latest published release is `v0.1.1`. The remote has no `v0.2.0` tag.
Before this release, both production health endpoints report `0.1.1`.

## Version changes

| Consumer | Change |
|---|---|
| Root and six workspace manifests | Set project versions to `0.2.0`; preserve dependency constraints. |
| `bun.lock` | Regenerate with `bun install`; verify that dependency resolutions stay unchanged. |
| Web version / sidebar / Worker live / Worker health / CLI tests | Update the five existing expected release-version assertions. |
| Active web sidebar | Keep the root-derived `v0.2.0` badge next to Steed; add `font-mono` as required by `su-release`. |
| `CHANGELOG.md` | Describe changes since `v0.1.1`, including the reviewed Basalt fixes and CI/deployment workflow migration. |

Vite, Vitest, the CLI, the legacy version module, and both health endpoints
already read the root manifest. Keep those paths. Historical release documents,
third-party dependency versions, and agent/data-source version fixtures are
separate from the current application release version.

## Atomic commit and publication

One atomic `chore(release): publish v0.2.0` commit contains this document, its
index entry, synchronized version metadata, existing version assertions, the
sidebar font class, and the changelog. Regular and frozen Bun installs checked
the lockfile and required no changes.

Push `main` normally after all hooks pass. Create annotated tag `v0.2.0` at the
exact release commit, push the tag, and publish the GitHub release with this
version's changelog. Never force-push or move an existing tag.

The current production path is `.github/workflows/ci.yml` followed by
`.github/workflows/release.yml`, which deploys the `apps/web` production Worker
and static assets together. Keep that path and its deployment provenance checks.
Do not deploy the historical standalone Worker configuration over the web Worker.
This release changes no authentication, database schema, deployment configuration,
or other repository.

## Verification and completion evidence

- Run Bun install and frozen-lockfile validation without dependency upgrades.
- Run mandatory pre-commit G1/L1 gates and the web package's typecheck, coverage,
  and production build; check the CLI's actual version output.
- Run mandatory pre-push L2 HTTP E2E with isolated local D1 and G2 security scans.
- Confirm remote `main`, the release tag, and the deployment source all resolve
  to the release commit; inspect both CI and production deployment conclusions.
- Verify real production `GET /api/live` and `GET /api/v1/health` return HTTP 200
  with `version: "0.2.0"`; preserve `Cache-Control: no-store` on `/api/live`.
- Exercise the actual production page and its Access boundary, record HTTP and
  browser evidence, and distinguish authenticated checks from login-page checks.
  Do not replace production API responses with fixtures.
- Start a five-minute timer after publication and recheck `gh run list --limit 5`
  plus the release commit's CI/deployment runs when it expires.
- Preserve release/deployment URLs and smoke evidence outside the repository,
  then report the remote SHA, tag/release URL, production URL, and actual results.
