# FUCQ-415 equipment evidence reuse

Story `DEV-2026-11-13-GC-008`, five points, claimed at `e2a724ab74a95465561a013193d6695c81f9005a` on `dev/DEV-2026-11-13-GC-008`. Integration base is `gcsp-poc-dev`. Mary-Sue Walton leads this increment. Original native Node acceptance remains fixed; Java parity does not replace it.

## Readiness and plan

`scorePreferences` in `server/scenarios/employee/index.js` gates option facts through `confirmedFact`, then calls `scoreOptionEvidence`. That gate uses known status, non-null value, source/version/observation provenance and configured assurance. Equipment derivation consumes selection kind, complete, codes and activeCodes, equipment policy and preference definitions. It does not consume configuration ID or employee preference values. Recommendation uses detached assumption reads from PolicyService, so immutable preparation must happen once at that owned boundary without freezing externally supplied mutable objects.

Stable slices:

1. `admission`: admit immutable policy/preferences, preserve mutable/malformed behavior, and use the complete relevant signature.
2. `reuse`: bounded evidence reuse, detached results, semantic-equivalence and production operation evidence including eviction/reset/recomputation.
3. `connected`: actual release/offer/history integration and independent rendered review at desktop/narrow widths, no-match and conflict/replay; record native PostgreSQL and browser/environment limitations honestly.

Components already associate FUCQ-415 with `recommendation` and `catalogue`; no component boundary changes. No UI/design work is planned. Visual references remain `docs/gcsp/screens/README.md`, `COMPONENTS.md` and frozen body behavior `e44ed08a9674d8bf0fe6de2e7195ec3e2d775d38`, under `docs/gcsp/experience-quality.md`. New screenshots are unnecessary for isolated computation; connected acceptance is still required.

## Validation and resource ownership

Selected checks are `node --test --test-concurrency=1 server/test/fucq415-option-evidence.test.js`, `node --test --test-concurrency=1 server/test/employee-option-preferences.test.js` and `node --test --test-concurrency=1 server/test/gcsp-case-options.test.js`. The focused regression will compare complete evidence and scoring against the uncached mutable path, exercise production recommendation reuse and certainty changes, malformed/mutable policies, colliding versions, bounded eviction/reset and detached outputs. No full suite is justified for this internal boundary. Native PostgreSQL and actual connected browser evidence are separate gates.

Resource manifests and retained bounded logs live under `/Users/garycarter/Code/GitHub/vehicle-matcher/.claude/test-runs/fucq415`. Each allocation owns its scratch/finalizer and propagates TMPDIR/TMP/TEMP. Start with one worker, at most 2 GiB scratch and ten minutes per chunk; preserve 5 GiB emergency reserve and adapt below 30 GiB. Outputs over 256 MiB go directly to `/Users/garycarter/Library/CloudStorage/OneDrive-IBM/_agent-output/vehicle-matcher/fucq415`. Stop/join owned processes, remove only owned disposable scratch and verify absence. Native clusters require a coordinated serial window; no running app or foreign cluster is touched.

## Delivery state

Planning recorded; implementation and acceptance evidence pending. Native/file In Progress and lease retained. Known separate Medium FUCQ-484/487/488 remain unresolved and outside this Story. Jira writes resumed 13 November; collaborators have equal authority. Child-only HTTP 422 does not stop authorised work while the launcher remains available.

Agent settings: lead requested/selected Sol/high per dispatcher; effective runtime evidence is held by dispatcher. Planned nighttime mechanic Tweety requested/selected `gpt-6-luna` / `high`; no fallback, runtime/title verification pending.
