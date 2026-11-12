# Story status reconciliation — 12 November 2026

Reviewed every native To Do Story in FUCQ: 27 Stories from a complete live query. Also checked FUCQ-405, which was In Progress. The collaborator explicitly authorised status reconciliation and confirmed 405 should be Done. Earlier in this session they confirmed that they and GC had reviewed the User Stories; the accepted successor Stories supply acceptance for the two completed To Do proposals.

Updated **three Stories to Done** and **two to Rejected**:

| Story | Before | After | Evidence and disposition |
| --- | --- | --- | --- |
| FUCQ-405 | In Progress | Done | Explicit collaborator acceptance on 12 November; approved Your cars, presentation polish and Buddy/details merges are documented in docs/gcsp/your-cars-fucq405.md. |
| FUCQ-273 | To Do | Done | The remaining proposal to default reset to Main successful journey is implemented by FUCQ-362 Start again; FUCQ-272 covers focus/principal recovery. FUCQ-362 was accepted with the reviewed Stories on 12 November. See _dev/done/2026-11/DEV-2026-11-10-GC-039.md and blocks/gcsp/presenter-controls/basic-model.js. |
| FUCQ-274 | To Do | Rejected | Superseded by Gary's approved standalone Basic/Advanced console and removal of embedded controls/workspace in accepted FUCQ-360/361. A compact employee-page presenter strip is no longer the agreed architecture. See docs/gcsp/presenter-revamp-spec.md and _dev/done/2026-11/DEV-2026-11-10-GC-038.md. |
| FUCQ-276 | To Do | Done | The remaining proposal for a decision summary at the top is implemented by accepted FUCQ-383/386: the offer has a prominent deadline, summary and decisions before the gallery on narrow screens, with declarations in confirmation drawers. See docs/gcsp/vehicle-offer-stories-2026-11-11.md, docs/gcsp/dev-poller-fucq380-2026-11-11.md and blocks/gcsp/offer/offer-view.js. |
| FUCQ-306 | To Do | Rejected | Superseded by accepted FUCQ-360/361: the embedded presenter workspace/strip was removed and employee/Greg pages no longer import presenter-controls. Its remount/readback-preservation request no longer applies. This does not claim unrelated repeated API reads are fixed. See _dev/done/2026-11/DEV-2026-11-10-GC-038.md. |

The other **23 Stories remain To Do**. Related fixes, shared infrastructure and partial delivery do not close their remaining scope:

| Story | Remaining scope or evidence gap |
| --- | --- |
| FUCQ-255 | The employee scenario still imports and calls rankCars through server/engine.js; the direct shared-core migration and employee/retail parity acceptance are not delivered. |
| FUCQ-281 | Manual review still exposes Change car, Cancel review, Save details and Continue separately. The action-disclosure and single carried reservation-deadline proposal is not fully delivered. |
| FUCQ-283 | Setup still renders separate Save choices and Continue actions. The related copy fixes do not complete this proposal to merge them. |
| FUCQ-294 | The larger demand cohort and proposed dashboard section/rail order remain separate scope; FUCQ-293's privacy-band display fix did not implement this proposal. |
| FUCQ-296 | FUCQ-295 supplies the headline/scale/label repairs. The current process comparison still renders all measures; the proposal to lead with three and fold the remainder is not delivered. |
| FUCQ-298 | FUCQ-297 fixed queue actions, headings and help visibility. The proposed general employee accept/reply remedy flow has no complete delivery record; the existing single-preference confirmation is narrower. |
| FUCQ-305 | Partial improvements have landed: FUCQ-302 records tick time falling from 640.3 to 13.5 ms, and later work compacts allocation/clock readback. The complete requested Tick/Reset event-loop profiling and resolution is not evidenced; retain the remaining scope rather than declare the whole Story accepted. |
| FUCQ-307 | GCSP entry pages still eagerly load multiple journey modules/styles. FUCQ-367's versioned caching/preloads explicitly excluded trimming/restructuring the module graph. |
| FUCQ-320 | The after-demo hatchback retraining/activation hold remains. No delivered artifact and activation-gate evidence establishes the requested hatchback coverage. |
| FUCQ-334 | The console has separate reset, principal-switch and fault Set commands. Its redesign does not supply the single confirmed setup transaction and refined persistence lifetime required here. |
| FUCQ-335 | The standalone console/shared run exists, but audience refresh signals remain same-origin browser storage events. The independent-client refresh/reconnect walkthrough and coverage required by this Story are not complete. |
| FUCQ-336 | Basic Release and Advanced Tick still advance time deliberately. Accepted manual controls do not implement the autonomous rate, lifecycle, pause/reset and ownership/reconnect contract. |
| FUCQ-337 | The accepted offer work explicitly preserves meaningful exact-configuration/high-value option comparisons as this separate unfinished scope; readable definitions alone do not complete it. |
| FUCQ-338 | Configured identity and existing account/history projections are partial foundations. The minimal supported history fields still require refinement, with no complete same-record consistency delivery across profile, Your cars and comparison. |
| FUCQ-339 | Current preview still uses the shared Best match/Recommended badge. Later points-ranking and wider page changes do not record the specifically requested prominence assessment and complete acceptance evidence. |
| FUCQ-340 | The existing decline/change replay is Touring to Saloon. The later presenter spec explicitly retains no SUV for that scenario, so the requested repeatable SUV walkthrough remains outstanding. |
| FUCQ-350 | The larger demand cohort remains explicitly deferred. Releasing more cars does not establish enough employee briefs/offers/declines to clear the privacy bands. |
| FUCQ-352 | The HTML link now has a short View offer label and the greeting is personalised, but the HTML body still opens with GCSP employee vehicle scheme. The complete greeting-first requirement is unmet. |
| FUCQ-353 | Manual setup still renders Save choices and Continue as separate actions; a single Save and continue with the specified validation behavior is not delivered. |
| FUCQ-355 | The manual-route revamp remains deferred. Review still edits contact details and summary repeats them; the requested rows, single contact capture, blocked-card variant and one exit per step are not all delivered. |
| FUCQ-356 | The standalone case queue still mounts directly in main without portalShell/Greg navigation. Existing row Open actions do not satisfy the full shell, column, form-order and date proposal. |
| FUCQ-357 | Shared vehicle typography and the offer decision card are partial reuse. There is no complete adopted single car-summary component across all six named screens, which the revamp explicitly deferred. |
| FUCQ-394 | Explicitly deferred until collaborator prioritisation. The November archive cleanup precedes this remaining-bloat Story and does not complete it. |

The [JSON receipt](story-status-reconciliation-2026-11-12.json) retains all 27 dispositions, supporting paths, five native transitions, individual readbacks and complete final query results. The review basis is repo commit `16d8b35a`. FUCQ-360/361/362/383/386 were among the 104 Stories accepted earlier under the collaborator’s review confirmation; see [that acceptance record](story-review-acceptance-2026-11-12.md).

Final live queries at **12:20:20 UTC on 12 November 2026** verified the expected statuses for all 28 checked Stories, exactly 23 remaining To Do Stories, and zero Stories In Review. The same **163 Bugs remain In Review with unchanged status and update timestamps**. All five status writes returned HTTP 204 and independent readbacks HTTP 200; labels and assignees were preserved. The 23 unchanged Stories also retained their original update timestamps.

Only Story status transitions were authorised here. The wider Jira write pause remains in force. No comments, descriptions, assignments, links or Bugs were changed.

The official product-map importer recorded the five verified statuses. Their source observation time was retained; all unrelated rows and FUCQ-405’s existing slices, worker metadata and branch were preserved. The two unclaimed waiting records for 274 and 306 were retired to `_dev/done/2026-11/` with their original requests intact and explicit rejected dispositions. Exact remote lease lookups found no claims. No public map publication is claimed.

Validation covers paginated Jira reads, status-only guards, independent transition readbacks, preservation checks, JSON/metadata consistency, original queue text and whitespace. No application or test code changed, so no new application suites or browser/visual tests were run. Historical delivery limitations remain historical. No scratch roots, workers, browser profiles, archives or large generated outputs were created; disposable allocation is zero and there are no owned leftovers.
