# Author-only diagnosis and repair after the failed entry

Current authoring release: the [combined candidate](followup-entry-combined-plan.md)
adopts reviewed 107 service `17e7fe1` and clears the earlier source hold. The
historical hold states below remain part of the repair record. Combined static
review and a new execution grant remain required; no repaired test has run.

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
slot ID, positive current slot revision at least the decision's historical pin,
and the already-validated hold/event renewal. Null/absent historical renewal means
unpopulated; null/absent slot renewal uses the verified persisted hold/event
binding, preserving the existing all-null case without inventing an identity.
Every explicit historical or slot renewal conflict/malformed value still refuses
a handle. The slot row's full
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

Review of immutable `b3079eb` found the first repair was too strict: equality to
the historical slot revision also rejected a compatible later revision. The
correction uses a positive lower bound, adds an actual repository CAS with
unchanged authority as a positive control, and keeps a backward revision negative.
It also exercises a later null slot renewal with the unchanged verified hold/event
binding. The original setup, genuine identity, seed and positive 107 expectations
remain intact. No corrected service case has been run.

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

## Held candidate freeze

Owned application/test bytes are pinned at `848a16f8ceda2053e5441ded4ce0c5378df5b30f`.
The original repair was published at `b3079eb`, a malformed-null-row guard at
`4474938`, and the compatible-revision/nullable-slot correction at `848a16f`. The candidate remains 44
modules, 121 literal import occurrences (118 unique edges), seven data files and eleven assertion cases.
Source-plan SHA-256:
`24e43347b31c9e1557a89b6172bc05f333c3b7bf1884f576b0a14f60798755f6`.
Physical-admission SHA-256:
`8d7fce9b848e811948b545d7c0ad83f6033c9779e7920acab98af82f9b962913`.

Static readback matched 51 immutable source/data blobs, 193 physical identities
and 38 absent resolution candidates, with 14 existing packages and five lock files.
Python AST parsing and the exact eleven declared names passed. These are authoring
checks, not runtime or service proof. The candidate explicitly carries the old
107 integration blocker. The supervisor checks that hold before importing custom
helpers, and refuses even its plan mode until a new combined freeze removes it.
No execution command is proposed for this held candidate.

Subsequent dispatcher review keeps the published 107 candidate `4b91d4b` on
HOLD: it checks a positive current slot revision but omits the decision's positive
historical slot pin and its lower-bound comparison. Its other nullable-renewal
and slot-reread changes passed that scoped static review. The dispatcher retained
the scoped static PASS for the unchanged `b3079eb` runner/direct-join cleanup
delta. Await 107's corrected reviewed immutable pin before combined adoption; the
freeze's earlier review-pending metadata is a historical snapshot, not approval.
No fresh execution follows from either static result.

105/client/host, deployed/browser/remote/native database/full-suite and final
acceptance gates remain open. This evidence-only authoring change needs no new
screen rendering; the existing visual contract still governs eventual integration.

Agents: Hugo, requested/selected `gpt-6.1-sol` / `high`, no fallback or descendants.
