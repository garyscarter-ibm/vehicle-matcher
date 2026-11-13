# FUCQ-413 price and allowance compilation

Lightning McQueen owns DEV-2026-11-13-GC-006 on `dev/DEV-2026-11-13-GC-006`, admitted at `a5dd9630` (published F414 integration). The dispatcher owns publication, shared-base integration, claims, native Jira, acceptance lifecycle and cleanup. The helper resolves `gcsp-poc-dev`. No new source, UI, policy values, points rules or acceptance criteria are introduced.

## Contract and plan

The original four criteria remain fixed: exact configuration and match-field equality prices with ambiguity/missing outcomes; first effective context/grade allowance and provenance across activation/history; bounded repeated work without full price/allowance scans per candidate; connected release/offer/accepted-history review at desktop and narrow widths, including no-match and conflict/replay.

Stable map slices are `prices`, `allowances` and `integration`. The verified `policy` component already associates FUCQ-413. Implementation is additive to the F412 immutable snapshots, pinned-row reuse and effective-interval eligibility compiler in `server/gcsp/policy/index.js`. A pin still resolves at version activation; unpinned reads still discover the canonical current provider versions and respect dated row boundaries. Existing F412 AC4 and separate Low F400, Medium F484 and Medium F486 remain open and unfixed.

The actual read boundary is `resolved.rows(table)`, backed by validated immutable seeds. Compile equality lookups per seed and finite effective interval, preserving exact own-property equality, model/configuration ambiguity and first effective allowance order. Returned rows retain complete provenance and clone isolation. Price and allowance source values remain unchanged.

## Selected validation and resources

Run each with `node --test --test-concurrency=1`:

- `server/test/gcsp-policy-price-allowance-compiled.test.js` (new independent scan-oracle equivalence and bounded operation proof).
- `server/test/gcsp-policy-service.test.js` (original typed contracts and pinned reads).
- `server/test/gcsp-policy-versions.test.js` (publication/activation/reopen, including isolated native PostgreSQL).
- `server/test/gcsp-policy-adoption.test.js` (existing publication facade and activation).
- `server/test/gcsp-policy-eligibility-compiled.test.js` (preserve F412).

Select actual affected caller checks from inspected interfaces; no whole-suite/load run is justified by this internal equality change. Targeted evidence cannot establish a full stamp. Restricted/unset `FUCQ106_MODULE_MAP` remains unavailable; fixtures establish no hosted Java/OIDC or inaccessible native-offer acceptance. Preserve failed/skipped/unrun checks and every unmet original gate.

Shared resource receipts live at `/Users/garycarter/Code/GitHub/vehicle-matcher/.claude/test-runs/fucq413/`. `manifest.json` selects the checks and boundaries before allocation. Each child owns its scratch manifest/finalizer, scoped temporary variables and bounded output. Start one worker, at most 2 GiB scratch and ten minutes per chunk, keep a 5 GiB reserve and adapt near 30 GiB. Large output above 256 MiB goes directly to `/Users/garycarter/Library/CloudStorage/OneDrive-IBM/_agent-output/vehicle-matcher/fucq413`; none is planned. Preserve installed dependencies. Stop/join owned process groups, remove only owned scratch and verify filesystem absence before return.

Native PostgreSQL 16.15 binaries exist locally. The dispatcher reserved the next isolated native window after source readiness; no shared database, credentials or pre-existing cluster/process is used. A uniquely named manifest-owned local cluster may be allocated only in that window, bound to loopback/socket with bounded memory and teardown proof.

## Agents and current state

- Lead Lightning McQueen: requested/selected/effective `gpt-6.1-sol` / `high`, saved rollout line 8, sidebar title verified, no fallback.
- Price implementer Heihei: requested/selected/effective `gpt-6.1-sol` / `medium`, saved rollout line 8 and own title verified; one child at a time, no fallback.

Implementation and independent review are in progress. Original acceptance remains open; no Built, Done, waiver or closure is claimed. Visual references remain `docs/gcsp/screens/README.md`, `COMPONENTS.md` and frozen baseline `e44ed08a9674d8bf0fe6de2e7195ec3e2d775d38`, under `docs/gcsp/experience-quality.md` and the scope rules in `docs/gcsp/build-rules.md`.
