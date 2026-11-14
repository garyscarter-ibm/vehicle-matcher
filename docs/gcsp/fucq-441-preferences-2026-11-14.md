# FUCQ-441 preferences delivery checkpoint

Native Story: FUCQ-441 / DEV-2026-11-13-009, 8 points. Lead chat:
`01a1d771-04c7-7810-9f87-4cf69d3701b6` (Mike Wazowski). This record does not
establish acceptance. Both native acceptance criteria remain open until the actual
Java/OIDC/PostgreSQL journey and required experience checks pass.

## Contract and ownership

The immutable product baseline is `e44ed08a9674d8bf0fe6de2e7195ec3e2d775d38`.
Preserve `server/gcsp/brief/http.js`, `editor.js`, `index.js` and the existing
Account/full-editor semantics, with the published `/api/gcsp/v1/brief/*` method and
semantic suffix replacement. The old `/pause` and `/resume` aliases are excluded.
Java FUCQ-460/461 owns validation, calculations and persistence; the browser sends
supported edits and expected versions and presents server outcomes.

Readiness follows the actual published source contract, independently of native
dependency status. The worker owns `apps/gcsp-web/src/app/preferences/**`, this
record, its Story and FUCQ-441's durable map row. The dispatcher serializes base
sync, shared-file release, publication and integration into `gcsp-poc-dev`.
Account, auth, shell, root build/configuration, Java and Node business code remain
with their named owners. No native lifecycle or Jira changes are made here.

Dispatcher sync completed at `2cc64f47ebf6140f604af8acec2631da44bda39b`, based on
published dev `0134d07bcf6dcbea295dcc85a5513fe5c7ab2216`, including FUCQ-440.
The dispatcher verified all 301 foreign map rows, this Story's exact row and the
untracked note. Routes, additive Angular kit and COMPONENTS lanes were released;
`account/**` stays reserved. The API child was explicitly interrupted before the
sync and resumed with the same identity after release. No test had run or allocated
resources before that interruption.

## Stable delivery slices

1. `api-client`: typed editor/input/result contracts and the bearer API client.
2. `editor-feedback`: native Angular preference, importance/indifference, practical
   requirements and current-car feedback controls, with preview/save/confirmation.
3. `engagement`: native Buddy engagement/search controls and truthful recovery.
4. `native-integration`: actual Java, OIDC and native PostgreSQL replay, reload and
   restart; rendered desktop/narrow, keyboard, Safari/private, accessibility,
   reduced motion and hosted evidence. Fixture tests cannot complete this slice.

The verified existing product component is `brief` (Employee brief and buddy
activity). No product boundary is introduced. Shared primitive decisions follow
COMPONENTS.md, the experience contract and the approved account/preferences body
reference at `193cbf078fe83572d3e0ab150c02a0e8b0d3dbc5`; later frozen source
details govern Same again, Buddy and current-car choices.

Component plan: reuse ButtonDirective, ScreenIntroComponent, StatusScreenComponent,
LabelledFieldComponent and ErrorSummaryComponent. Adapt the existing compact
category, switch, input-completeness meter, rating and preference-control semantics
into native Angular presenters, with shared gallery/catalogue coverage. The full
editor retains server preview and draft/confirm; Account retains compact autosave.
No legacy controller or Node business module is embedded in production Angular.

## Validation and resources

Select scoped API, state and component regressions first; run Angular AOT/boundary
checks for the actual new application paths. Reuse the existing preference,
feedback, engagement and stale/unavailable scenarios. No broad server/retail suite
or new generic validation framework is justified by this isolated client change.
The actual Java producer, native transaction/restart, real sign-in and hosted
checks remain separately identified if unavailable.

Run receipts and impact evidence are under the parent-local
`.claude/test-runs/fucq441/`. Each allocation has an external ownership manifest,
supervisor finalizer and exact scratch/process cleanup. Initial limit: one worker,
2 GiB scratch and ten-minute chunks; keep a 5 GiB emergency reserve and adapt near
30 GiB free. Outputs expected above 256 MiB go directly under
`/Users/garycarter/Library/CloudStorage/OneDrive-IBM/_agent-output/vehicle-matcher/fucq441`.
The lead checks process and filesystem teardown independently.

## Known separate findings

- Medium FUCQ-487: inherited global `.gcsp a` specificity can render primary
  anchor labels teal on teal. No repair is authorized in this Story.
- Medium FUCQ-488: inherited fresh-start after discard loses the retained draft
  CAS version. Source-proved, not executed through Java. No repair or acceptance
  waiver is authorized in this Story.

Other defects follow `docs/gcsp/build-rules.md`, Demo delivery and scope control:
below High goes to the dispatcher for a linked independent backlog Bug; Critical
or High requires active triage or an explicit collaborator deferral. An unmet
original criterion remains an original obligation.

## Agent and environment evidence

Gateway check passed: `api.servicesessentials.ibm.com` is under `ibm.com`.
Lead title saved as Mike Wazowski. Parent independently verified Sol/high runtime.
API mechanic Cogsworth requested/selected `gpt-6-luna` / `high`, no fallback;
its `turn_context` at `2026-11-14T00:26:39Z` independently confirms those values
and parent chat identity. Final validation evidence is pending review.

The saved child title was independently read back as Cogsworth. Reusable pinned
dependencies/runtime are owned by the FUCQ-439 worktree
`DEV-2026-11-13-007/apps/gcsp-web/{node_modules,.tools/node/bin}`. FUCQ-441 borrows
them only through a manifest-owned temporary symlink, with inode preservation and
matching-link removal verified after every chunk; it installs no second copy.

Jira writes resumed on 13 November 2026. All collaborators have equal authority;
administrative owner metadata does not elevate approval authority. Preserve exact
child-only false HTTP 422 diagnostics and continue while the launcher can work,
without gateway or credential changes.

## Reviewed API-client checkpoint

The native client now covers all four reads and nine supported POST suffixes,
source-shaped versioned inputs, bearer authentication, authority-field rejection,
truthful stale/pending/invalid outcomes and no automatic POST replay after 401.
Cogsworth finished its three-file slice; the lead reviewed the contracts and
callers against the existing editor/service source. Nested projection validation
remains an explicit responsibility before native presenters consume those fields.

Scoped command: `npm --prefix apps/gcsp-web test -- --include=src/app/preferences/brief.client.spec.ts`.
Attempt 01 failed compilation (predicate typing and a test property access).
Attempt 02 compiled and ran 5/6, exposing an unbound validator method.
Attempt 03 passed 6/6 after top-level validator correction. All attempts remain at
`.claude/test-runs/fucq441/api-client/`; this is no full stamp or Java acceptance.
The lead independently matched the receipt source hashes and verified scratch and
owned link absence plus preserved dependency/runtime device and inode identities.
Passing run: 3.6 seconds, peak RSS 938,655,744 bytes; peak scratch 9,961,696 bytes.

## Native editor implementation

Road Runner was selected from fresh `tiers spawn implementer` output, requested
and selected `gpt-6.1-sol` / `medium`, no fallback. The lead independently read
its runtime `turn_context` and saved Road Runner title at child chat
`01a1d781-eeab-78b1-891f-8cff3f3a5d7a`. Fresh capacity allowed three launches;
this lead launched only one child. The complex native editor is not a fully
specified mechanical slice, so the implementer route applies at night.

The native slice owns a shared auth/run/employee-scoped store, compact Account
exports, full preferences controls, source-backed preview and draft/confirm,
plus released additive kit/gallery/catalogue and route lanes. Account files stay
reserved. Buddy command controls follow as their stable separate slice.
The dispatcher guarded-published the API checkpoint
`4322b24e408600d881f909a9791627af3cd62968` and independently verified its three
resource receipts/source identities; parent receipt is
`.claude/fucq441-parent-resource-api-client.json`. No application sync is needed
for the reported disjoint allocation/clock/repository/claim changes.

## Reviewed native editor checkpoint

Road Runner delivered the native shared editor store, compact Account preferences
and contract-gated current-car rating, full preferences screen, source preview,
additive category/rating kit presenters and gallery/catalogue, plus guarded lazy
route. No Account owner file changed. Current-car preserve/change feedback is
retained and read back; the source has no additional feedback editing controls.
The shared store clears on trusted subject/environment/run/employee changes,
cancels requests and checks captured context before sending, coalesces supported
edits and versions, and retains explicit retry IDs. Full save retains partial draft
success separately from confirmation and readback success/failure.

The lead reviewed all 20 changed/new files, source service/callers and selected
checks. Review found and returned original-scope gaps: preview media/line/allowance/
units/check grouping/unknown count, adoption of newer final-readback versions, and
hidden readback failure copy. The same implementer corrected these, preserving
source order and exact supplied display fields without suitability calculations.
Clean readback now adopts authoritative versions/content/consent; concurrent local
edits survive and require explicit refresh when readback has advanced.

Prior scoped run: client 10, store 13, components 6, all passing (29/29).
The initial compiler failure and successful iteration receipts remain retained.
Correction command: `npm --prefix apps/gcsp-web test -- --include=src/app/preferences/brief-editor.store.spec.ts --include=src/app/preferences/preferences.component.spec.ts`.
Revision 1 ran 24/25; a new assertion expected different source copy. Revision 2
passed 25/25; final copy review prompted a further warning regression. Revision 3
passed 25/25 (store 16, components 9), with `git diff --check` passing.
The client source/tests/validators are unchanged since their separate 10/10 pass;
its fixture functions match their earlier hash after normalizing the type-only
BriefPreview import added for the representative presentation fixture.

Final revision receipt/source identity:
`.claude/test-runs/fucq441/editor-feedback/revision-final-receipt.json`,
`6e8a4185fca7431cb572a43f997c0f8a6d01a5a5db084c767a022376fcdd5fdc`.
Lead verification: `editor-feedback/lead-revision-verification.json` under that
receipt root. All edited/source/check hashes matched; all three revision scratch
roots and owned links are absent; borrowed dependency/runtime identities match.
Final run 4.21 seconds, RSS 878,854,144 bytes and scratch 9,961,696 bytes.
Earlier 29/29 evidence is retained for its own prior tree, not relabelled as a new run.

Stable tested exports for the Account owner:
- `AccountPreferencesComponent` from `preferences/account-preferences.component.ts`,
  selector `gcsp-account-preferences`, optional `carDescription: string`.
- `CurrentCarRatingComponent` from `preferences/current-car-rating.component.ts`,
  selector `gcsp-current-car-rating`, required `contractId: string` and optional
  `carDescription: string`. It renders only for the exact server current contract.
- Both inject the root `BriefEditorStore`; do not add an Account-local provider.

These scoped proofs do not complete native acceptance. Buddy command controls,
production AOT/boundaries and actual rendered/Java/OIDC/native PostgreSQL/reload/
restart/Safari/private/accessibility/hosted checks remain open. Both original AC
remain unchecked and Story In Progress.

## Buddy control implementation

The dispatcher guarded-published the corrected editor at
`701bcc87c6d4acd58009f5dce15a7fe9d61da86c`; its independent resource/source
verification is `.claude/fucq441-parent-resource-revision-0105.json`.
Parent source changes through `06788023` are Java release/presenter work with no
Angular delta; a base sync remains for the integration boundary.

Fresh capacity allowed two launches at 01:05 GMT; the lead launched only Donald
Duck, requested/selected `gpt-6-luna` / `high`, no fallback, from current mechanic
tier output. Runtime was independently verified in the child's `turn_context`.
The fully specified bounded slice adds typed Buddy command results, one command
lane serialized with saves, server-based current status/remaining gates, native
controls and explicit uncertain retries/reload, plus the source one-function
Buddy choice applied through full save. No Account/activity timelines/offer UI or
server business code is included. Full native integration acceptance stays open.

## Reviewed Buddy checkpoint

Donald Duck completed the typed Buddy results, shared serialized command lane,
compact/full saved-status controls, paused-search consequence, explicit uncertain
retry/reload, and one deferred search-and-hold choice in the full save. The saved
title and effective `gpt-6-luna` / `high` runtime were independently verified,
matching the requested/selected pair without fallback. Its four selected spec
files passed 52 checks at source identity
`0d1c3454c30da19057951620de3f3f57c3ca574cb63ab0cd73064807268deb86`.
Compiler/assertion failures and earlier successful source identities remain in
the worker-local `.claude/test-runs/fucq441/engagement/` receipt directory.

Lead review found an original recovery-criterion gap: compact controls accepted
edits during a Buddy status GET, but its readback could overwrite those new edits
with the snapshot captured before the GET. Fresh capacity allowed two launches;
only Barney McGrew was launched for this bounded correction, requested/selected
`gpt-6.1-sol` / `medium`, no fallback. Its saved title and effective runtime were
independently verified. The store now locks compact inputs during status refresh;
the existing queue behind an ordinary Buddy POST remains available.

Seven deferred-read cases plus a native disabled/value-retention check reproduced
eight failures before the correction. An initial test compilation error was also
retained. The final store/component command passed 46 checks at source identity
`18ff8c773e6a531a33ade05f1ed1589172526ec5d98a2b35e62c66e2a3615728`:
`npm --prefix apps/gcsp-web test -- --include=src/app/preferences/brief-editor.store.spec.ts --include=src/app/preferences/preferences.component.spec.ts`.
The unchanged client/Buddy specs reuse Donald's matching proof. This is scoped
evidence, not a full-suite stamp. Helper-mediated `diff --check` passed.

The lead reviewed the correction and callers, matched all final source/check
hashes, and independently verified every process group and both recorded and
actual scratch roots are absent. The inherited supervisor records its initially
proposed temporary root separately from the overridden actual root; both were
checked. The owned dependency link is absent, and borrowed dependency/runtime
device and inode identities match. Root-local receipts and lead verification:
`.claude/test-runs/fucq441/engagement-correction/`. Final correction run: 4.45
seconds, RSS 1,051,377,664 bytes, scratch 9,965,984 bytes. Donald's final run took
4.95 seconds, RSS 947,585,024 bytes, with the same peak scratch size.

## Native producer seam observations

Read-only review of Java FUCQ-460 at parent revision `a593e4fb` confirms the four
read routes and seven core command routes match the native client, including
sparse preference input, exact brief/draft versions and Buddy result shape.
Paused search remains `state: disengaged`, `reason: paused`, with consent retained.
Preview and change-after-decline are separate FUCQ-461/FUCQ-466 work.

The editor DTO is still incomplete against the frozen source contract:
`AccountEditor.context` omits `contextVersion`; `BriefService.readEditor` line 142
emits only `versions.policy` and `versions.facts`. The client requires the real
`context.contextVersion` and `versions.context`/`versions.clock` too, so it will
truthfully reject that response until the producer supplies them. Known account,
driver and employee-provider facts remain unported. No client version is invented.

Read-only review at parent revision
`b1be1d59c6d8416ac61cc3807e5311292293bdb6` confirms FUCQ-458 now provides the
employee-owned, query-free `GET /api/gcsp/v1/manual/account` envelope and binds
`BriefAccountPort` to the account projection's current contract/model and facts
version. The default account provider and policy remain unavailable until their
configured dependencies connect; truthful 503 is expected. This does not close
the editor DTO gap or prove Java/OIDC/PostgreSQL/reload/restart/hosted acceptance.
The dispatcher has the exact seams; no Account or Java source was changed here.

Production AOT, boundary/component checks and rendered desktop/narrow interaction
review follow this checkpoint. Safari/private, accessibility and the actual
native journey remain open. Both original AC remain unchecked; Story In Progress.
## Partial production and rendered proof

The dispatcher synced and published clean worker
`e687b676ede7a80c02c661bad3e35122f98f2524`, incorporating root
`c6fd531a36d57ce35d12c57b174a35f9327e2d31`. All 20 previously recorded Angular/
configuration hashes and the worker Story/map row survived; all 301 incoming
foreign map rows were preserved. Ten inherited FUCQ-415 whitespace lines were
retained exactly. No worker push, base sync or Java/Account edit was performed.

Fresh capacity at 01:46 allowed two launches; only Taz was launched. Requested,
selected and effective `gpt-6-luna` / `high` matched with no fallback; the lead
independently verified the saved Taz title and runtime `turn_context` at child
`01a1d7bc-eba0-7121-8fd8-d5652e11a50d`.

At that frozen source the production command
`npm --prefix apps/gcsp-web run build -- --output-path <owned-scratch>/production`,
`npm --prefix apps/gcsp-web run check:boundaries` and local public-configuration
`scripts/build-gcsp-static.mjs` assembly all returned zero. The retained command
receipt reports 15 assembled files and the exact revision; its latest production
chunk took 5.07 seconds and peaked at 1,310,474,240 bytes RSS / 12,366,592 bytes
scratch. These are build/boundary/assembly results, not integrated acceptance.
The boundary command includes its static CSP checks. A browser CSP pass and
independent generated-index/config/CSP/asset-hash inspection were not established;
the generated manifest/index were disposable scratch and not retained. The
production receipt's `environment_id` field copied the Node engine `24.22.3`;
the plan records the actual local proof environment input `fucq441-local-proof`.
Neither is evidence of a hosted environment.

The original broad browser attempt remains incomplete. Attempts 01–06 preserve
identity-comparison, workspace-path, TypeScript/bootstrap, browser setup and key
probe diagnostics. Multiple unchanged production reruns occurred before the lead
and dispatcher stopped the broad retry loop; they are not additional coverage.
An explicitly bounded follow-up reused production evidence and rebuilt only the
test bootstrap/static bundle. On the real Preferences component and route with
fixture AuthPort/PORTAL_FETCH, Chrome 157 at 1440 pixels focused the native
SUMMARY, delivered a trusted Enter keydown with `defaultPrevented=false`, opened
the disclosure from false to true and retained focus. No runtime exceptions were
recorded for that diagnostic. The earlier assertion does not establish a native
keyboard defect, and this one interaction does not establish full keyboard proof.

The lead and independent reviewer viewed the actual 1440 initial screen and the
approved 1440-initial/375-engaged references. The captured full editor shows its
supported inputs, practical needs, retained current-car feedback, save/consent/
Buddy controls and server-shaped vehicle preview with image/fallback, points/
allowance, units, checks, trade-offs and unknowns. Its recorded desktop document
width was 1440 without horizontal overflow. Only this initial desktop state was
captured; no compact or narrow screenshot or all-state/interaction pass follows.

Root-local receipts: `.claude/test-runs/fucq441/final-ui/production-proof.json`,
`final-receipt.json` (incomplete broad proof), and
`keyboard-diagnostic/{final-receipt,browser-proof,rendered-proof}.json` (single-key
proof). Actual image:
`.claude/test-runs/fucq441/final-ui/keyboard-diagnostic/screenshots/preferences-1440-initial.png`.
A copied generic raw-log label and an erroneous preliminary `node --check` on a
Python file remain documented; subsequent Python/Node syntax checks passed.
The final bounded chunk took 6.95 seconds, peak RSS 1,338,392,576 bytes and scratch
15,406,200 bytes.

Lead `final-ui/lead-verification.json` and dispatcher
`.claude/fucq441-parent-resource-final-ui-0212.json` independently verify both
35-file source-hash sets, all 11 ownership manifests/checkpoints and dead process
groups, absent actual/proposed scratch roots, absent scratch parent and temporary
dependency link, preserved four borrowed dependency/runtime device/inode
identities, and the clean frozen tree. No output exceeded 256 MiB; no OneDrive
output or disposable leftovers remain. These audits establish resource/source
integrity only.

## Independent review and unfixed separate Bug

After Taz stopped, fresh capacity at 02:16:43 allowed two launches; only Cuthbert
was launched. Requested/selected/effective `gpt-6.1-sol` / `high`, no fallback,
was independently verified from `turn_context` at 02:17:32.852Z; saved title
Cuthbert was read back at child `01a1d7d8-78e7-7a21-8666-c26aec43f4dc`.
They reviewed actual changes/callers, original acceptance, frozen source,
meaningful selected tests, screenshots/references and resource receipts without
allocating tests/builds/browser processes or changing files.

Review found one source-proved Medium recovery regression, now separate native
Bug **FUCQ-491**, To Do, under FUCQ-432, Relates FUCQ-441. The dispatcher verified
Bug type/link/description and empty attachments after a complete duplicate search;
root intake is `.claude/fucq441-preview-race-bug-0221.md`. The lead independently
confirmed the trace at reviewed source `e687b676`:

- `brief-editor.store.ts` 420–426 accepts a preview result while its scope and
  preview ticket remain current, then applies stale/conflict outcomes to shared
  `failure` through `fail()` at 392–397.
- `saveFull()` at 428–430 does not invalidate that outstanding preview. After
  confirmation clears failure at 460, the old preview can return stale during
  final readback or before the next 180 ms preview dispatch.
- Successful readback at 476–481 retains that intervening failure, so `locked()`
  at 61–63 disables the saved editor and shared compact/Buddy controls until
  refresh. The frozen producer at `server/gcsp/brief/editor.js` 444–445 supports
  the stale outcome when versions advance during evaluation.

Reproduction is source-derived, not executed. The narrow next check is a deferred
preview regression against successful save/readback, with both late-arrival
orders, followed by affected full/compact recovery rendering when the producer
is available. Refresh restores transient client state; no persisted data loss,
ownership bypass or existing-state data repair is established. No error-state
screenshot is supplied. FUCQ-491 remains unfixed and independently prioritised;
it neither expands this Story nor becomes its merge dependency. Existing
FUCQ-487/488 also remain separate and unfixed. No acceptance waiver was granted.

Root review summary is `.claude/test-runs/fucq441/independent-review.json`; bounded
structured diagnosis is `stale-preview-bug-payload.json` in that directory.
Cuthbert's final whole-acceptance verdict was **failed**, with explicit eligibility
for a coherent, honestly labelled partial integration checkpoint under the Medium
defect policy. The lead agrees: source/unit/build evidence supports that partial
checkpoint; it does not complete the Story.

## Remaining original acceptance and handoff

Both original AC remain unchecked; native/file Story remains In Progress and the
lease remains held. The native-integration slice is in progress solely because
production/static and one desktop/keyboard proof have begun. Actual Java editor
context/context-version/clock contracts and configured provider readiness remain
concrete producer gaps. Root FUCQ-457 progress is not a substitute for verified
consumer wiring; this worker was not synced during review.

Still unrun: actual Java/OIDC/native PostgreSQL preference/feedback/engagement,
stale/unavailable and persisted reload scenarios; transaction/concurrency/restart
and hosted evidence; compact/narrow/320 overflow, category/rating/SameAgain/Buddy/
save/recovery interaction and all applicable visible-state captures; full native
keyboard/focus, browser CSP, Safari/private, accessibility and reduced motion.
The accepted/read-only, pending/stale/uncertain and confirmed/readback-unavailable
states retain scoped unit/source evidence only. No full-suite stamp is claimed.

All product source writers are stopped. Routes, additive kit, gallery and
COMPONENTS reservations can be released by the dispatcher after this metadata
checkpoint. Account, auth/shell, root configuration/styles, Java and Node business
ownership were preserved. The dispatcher alone publishes, syncs, integrates and
updates native lifecycle; partial integration is a reviewable option, not full
acceptance, Built/Done or lease release.
