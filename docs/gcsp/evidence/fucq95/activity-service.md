# FUCQ-95 activity reader checkpoint

The isolated backend implements `createActivityService({ repository, identity, clock }).readActivity(context)` in `server/gcsp/brief/activity.js`. This is a read-only consumer of the existing scoped repository and actual DemoIdentity/DemoClock. No route, composition, producer, component or UI has been added. The whole story remains incomplete.

The projection contains the current employee/run, DemoClock instant/version, latest confirmed `briefVersion` or explicit null, independent saved search/hold permission and pause state, actual offer rows through a field whitelist, and valid completed `brief:changes` events through a separate field whitelist. Two complete scoped reads and final clock/identity checks refuse mixed data. Reads create no command receipt and do not expire, accept, release or otherwise change an offer.

Each offer carries a safe `offerRef: { offerId }`; there is no generated link. Stored offer state, expiry and pinned brief/policy/row versions retain their source meaning. An elapsed expiry timestamp alone never changes the stored state. This checkpoint does not supply the full offer-page hold/pending-operation projection.

`lastSuccessfulCheck` is always null, `searchEvidence` explicitly says `not-recorded` with `search-check-producer-unavailable`, and `sourceStatus` is `evidence-unavailable`. A tick, completed handler, candidate evaluation, command replay or repository timestamp cannot become successful search evidence or source-delay evidence. Coarse state is `no-brief`, `never-searched`, `paused` or `offer`; the offer array carries each actual stored offer state. Invalid own state-change receipts are excluded, with `stateChangesEvidence` reporting incomplete/not-recorded evidence; malformed offers refuse safely.

The missing integration belongs to the real release/search/allocation/offer producers (FUCQ-92/FUCQ-96/FUCQ-100) and their reviewed durable evidence contract. The activity reader needs that producer to establish employee/run/brief-bound successful checks, their actual outcomes and actual source failure/delay. No check stream or substitute schema was invented here. Producer reconciliation, composition/routes, offer access, every search/source state and the activity screen remain integration work.

## Focused verification

Selected changed paths: only the new reader and `server/test/gcsp-activity.test.js`; existing BriefService, identity, clock and repository are read-only boundaries. The focused command was run through the registered supervisor:

```text
python3 -B /Users/usget/Claude/vehicle-matcher/.claude/test-runs/ownership/fucq95-20261105-activity-supervisor.py implementer-activity -- node --test --test-concurrency=1 server/test/gcsp-activity.test.js
```

Final result: 15 passed, zero failures/skips, Node duration 437 ms; supervised wall time 0.491 s, peak recursive RSS 172,408,832 bytes, peak scratch 0 bytes. The receipt reports `removed: true` and `reservationReleased: true`; the supervisor manifest verifies the entire run-owned scratch root absent. Receipt/log are retained under the shared `.claude/test-runs/fucq95-20261105-activity/implementer-activity.{json,log}`. No archive, large output or compatibility exception was created. The parent owns final boundary checks, compact impact-map evidence and dependency-link teardown.

Tests use the actual memory repository, PolicyService, DemoRuntime and BriefService for confirmation/pause/resume/replay/evaluation and actual clock-handler receipts. Explicit synthetic offer rows exercise projection of stored inputs only; they are no evidence of successful search or allocation. Tests also check current-run/employee refusal, privacy, malformed/future/mismatched events, deterministic/reopened reads, no writes, source failure propagation and concurrent brief/offer/receipt/clock refusal.

The first pre-load failure was missing existing `pg`; the parent reused an existing installation through an owned link. It was not an application regression. The subsequent missing-module assertion established the reader was absent before implementation. A fixture missing its required receipt digest was corrected before the final run; no source or dependency code changed.

No browser work was done for this backend-only checkpoint. The screen remains governed by `experience-quality.md`, the shell screenshots and body reference `docs/gcsp/evidence/fucq-6/README.md`, source `a7fc178`, approved by Gary on 5 November 2026.

Implementer requested/selected `gpt-6.1-sol/medium`, no fallback; runtime model/effort confirmed by dispatcher from turn_context. No descendants, commit or push.
