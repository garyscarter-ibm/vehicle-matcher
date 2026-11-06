# Author-only diagnosis and repair after the failed entry

6 November 2026. **No repaired application, launcher, supervisor or resource
adapter has been executed or imported.** The original 8/11 failure and
stop-first-failure deviation remain in [the original receipt](followup-entry-result.md).
Dispatcher direction authorises this minimal source repair; no new execution grant
exists. The originating work is FUCQ-102 / DEV-2026-11-04-061, with the actual
100/106 producer and 107 consumer boundaries named below. Jira/claims/acceptance
remain with the dispatcher.

## Diagnosis

Reproduction: original once-run `followup-9d6eec0b291741f1ba7fa06a4586a751`,
exact plan/admission at harness `da78f25`, returned `followup:null` for three real
producer/decline cases. The symptom and assertion output are retained unchanged.

Source-confirmed cause: `seedManualDemoContext` writes the renewal into the
entitlement slot. The real identity principal/context has no renewal field;
`BriefService` stores its null/absent value in confirmed history. Actual 100's
`buddy-hold.js` at `a7fc8580` resolves `brief ?? slot ?? employee`; actual 106's
`decision.js` at `5ce74f94` validates the same fallback and copies the resulting
hold renewal into the native completed event. Access incorrectly required the
historical brief alone to contain that renewal. No receipt or producer data needs
repair. This explains the final history gate's rejection; corrected runtime
behaviour remains unproved.

Affected writers/readers: unchanged real manual seed, identity, BriefService,
100 producer and 106 decline; owned 102 follow-up lookup and revised regression
cases; 107's separately owned `#prepare` gate. There is no data/cache migration,
history update or identity conversion in this repair.

Independent review also confirmed 107 at `16839323` compares the native renewal
to the ordinary context's unpopulated renewal. Access repair alone therefore
cannot complete the real employee question/confirmation case. The dispatcher
routes that repair to 107's lead. The positive case is retained intact; no forged
context, altered seed, extra authority or weakened expectation hides this gap.

Harness cause: Node's direct test import emitted spec text while the parent
searched for TAP. The original process consequently executed all eleven cases
and retained empty structured counts. This is a separate harness defect.

The reviewer corrected the earlier harness static PASS to HOLD after identifying
`stop_join` persistence before direct-handle shutdown. A persistent manifest write
failure could bypass the later terminate/kill/wait fallback. Root independently
audited the already-exited original run and passed its actual cleanup; that result
does not exercise this exceptional edge.

## Minimal owned change

102 now reads the exact persisted entitlement slot, validates run, employee,
slot ID, decision-pinned slot revision and the already-validated hold/event renewal.
Null/absent historical renewal means unpopulated. Every explicit historical or
slot renewal conflict/malformed value still refuses a handle. The slot row's full
content digest, status and revision are reread with the historical brief and native
sources. Repository failure stays retryable `unavailable`; consistently absent or
invalid source stays declined with null handle. Existing owner/run, receipt digest,
policy, outcome revisions, quote, clocks and car-reuse guards remain intact.

The eleven assertion callbacks now register into an immutable list. The owned
launcher verifies exact names/order, invokes one callback at a time and awaits its
cleanup hooks. It emits its own bounded TAP. On any assertion or cleanup failure it
breaks before invoking the next callback, sets nonzero exit and reports only reached
cases. The parent's TAP failure detection remains a second stop boundary. No
`node:test` reporter or scheduling behavior controls the boundary.

`stop_join` now handles the direct child before any probe or persistence in its
exception fallback. Descendant shutdown still requires a fresh exact PID/start
match. Snapshot/persistence errors remain recorded in memory and re-raised, so
they never authorise scratch deletion or reservation release. Temporary handled
cancellation deferral covers the fallback, including a finally path if installing
handlers fails. Finalizer cancellation handlers precede its attempted latch; a
cached incomplete result exists before the latch, and terminal manifest-write
failure becomes an explicit failed receipt. This is source review, not an injected
failure/cancellation test. A successful future ordinary run alone would not prove
those exceptional paths.

Fresh strict budget admission telemetry is now written to the ownership manifest
after reservation readback and before allocation/launch; no new headroom claim is
backfilled into the original run.

## Validation target and next gate

The same eleven cases retain the real positive reload/question/confirmation and
historical/quoted-brief expectations. Existing negative variants now include slot
owner/renewal/revision/missing/malformed source, explicit bad historical renewal,
slot repository failure, and slot content/revision races. All reads must preserve
the state digest. Real identity and the explicit injected 107 question input remain
unchanged. This does not establish canonical default question registration.

Only static Python AST parsing, literal source/graph inspection, immutable Git
readback and whitespace checks are selected for authoring. No JavaScript or custom
helper is imported, no supervisor/plan/test/probe runs and no test resource is
allocated. The physical freezer only reads existing file identities and authors
admission JSON; it does not import the runtime helpers.

Before execution: obtain 107's repaired immutable source, update the combined
source plan, independently review the application/registry/launcher/TAP parser and
resource lifecycle changes, then obtain a fresh exact admission/grant and strict
HostBudget check. Proposed execution remains one 120-second chunk, 768 MiB
aggregate RAM, 128 MiB combined allocation, 2 MiB log, one worker, 5 GiB disk and
512 MiB RAM reserves. Preserve the first failure; no automatic retry/repair.
Cancellation and persistent-write failure injection require separate explicitly
selected review/grant; they have not been added to the eleven service cases.

105/client/host, deployed/browser/remote/native database/full-suite and final
acceptance gates remain open. This evidence-only authoring change needs no new
screen rendering; the existing visual contract still governs eventual integration.

Agents: Hugo, requested/selected `gpt-6.1-sol` / `high`, no fallback or descendants.
