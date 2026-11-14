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
