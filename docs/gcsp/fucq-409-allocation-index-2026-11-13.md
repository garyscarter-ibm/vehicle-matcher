# FUCQ-409 allocation lookup delivery — 13 November 2026

Story: `DEV-2026-11-13-GC-002`; branch `dev/DEV-2026-11-13-GC-002`; claim `ef586adf` (3 points). Lead: Charlie Dog, chat `01a1d6cf-fee5-7992-be1d-7d5c6e563a99`.

## Fixed scope and readiness

The four claimed acceptance criteria remain unchanged. The existing `createAllocationService` composition in `server/gcsp/runtime.js` and `prepare()`'s visible `available` pool provide an independent Node interface. Only the stock-row resolution boundary changes: one order-ID index per visible pool, first duplicate wins, direct candidate lookup. Decline history, ranking, policy, recommendation, occupancy, persistence, UI and public interfaces retain their existing implementations. No Java-only evidence satisfies this Story. FUCQ-419/420/424 must coordinate their later allocation edits with this single writer.

Binding context: `AGENTS.md`, `docs/gcsp/demo-brief.md`, `build-rules.md` (Demo delivery and scope control), `experience-quality.md`, `technical-readiness-2026-11-05.md`, `COMPONENTS.md` and `screens/README.md`. The product baseline is `e44ed08a9674d8bf0fe6de2e7195ec3e2d775d38`; FUCQ-434 contracts merged at `f9ade42a`. Jira writes resumed 13 November; equal collaborator authority and the gateway HTTP422 direction apply. Parent handles Jira, worker-ref publication, integration and lifecycle.

## Stable development slices

| ID | Scope | Delivery evidence required |
| --- | --- | --- |
| lookup | Direct lookup and semantic equivalence | Same row/version/provenance/contender order; first-match duplicates; unchanged missing/ambiguous date guard for eligible versus ineligible decisions. |
| operations | Bounded linear lookup proof | Count real index construction and candidate lookups on small synthetic pools; separate other allocator work from this complexity claim. |
| integration | Connected outcomes and independent review | Prescribed modules; connected desktop/narrow release, offer/history, no-match/conflict/replay inspection; independent review and honest remaining acceptance. |

## Selected validation and resource ownership

Changed boundary: `server/gcsp/allocation/index.js`; focused tests `server/test/gcsp-allocation.test.js`, `gcsp-allocation-ownership.test.js`, and a narrowly necessary allocation-index test. Required commands are `node --test --test-concurrency=1 server/test/gcsp-allocation.test.js` and the same command for `gcsp-allocation-ownership.test.js`, plus focused equivalence/operation proof. Connected validation is selected against runtime release/offer/history consumers after code review. No routine full suite: this isolated internal lookup does not alter repository, policy, scoring, public API or UI. Native PostgreSQL evidence is required only for an affected database path; no database implementation changes are planned. Fixture and memory evidence will be named as such.

Run owner: Charlie Dog. Local plan, logs, identity checkpoints and ownership receipts: `/Users/garycarter/Code/GitHub/vehicle-matcher/.claude/test-runs/fucq409/`. Prepared `run.py` wraps the installed `test_resources.py`: manifest outside scratch before allocation, TMPDIR/TMP/TEMP, supervisor/process finalizers, shared host reservations, measured disk/RSS/time, one worker, at most 2 GiB and ten minutes per chunk, five GiB emergency reserve, adaptive reduction near thirty GiB. Any output expected to reach 256 MiB goes directly under `/Users/garycarter/Library/CloudStorage/OneDrive-IBM/Claude/_agent-output/vehicle-matcher/fucq409/`; no corpus copies. Retain concise results and useful failure logs, remove owned scratch/processes and verify absence. The dispatcher owns the final session receipt.

## Evidence and acceptance

Lookup slice implemented and reviewed. Production changes are four added lines and one replacement: build the first-write Map from each employee-visible pool, then replace the candidate find with Map.get after the unchanged eligibility/consent/lapse guard. Date selection and blockers stay inside that original guard. Required modules passed separately for the implementer (23 allocation; 5 ownership) and together at the lead boundary (`lead-lookup`: 28/28, zero skipped, 12.636 seconds, sampled peak RSS 299,384,832 bytes). No full-suite stamp is claimed.

Two focused service regressions preserve hidden-duplicate behavior before and after the visible row, stock version 13 versus hidden version 29, retained revision/provenance, pending retry and completed replay, plus missing/ambiguous dates (0/2 current contracts) with mixed eligible/ineligible stock. The existing recommendation provider rejects two visible duplicate IDs before allocation; the operations slice will test first-match compatibility at the actual source boundary. This is an existing input guard, not a newly introduced refusal.

Initial attempts are retained honestly in `lookup-slice-summary.json`: missing worker `pg` prevented tests from loading; existing root/server dependencies were reused through ignored symlinks. Two test-fixture assumptions then failed (visible duplicates refused upstream; employee IDs returned in stable sorted order); tests were corrected without changing production guards. The first supervisor used one shared log filename and overwrote early verbose output; exact failures are retained in the summary and subsequent logs use per-run directories. All seven lookup-run scratch roots were removed with filesystem receipts and no live owned process groups. Connected inspection, bounded operation counts and independent review remain pending.

## Agents

Charlie Dog requested/selected/effective `gpt-6.1-sol` / `high`, no fallback; title verified saved. Goopy Geer requested/selected `gpt-6.1-sol` / `medium` through `tiers spawn implementer`, no fallback; title verified saved; effective runtime to be independently checked. The same implementer continues the operations slice; a Sam Sheepdog tier reservation was unused, with no agent spawned. One child at a time. No descendants or external messages authorised.
