# To Do Bug deprecation review — 12 November 2026

Requested by a collaborator: “Check the backlog for deprecated bugs in To Do. For example I can see 250 has been solved by another story already. Move anything deprecated to Rejected.” This directly authorises the specific deprecation transitions below. The wider 11 November Jira write pause remains in force; no other issue updates, acceptance transitions, assignments or pollers are authorised by this review.

Live Jira query: `project = FUCQ AND issuetype = Bug AND status = "To Do" ORDER BY key ASC`. All 24 results were returned in one complete page. The completed/developed work lookup was also paged to completion. Native Rejected is configured directly; no fallback Done status or label change is needed.

Review basis: `gcsp-poc` at `3b6e51f109ce8d7161a1f7fc5645e2a76801ee7d`, after fetching and fast-forwarding the current integration branch. Pre-existing local changes were preserved. Read the original reports, replacement work, current consumers and retained delivery/validation evidence. A merged fix alone does not establish collaborator acceptance or justify rejecting a still-needed verification task.

## Rejected as deprecated

These are redundant repair requests or requirements superseded by later collaborator-approved designs. Rejecting them does not mark the replacement work accepted or Done.

| Bug | Replacement and evidence | Disposition |
| --- | --- | --- |
| FUCQ-250 — missing vehicle images throughout the journey | FUCQ-323 supplies complete supported image coverage, retained fallback and model/derivative presentation. Its [delivery record](evidence/fucq323/README.md) includes scoped integration, independent desktop/narrow review and successful deployed image checks. The old representative-caption requirement was separately superseded by FUCQ-373. | Rejected, read back verified |
| FUCQ-324 — separate presenter controls from the employee journey | FUCQ-360/361 deliver the standalone console and remove embedded controls. FUCQ-322 supplies separate employee/control authority. The old overlay/strip repair is redundant against this composition. | Rejected, read back verified |
| FUCQ-325 — connect separate profile/preferences/activity/recommendations pages | FUCQ-368 embeds preferences in Your cars; FUCQ-397 embeds Buddy controls/history and deliberately removes Activity navigation; FUCQ-375 and FUCQ-405 expose offer notifications and onward links. The [approved composition](buddy-allocation-build-2026-11-11.md) and [approved Your cars integration](your-cars-fucq405.md) supersede the older page-linking proposal. | Rejected, read back verified |
| FUCQ-327 — residual Your cars hierarchy/allowance/points | FUCQ-359 and FUCQ-405 replace the composition with the approved large-car presentation, concise account/points facts and consistent controls, with subsequent approved presentation polish. See [delivery and integration evidence](your-cars-fucq405.md). | Rejected, read back verified |
| FUCQ-330 — preference value versus importance | FUCQ-368 replaces the old editor with named category panels, explicit selected values and a separate importance switch. An unset category disables importance with “Choose a preference first”; save/readback preserves both. FUCQ-369/405 retain this contract through Same again/custom modes. | Rejected, read back verified |
| FUCQ-331 — saved preference readback between clients | FUCQ-322 supplies durable user/run context; FUCQ-368 reads canonical saved values through the authenticated editor GET and autosave route. The later [370/371 repair](fucq370371-repair-2026-11-11.md) also adopts rating/Same-again remote changes when categories are unchanged. Existing real-HTTP fresh-controller/stale-reload regressions verify current readback. This disposition concerns refresh/reopen after save, not a new promise of instantaneous cross-device updates. | Rejected, read back verified |
| FUCQ-399 — generated stock lacks acceleration/economy | The [370/371 corrective work](fucq370371-repair-2026-11-11.md), merged as `7b4f724d` and `68117f4f`, adds [documented model reference facts](stock-model-facts-2026-11-11.md) and safely upgrades eligible retained snapshots. Existing regressions cover generated positive-rating Sportiness/Economy improvements and protection of occupied/frozen/historical data. Missing evidence remains unknown and EV MPG remains absent. | Rejected, read back verified |

## Keep in To Do

| Bug | Reason retained |
| --- | --- |
| FUCQ-266 | Closing a case still requires `nextAction` and a future `dueAt` in `cases/index.js`; the separate closed-case wording fixes do not remove that requirement. |
| FUCQ-329 | The retained brief preview still iterates every decision and renders non-eligible entries as `previewTile`; no verified exclusion repair. |
| FUCQ-344 | Painted-copy presenter fixtures still call `controls.readCatalogue` and retain the recorded hidden-control coverage flaw. |
| FUCQ-349 | Manual-review/summary `matchCard` callers still omit the heading-level override; the media repair does not repair heading semantics. |
| FUCQ-376 | The recorded synchronous corpus-validation startup stall has no verified responsiveness repair. The test harness stub is a workaround. |
| FUCQ-377 | Greg plan presentation still constructs model/derivative names from production fields; the canonical display-name repair remains separate. |
| FUCQ-387 | Presenter console CSS cap failure remains explicitly recorded in the latest integrated checks; a separate shrinking cap was addressed, but the Bug is not wholly obsolete. |
| FUCQ-388 | The declined exact-car re-entry rule still lifts exclusion after a relevant confirmed brief change. Missing-fact/feedback repairs do not resolve its reason-specific re-entry policy. |
| FUCQ-391 | Offer shell Retry still has no supplied account-reload callback; later offer layout work does not establish recovery. |
| FUCQ-392 | Its diagnostic implementation exists, but the issue also retains unresolved intermittent artifact admission/build evidence; it is not a duplicate of a later accepted repair. |
| FUCQ-393 | Merged disconnect/memory countermeasures and later startup successes are recorded. The original issue explicitly retains managed recovery/rollout evidence and must not be rejected merely from integration. |
| FUCQ-395 | Native ordering process-readback/helper mismatch remains outstanding in the subsequent native validation evidence. |
| FUCQ-396 | Its own merged build-policy composition fix has scoped proof; the issue explicitly retains live verification. This review does not convert that acceptance obligation to rejection. |
| FUCQ-400 | Narrow Presenter header overlap remains independently recorded; desktop-primary operation does not obsolete the narrow-screen defect. |
| FUCQ-401 | Buddy history still projects offer `createdAt` alongside DemoClock events; no verified common-time-basis repair. |
| FUCQ-404 | The manual-review rail regression still targets the removed Activity control; the later navigation is intentional but the test needs repair. |
| FUCQ-406 | The two feedback-baseline preview fixtures remain separately recorded as failing; UI polish did not repair them. |

## Proportionate validation plan

No product implementation changes. Repository changes are confined to this review, its compact receipt, and reconciliation of the local queue and product-map metadata. The affected selector is Python-only; reviewed explicit JavaScript boundary commands are used instead of a full-suite fallback. A dry-run inspected the chosen UI command before execution.

Run identity: `backlog-deprecation-20261112`. One worker; three independent scoped chunks, each expected below 64 MiB scratch, 1 GiB RSS and two minutes. All generated output is small. The existing test-stamp supervisor creates an absolute run-owned scratch root, writes its ownership manifest outside that root, propagates TMPDIR/TMP/TEMP, bounds/join children and removes scratch in its finalizer. Retain concise result, code/test identity and cleanup receipts in shared `.claude/test-runs/`; no archive or large artifact is planned.

1. UI/current-composition boundaries: `gcsp-category-preferences`, `gcsp-account-preferences-controller`, `gcsp-account-preferences-mount`, `gcsp-shell-navigation`, `gcsp-presenter-console`.
2. Canonical HTTP/fresh-client readback: the two named `gcsp-account-preferences` tests for authenticated draft/editor readback and browser transport/controller readback.
3. Generated/retained facts: `gcsp-run-stock` and `gcsp-retained-model-facts`.

Matching/solver qualification, native PostgreSQL, full corpus downloads, live shared-state mutation and the full suite are excluded. Existing replacement-story visual reviews are read as historical evidence; this audit makes no new product UI changes or new full visual-conformance claim. Findings retained above are not described as freshly fixed or freshly passing.

## Result

All seven candidates were still unchanged To Do Bugs immediately before writing. Each discovered transition targeted native Rejected (transition 2), returned HTTP204 and was independently read back as Rejected with HTTP200. Labels, assignments, descriptions and links were preserved. No Jira comments or unrelated writes were made. The final complete live query returned exactly the original set minus these seven: **17 To Do Bugs**. The [bounded receipt](backlog-deprecation-review-2026-11-12.json) records each transition and replacement.

Scoped checks at the reviewed code identity: **152 passed, zero failed/skipped** — 130 UI/controller/navigation/console checks (3.3s), two authenticated HTTP/fresh-client readback checks (0.8s), and 20 generated/retained stock checks (67.8s). No application or test code changed during the audit. Full-suite and new managed/deployed/browser checks remain excluded as planned.

The five existing unclaimed local waiting records (GC-005/006/008/011/012) were retired to `_dev/done/2026-11/` with explicit `closed: 2026-11-12 rejected` and a disposition; their original acceptance criteria were preserved. No active story lease existed. Product-map import recorded all seven native Rejected observations while preserving every unrelated row and existing slice/worker data. This records repository facts; it does not claim a newly served public map.

All three supervisor-owned roots under `/private/tmp/test-stamp-shard-` were removed and their absence rechecked. Measured disposable allocation removed: **9,020,992 bytes (8.6 MiB)**; no compatibility exception, large/cloud output or leftovers. Peak process RSS was **1,480,785,920 bytes (1.38 GiB)** in the stock chunk, above its initial 1GiB estimate; it completed in 67.8s with one worker. Ownership manifests are `6a6923c9267441e88cd6175a29e6abb7`, `613b4940189849d3abb81687825b13a7` and `1f449167706047a8bb97a6d338cf39ca` in shared `.claude/test-runs/ownership/`. Compact source/test impact, timings and final cleanup evidence are retained under `.claude/test-runs/impact/` for run `backlog-deprecation-20261112`.
