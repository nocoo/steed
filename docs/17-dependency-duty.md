# Dependency duty — 2026-10-05

Upgrade the currently adopted Vitest 5 line to 5.0.3 across its workspace consumers (#27,#42), ESLint to 10.11.0 (#31), and typescript-eslint to 8.71.0 (#40). Preserve supported security backports, all package majors, application behavior, and existing coverage/static/security gates.

## Atomic changes

1. Commit this plan.
2. Upgrade paired Vitest and coverage adapters.
3. Upgrade ESLint.
4. Upgrade typescript-eslint.

## Verification

Use an owned isolated clone, frozen Bun install and normal hooks. Run strict types/lint, real coverage with its summary gate, web/CLI builds, full-history Gitleaks and OSV. Run the three ordinary local HTTP suites with synthetic credentials and owned SQLite persistence; inspect actual migration success and fail the duty if initialization failed, even if the legacy runner continues. Keep daily ports/state untouched. No browser, live host scanning, manual deployment or real credential operations.

Require independent read-only Grok and Pi reviews at the exact final base/head, then current-head CI and mergeability checks. Merge with all commits preserved and verify exact issue closures. Existing coverage/physical-isolation enforcement gaps remain documented in AGENTS; this duty does not certify the complete 6DQ contract.

## Implemented candidate

The three dependency groups are committed at their exact issue targets. Normal hooks passed 1,154 tests across 106 files during implementation. Final full-head validation and independent reviews remain required before PR creation. The configured branch coverage floor remains 90%; do not describe this as complete four-metric 95% compliance.
