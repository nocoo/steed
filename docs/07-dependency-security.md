# Dependency security repairs

The logo publication's required OSV gate found 44 advisories across 11 locked dependencies. The HTTP integration suite passed, but publication remains gated on resolving the dependency findings.

Update Hono, React Router, Next.js and NextAuth to the reported fixed releases. Raise the existing PostCSS, brace-expansion and Undici overrides, and pin patched transitive versions of nanoid, sharp and the ESLint filesystem helper. NextAuth supplies the fixed auth core. Preserve the current application API and version.

The affected manifests are the root, `apps/web`, `apps/web_legacy` and `packages/worker` package files. The legacy web package remains in the existing workspace, so its locked dependencies also pass the security gate.

Commit the targeted manifests, lockfile and this record separately from the logo adoption. Run the required type, lint, coverage, build, HTTP integration, dependency and secret checks before pushing.
