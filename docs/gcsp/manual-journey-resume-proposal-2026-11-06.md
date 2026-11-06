# Resume an existing manual claim through current authority

FUCQ-100 / DEV-2026-11-04-060, 6 November 2026. **Implementation and regression authored under the dispatcher's bounded grant; unexecuted.** This note grants no execution.

The prior delivered source is `9948bff11ed27f847436c6880db035fe8a54a784`, with product adoption at
`f179ae6043414a2b07de3edb2b425338299ea37b`. The dispatcher has published the accepted seven-case
C1/host evidence at `6afa768`; those tests are not repeated. Its host case covers saved setup,
Back and Resume into setup, without an occupying claim. It does not cover account Resume of an
existing quote. The [source inventory](evidence/fucq100/manual-journey-resume-source.json) pins this
diagnosis. No application module, helper, test, browser, listener or resource probe was run for it.

## Diagnosis and originating boundary

This is a code-supported integration defect in the existing account/setup/gallery/review journey,
not new backlog scope. FUCQ-100's `6ef6c5f` composition connects the account event to setup and the
gallery's existing-claim callback to review. The dispatcher routed the missing entry edge from69.
The relationship to FUCQ-100 is established by that owned host code and its accepted host test;
this note neither changes Jira nor takes another story's claim.

Expected walkthrough, requiring a future execution grant: use real local employee preparation,
complete the manual draft through authenticated HTTP, release explicitly labelled TEST stock
through92, and obtain an active cart hold and quote through the actual claim command. Dispose
and remount the account host using the same valid employee session, then choose **Resume saved
journey**. Expected: recover the same server-owned claim for review without saving another draft
or claiming again. The prior source routes the action into a write that the server must refuse.

| Step | Verified source fact |
| --- | --- |
| Account Resume | `gcsp-account.js:294` rereads the draft, requires its context and permitted action to match, then emits `gcsp:journey-start`. It does not read claim authority. |
| Prior host entry | Before this repair, `journey.js:47` routed every accepted account event to setup. Its existing quoted-claim recovery callback could run only after gallery was mounted. |
| Setup Continue | `gcsp-manual-setup.js:148` always calls `controller.save()`. `setup-controller.js:94` sends a new `saveDraft` command even when the complete saved choices are unchanged. |
| Correct refusal | `manual-context/index.js:231` checks actual cart holds inside the transaction; occupying or allocated holds return `release-required` before a draft write. That guard must remain. |
| Why Resume can reach it | `manual-context/index.js:87` deliberately excludes the slot CAS revision from the dependency digest. A claim's revision bump alone does not invalidate an otherwise unchanged saved draft. |
| Existing recovery |69's `createManualClaimController.load()` performs current authenticated claim reads and classifies absence, terminal, occupied, pending and uncertain states. The gallery consumes that controller;100's host already routes a quoted active read to70 review. |
| Review admission |70's controller loads current claim and review details through HTTP. Only explicit review Continue invokes `beginReview`; loading review does not recreate or extend a hold. |

Cause: the account-to-setup entry assumes every resumed journey needs a draft mutation, while the
occupied journey needs claim recovery first. The affected writers/readers are the host entry,
setup save, manual-draft receipt and cart-hold authority, and the existing gallery/review readers.
There is no evidence of corrupted saved rows or a need to migrate data/cache. This diagnosis is
static; no failed user interaction was executed in this authoring step.

## Decided: authorised bounded repair

The dispatcher approved the host preflight, dedicated actual-authority regression and planning
evidence, plus minimal real-claim-reader amendments to the two affected existing host fixtures.
Only authoring and static inspection are granted. No test/helper execution, Node syntax check,
resource probe, ledger access, scratch, browser/native or full run is granted. The dispatcher
retains69 interface coordination, shared map/Jira/claim and execution-admission decisions.

Change the100-owned host entry in `blocks/gcsp/manual-setup/journey.js`. Reuse69's existing
`createManualClaimController` and `createManualGalleryHttpAdapter` as a short-lived entry reader.
Call only `load()` with no selection, command or unresolved attempt. Its authenticated GET follows
the existing server reconciliation contract; it does not issue a claim POST.

After the account event returns, enter one owned checking generation using the existing employee
shell and shared status presentation. Show **Checking your saved journey** and prevent competing
entry actions. Defer disposal of the emitting account controller as the host already does for
other callbacks. A new mount or host disposal destroys the entry reader; its abort signal and
generation check prevent late responses from mounting another screen.

| Existing normalized claim-controller state | Authored host transition |
| --- | --- |
| `ready`, from actual `not-found` | Mount ordinary setup with the account's hint. Setup still rereads current account/draft and keeps its existing save/availability gate. |
| `released`, from the controller's checked terminal hold/quote projection | Mount ordinary setup. This also covers the controller's verified expired/claim-failed cases; the host does not invent a second terminal-state validator. |
| `existing-claim` | Mount the existing gallery recovery entry. Its fresh claim read may then invoke the existing quoted-active callback into review. Allocated state remains blocked; no allocation/submission is invoked. |
| `pending`, `uncertain`, unexpected state or read failure | Mount the existing blocked gallery recovery surface and its explicit Check status action. Never infer absence, save a draft or replay a claim POST. |

The first read selects a recovery surface; it is not a handoff descriptor or review authorisation.
Gallery and review must reread current authority. An expiry, release, principal switch or reset
between reads is handled by those ordinary guarded readers, not by replaying the first envelope.
Account event fields remain hints. No quote/hold identity comes from browser storage or an old
selection. Keep one mounted generation and dispose each controller once.

Do not route straight from the account event to review or manufacture `gcsp:setup-ready`.
Do not relax the hold guard, suppress `release-required`, alter draft versions, or extend quote
expiry. No account, setup, gallery, review, service, policy, identity or96 allocator edit is
authorised. Keeping setup's save semantics preserves its separate Save/Back contract.

The checking view uses the shared employee shell and status primitive. Each mounted generation
owns a MutationObserver that focuses its first main heading and then disconnects; transition and
host disposal also disconnect it. The original teardown function remains intact, including live
controller getters, gallery/claim properties and refresh methods. Clock callbacks still use those
original methods; disposal fences delayed reads and retained clock callbacks.

## Exact authorised paths and ownership

| Path | Responsibility |
| --- | --- |
| `blocks/gcsp/manual-setup/journey.js` |100 owns the central entry and controller lifecycle; sole product edit. |
| `server/test/gcsp-manual-journey-resume.test.js` | New100 regression for real account Resume after a persisted claim; no import of an existing test file or rerun of the seven accepted cases. |
| `server/test/gcsp-runtime-composition.test.js` | Only the account/setup/Back/Resume host fixture gains an authenticated HTTP-backed `readClaim`; assertions and the other six cases remain unchanged. |
| `server/test/gcsp-manual-setup-render.test.js` | Only journey mounting gains the actual `runtime.manualClaims.readClaim(context)` port; standalone setup cases and assertions remain unchanged. |
| This note, its source inventory and the existing100 story note | Diagnosis, scope, static inventory and proposed validation only. |

69 owns the claim controller/HTTP adapter/gallery contracts consumed here.70 owns review. The
dispatcher coordinates their agreement and any conflicting file ownership.
The repair requires no changes to those modules. If their current delivered interfaces differ
from the inventory, compare and refreeze the proposal first. A helper/catalogue for future tests
is separate execution admission work; the accepted seven-case catalogue remains unchanged.

## Acceptance and affected validation plan

The positive regression must use actual `createLocalSession()`, authenticated handler adapters,
an actual complete draft, the labelled run-bound TEST provider through92 and the actual manual
claim command. No direct repository stock/hold/quote insertion, fixture-only setup-ready event,
fake successful claim DTO or synthetic direct-review entry proves the repair. Reuse the pinned
TEST profile as input only; this remains outside F77/F78/default-reset business acceptance.

Five new cases are authored and unexecuted. They cover actual quoted-claim remount/repeat Resume
through default HTTP adapters; actual no-claim setup/Back/save/Resume through supplied HTTP adapters;
an actual released claim; controlled unavailable GET followed by Check status recovery of real
authority; and disposal during delayed delivery of an actual claim GET, including stale clock
callbacks. Review checks require the enabled Continue control, editable contact field, pinned
TEST car/order/quote/expiry details and one main region. No automatic review Continue is invoked.

The full intended acceptance still includes:

1. Reload/remount with an actual active quoted cart hold. Click the real account Resume control;
   reach current review through claim recovery, preserve hold/quote/draft/current-car identity and
   expiry, and record zero new draft-save, claim or begin-review POSTs during recovery. Explicit
   later review Continue keeps its existing command contract.
2. No claim and a server-verified terminal claim retain ordinary setup entry. Continue still
   requires a real complete save and current availability. This covers the affected branch of
   the accepted setup/Back behavior by selecting only its affected host case.
3. A real pending remote-shaped operation and controlled read unavailability remain blocked in
   recovery, with Check status and no save/claim replay. Controlled transport conditions are
   labelled; they do not stand in for the positive persisted-claim proof.
4. Dispose or supersede an entry while delivery of a real HTTP read is delayed. No late screen,
   old-run identity or duplicate mount/POST appears; the entry request is aborted/disposed.
5. Expiry/release and a real stale session between entry and recovery are reflected by the next
   actual guarded read. No stale quote becomes active and no96 allocation is invoked.

Use `docs/gcsp/experience-quality.md`, the supplied shell references in `docs/gcsp/screens/README.md`,
the shared Density theme and `COMPONENTS.md`. Reuse the existing shell, status and button primitives.
The visible outcome is a usable Resume action instead of an unavoidable release-before-change
failure. Pending/loading/refused states need truthful copy and an accessible recovery action.
Verify keyboard Resume/Check status, visible focus after transitions, meaningful loading status,
desktop and narrow layouts and actual rendered review. Browser/visual proof and the applicable
UI-ratchet check need their own bounded admission; none is claimed here.

Actual pending remote operations, allocated claims, expiry between reads, stale identity/reset
between reads and a superseding live generation are not yet exercised by the authored five-case
regression. Their routing is statically delegated to the existing controller/gallery/review guards.
The unavailable transport condition and delayed-response gate are explicitly test controls; they
do not establish live pending/allocated/reset integration acceptance.

The [source/selection/resource inventory](evidence/fucq100/manual-journey-resume-source.json)
freezes the current ordinary graph, installed inventory reference, actual inputs and exact seven
selected titles (five new and two affected existing host cases). It is a static planning record.
No future launcher or grant is supplied by it. Existing seven-case helpers bind the old catalogue
and changed source postimages; they must not be run against these edits. A separately reviewed
launcher/guard catalogue must bind this graph and selection before admission.
The previous grant was consumed; it authorises no retry or changed-source run. Provisional sizing
may use the accepted run's15.9s/406536192B aggregate RSS/1433600B scratch, but new-case timing and
coverage remain unmeasured. Required native/full/default-reset/rendered integration gates remain
open. No Jira status, claim, acceptance checkbox or development-complete state is changed here.

## Dispatcher and product-map handoff

This belongs to the existing FUCQ-100/69 journey integration work. The shared product map currently
records FUCQ-100 In Progress with observation `2026-11-05T23:00:25Z`; that tracker observation is
not refreshed by this proposal. Root owns shared map/Jira/claims and publishing. Record this
remaining integration edge through `_tools/product_map.py` under the agreed slice plan, retaining
observation times and worker expiry. The accepted scoped seven-case evidence does not establish
this slice complete or the full story accepted. No shared map file is edited from this bounded
worktree.

Next: dispatcher review of the authored implementation, seven-title selection and current finite
closure, with69 interface coordination. Runtime verification needs a separate current launcher,
review and grant. No execution or acceptance result is inferred from this publication.
