# FUCQ-58 reviewed retained configuration plan

The explicit `fleet-configurations.v1` branch qualifies the reviewed retained selection of exactly **10,000 distinct configurations** without requiring a VIN profile. This follows the [4 November Q13 agreement](../../../hld-agreement-2026-11-04.md): synthetic stock uses an order reference plus configuration; VINs belong to delivered/current cars. Qualification does not create 10,000 stock orders or establish delivered-car profile coverage.

Run the portable selected plan with:

```sh
node scripts/gcsp/fleet-plan.mjs --config server/data/gcsp/vehicle-evidence/fleet-configurations.v1.json --offline
```

The result identifies itself as `reviewed-retained-configuration-plan`. Its authority is the compact code-owned `fleet-configuration-evidence.v1.json`, whose exact SHA-256 is pinned in the qualifier. It retains relative artifact filenames and exact hashes for the existing selection manifest, coverage and audit receipt, plus model/AG/range joins, market/date/catalogue provenance and option coverage. The qualifier neither reads the 10,000 raw rows nor re-admits source data. Caller evidence, synthetic-contract options and metadata cannot change the registered count. Unknown plan fields, changed selection IDs, unsupported target counts and changed projection bytes refuse qualification.

Every proposed new request, solver/OTD/image work item, cache hit, retry or source budget refuses this retained-only contract. Its computed request, cache-entry and image projections are zero. Permissions, privacy, retention, canonical destinations, finite limits and stop conditions still use the existing checks. Qualification writes no destination files. The existing `fleet-plan.json`, legacy five-WMI/profile branch and separate three-build pilot remain unchanged.

The reviewed selection has 43 VG codes, 26 AG codes, seven raw ranges, 22 paints and 33 upholsteries. All entries retain GB/en-GB, order date 1 November 2026, effect/tax date 5 January 2027 and the literal `RL`. That literal does not prove physical RHD. Body, model names, physical production/VIN/plant/year and the five new-source technical measurement values remain unknown. Historical technical observations and the separate exact 1F7E supplement keep their original scope. Exactly two existing HEROFRONT image associations are declared; broader image fidelity is unknown. No scheme eligibility, availability or physical-car coverage is inferred.

Evidence reused without replay:

- [F60 retained exact-10,000 audit](../../fucq60/exact10000-retained-coverage-2026-11-07/README.md) and its [receipt](../../fucq60/exact10000-retained-coverage-2026-11-07/receipt.json).
- [F60 common-session result receipt](../../fucq60/exact10000-common-session-results-2026-11-07/final-receipt.json).
- [F61 source pilot receipt](../../fucq61/source-pilot10x32-2026-11-07/final-receipt.json).

The focused regression file passed **17/17 tests**, including all 14 legacy cases, source/profile independence, caller injection refusals, shared safety checks and a zero-egress CLI subprocess that corrupts the projected bytes to prove digest refusal. The initial red run had the expected two new failures; an intermediate fixture-text mismatch is recorded. The affected-test selector proposed the full `npm test` fallback because no JavaScript selector exists; reviewed direct callers justified the single qualifier/CLI file instead. No full suite, browser/source replay or UI review ran.

[receipt.json](receipt.json) records code/config/test hashes and every run outcome. Final scoped validation took 0.95 seconds; maximum measured RAM across runs was 217,923,584 bytes. All five owned scratch roots, process groups and reservations are absent; 18,400,800 bytes of allocated scratch were removed. Bounded logs, ownership manifests and the supervisor remain in the ignored task evidence folder; the compact shared impact map is `.claude/test-runs/impact/f58-configuration-only-qualification.json`. No dependency install, compatibility exception or leftover is recorded.

This is configuration-plan readiness evidence. It does not claim F58/F60/F61 acceptance, fresh all-row source verification, corpus activation, publication or new collection authorisation.
