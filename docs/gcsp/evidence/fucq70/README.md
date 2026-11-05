# FUCQ-70 review-details delivery evidence

Worktree `DEV-2026-11-04-070`, branch `dev/DEV-2026-11-04-070`, starting shared
revision `727082730edd56ed2d6c9a28eaf905db05cd1866`. Development is incomplete.
Gary's 5 November technical-readiness direction permits the independent work below;
it does not establish a working integrated manual journey or satisfy the story's acceptance.

## Source and interface basis

- The published FUCQ-66 contract at
  `f81855fe1814657b8a2b0bbd949ac8e204dec44e:docs/gcsp/manual-claims-contract.md`
  was read through the shared scaffolding Git API. Its SHA-256 is
  `9c31f6f368ed4ed616c755eed168ae6bd75869cf65c4efc811eb0a2cd0cff294`.
- Frozen claim source is `abed0960618fd67a160d857b65029c0f64c9a2a7`.
  The starting shared revision does not contain that implementation. No claim code
  is copied or merged into this branch by the independent metadata work.
- FUCQ-66's readiness record published at `4336075` identifies the occupied-draft
  refusal and quote-pinned draft version. Review contact editing therefore uses
  a separate metadata revision and the existing repository receipt table.
- The dispatcher accepted additive `GET/POST /api/gcsp/manual/review-details`,
  exact pinned-draft initialization, policy-derived validation and an in-transaction
  freeze port. The implementation's exact result/error/port contract must be
  reviewed before it is offered to a consumer.
- FUCQ-69 confirmed the handoff on 5 November: its explicit Review action owns
  one claim POST with a stable command ID and unchanged server `claimInput`.
  Only a matching authoritative active hold and pinned quote produces
  `onClaimConfirmed({ selection, claim, commandId })` and bubbling/composed
  `gcsp:manual-claim-confirmed`. FUCQ-70 must GET the current claim on handoff or
  reload and must never issue another claim for that handoff. FUCQ-70 owns only
  the subsequent explicit review-phase POST. Pending recovery stays with FUCQ-69.
  Publication `34862e7893371c9b2f4125eb39619c7b16c309aa` was read and verified:
  `docs/gcsp/manual-gallery-contract.md` SHA-256
  `7c1a33ca77d9870ff5b55f97b3fc35e7962ec92cf97413a5d0c552a3e3589714`.
  Its rendered claim owner and the actual consumer integration remain outstanding.
- FUCQ-71 retains selection submission. It must compare and freeze the exact
  review-details revision in its selection-intent transaction and use the frozen
  snapshot for order readback/print. Implementing the port here does not prove
  that unavailable integration; no FUCQ-71 source or claim is changed.

## Complete development plan

Stable slices are recorded using `_tools/product_map.py` in `.product-map/work.json`:

| Slice | Delivery boundary |
| --- | --- |
| `details` | Policy validation, revisioned metadata save/read, exact binding and same-transaction freeze contract |
| `controller` | Authoritative claim handoff/reload, stable commands, explicit review and independent cancel/release |
| `view` | Shared components, labelled required fields, safe retained inputs, countdown, responsive custom element |
| `service-integration` | Actual frozen FUCQ-66 producer and HTTP composition, with precisely admitted isolated source |
| `submission-integration` | Actual FUCQ-71 selection-intent freeze and order readback |
| `visual` | Actual desktop/320px, keyboard, pending/reload and presenter-tick captures |
| `full` | Authored UI ratchet and full suite under the dispatcher's serial grant, with matching strict stamp |
| `delivery` | Lead acceptance review, repeatable trials and independent resource teardown audit |

The verified `manual-journey` product component already associates FUCQ-70.
The existing component registry and other stories' map observations are preserved.

## Component and visual plan

Reuse `mountEmployee`/`portalShell`, `screenIntro`, `button`, `statusScreen`,
`factList`, `formatTerm`, `matchCard`/its explicit-member display contract,
`labelledField` and `errorSummary`. Keep native controls mounted during asynchronous
updates. Compose the review using GCSP semantic tokens. A contract-date countdown
does not express a held-car deadline; the review's time projection must use the
server hold expiry and persisted DemoClock, including phase and current authority.
Any new shared expiry primitive requires an additive catalogue/gallery/ratchet
change coordinated with the active shared-file writers.

Inspected directly in this worktree on 5 November:

- `docs/gcsp/screens/00-employee-account.webp`: slim header, account context and narrow navigation.
- `docs/gcsp/screens/01-replace-vehicle.webp`: old-contract/slot/collection/return context.
- `docs/gcsp/screens/05-vehicle-details.webp`: representative-image label, exact vehicle/terms,
  required contacts, returning-car mileage and optional requirements/counter.
- `docs/gcsp/evidence/fucq-6/representative-desktop.png`, approved reference source
  `a7fc178`, per its README: vehicle-led Used Cars body, exact terms and missing-image treatment.

The historical screenshots provide fields and shell evidence, not valid BMW
prices, personal data or duration defaults. Phone/email and replacement return
mileage remain required; no old car means no replacement mileage requirement.
Special requests cannot change released stock. There is no human layout-review pause;
actual functional, visual, responsive and accessibility gates remain required.

The controller's countdown will subtract the latest authoritative demo `now` from
the persisted hold `expiresAt`. It must not add browser wall-clock elapsed time or
reset the deadline when mounting. Refresh/focus and the host's presenter-tick
refresh read the same current claim. A low-time message is announced once per
hold/phase, with a separate expired announcement; the changing numeric readout
is outside the live region. No literal cart/review duration is supplied by this
screen. The pinned quote's timing projection supplies the phase context.

Save and Continue must share the complete validation/save path. Continue rereads
current authority after the save and before an explicit review-phase command,
then verifies the current readback before handing on. Cancel/change/back use the
release path independently of invalid or unsaved fields. Unknown write outcomes
retain the same command and inputs for recovery and never produce successful
navigation. Reload obtains the current claim; a handoff flag cannot restore it.

## Validation and resources

The first selected check is
`node --test --test-concurrency=1 server/test/gcsp-manual-review.test.js`,
covering the independently owned service and real repository boundary. Claim-read
doubles prove that boundary only. Actual claim, submission, native and browser
integration and authored full validation remain outstanding.

Every allocation uses the shared `_tools/test_resources.py` supervisor, finite
HostBudget reservation, external manifest, owned temporary root and process identities.
Default scoped limits are 120 seconds, 768 MiB RSS, 128 MiB scratch, 2 MiB logs and
one worker. Compact receipts are retained under the shared checkout's
`.claude/test-runs/fucq70/`; temporary roots, process groups, reservations and adopted
dependency links require independent absence checks. No large generated artifact,
native database, network/listener, BMW access, mail, browser or full-suite grant is
part of the independent checkpoint. Database environment aliases are removed for
checks; private credentials are not read.

## Agents and coordination

- Henery Hawk: requested/selected/effective `gpt-6.1-sol/high`, no fallback;
  own session `turn_context` verified the effective pair, and saved chat title is
  exactly `Henery Hawk`. IBM gateway check passed.
- Sniffles: requested/selected `gpt-6.1-sol/medium`, no fallback, metadata slice.
  Their title and gateway passed; own session `turn_context` verified the effective pair.
  Fresh capacity before spawn allowed two workers; measured HostBudget had
  2,942,812,160 bytes RAM available and no active test reservations.
- The dispatcher retains shared merges, claims/Jira, heartbeat and serial browser,
  full-suite and native grants. Own validated chunks may be committed and pushed.
  Git publication follows the dispatcher's current serial window. No checkout mutex is held over tests or waits.

## Reviewed metadata checkpoint

Lead read the new-file statistics and complete implementation, tests and consumer
contract, checked existing repository/clock/policy callers and the frozen claim
interface, and then ran the affected check: **15 tests, 15 passed, zero failed or
skipped**. The lead run took 1.09 seconds, measured 215,023,616 bytes peak RSS and
zero scratch payload bytes. The matching child check also passed 15/15.

The parent independently checked all five child/lead manifests: scratch roots,
process groups and HostBudget reservations are absent. The owned dependency
symlink is absent, the shared dependencies remain at their observed identities,
and root/worktree package hashes are unchanged. Retained compact evidence is
`.claude/test-runs/fucq70/{sniffles,lead-details}/` and
`details-parent-audit.json` in the shared checkout. Committed
`details-validation.json` records source identity and the bounded result.

The `details` slice is complete at its independent service boundary. At that checkpoint the remaining
slices and story acceptance stayed open. In particular, the starting shared HTTP
identity wrapper lacks `pending:202`; frozen FUCQ-66 supplies that entry. Central
composition must retain it before HTTP pending behaviour can be proved. No identity
source is changed by this checkpoint.


## Reviewed controller and form checkpoint

The independent controller and form are implemented. Lead reviewed the complete
adapter/model/controller, caller tests and current server/quote contracts. Source
and current checks are recorded in `controller-view-validation.json`; the child's
14/14 pure controller result and exact API are in `controller-validation.json`.
The parent also passed all 14 controller cases in its caller-boundary run. Final
form checks passed **7/7**, and the shared UI ratchet passed **44/44**. All checks
are scoped: the form uses explicit service-boundary doubles and JSDOM, with timing
and input bounds read from the canonical policy seed. They prove no browser layout,
actual producer, submission or native integration. The earlier metadata 15/15 result
remains unchanged. The complete source identities are checked against the retained
matching checkpoints.

The form composes the existing shell, exact card, typed terms, native forms and
error summary; its stylesheet is separately capped. Local values survive expiry
and uncertainty. Continue saves and fences the exact metadata revision through
review readback. Back/change/cancel release independently of invalid input. A
pending operation past its original deadline offers no successful browse navigation
and does not announce that the stock is free. The numeric countdown never uses
elapsed browser time. The host must wire presenter ticks to authoritative refresh;
that actual composition is still outstanding. The [UI contract](../../manual-review-ui-contract.md)
records host APIs, callback/event deduplication, fixed deadlines and repeatable trials.

Parent independently audited **six new allocations**: two child and four parent
runs, including the corrected DOM fixture attempt. All owned scratch roots, process
groups and reservations are absent. The temporary root dependency symlink is
absent; shared jsdom identity and package hashes are preserved. No dependency was
installed. Retained compact evidence is under shared
`.claude/test-runs/fucq70/{sniffles-controller,lead-view}/` and
`controller-view-parent-audit.json`. The largest sampled parent RSS across these
runs was 264,110,080 bytes, scratch payload zero, within the 120-second/768-MiB/
128-MiB/2-MiB-log limits. Sniffles reused their verified
`gpt-6.1-sol/medium` session with no descendants or fallback; Henery Hawk remained
`gpt-6.1-sol/high`. Browser, native and full-suite lanes were not allocated.

`details`, `controller` and the independent DOM boundary of `view` are complete.
The other five slices and all story acceptance remain open. This is a resumable
development checkpoint, **not built**. The next meaningful service proof needs the
dispatcher's exact frozen-66 source-overlay grant; broader native/browser/full grants
and FUCQ-71/FUCQ-103 composition remain with their current owners. The proposed
small proof uses the existing real memory repository, PolicyService, DemoIdentity,
DemoClock and frozen claims/manual-context/manual-stock service sources. It must
exercise one real claim, no second claim on review mount, independent metadata save,
one explicit review transition, unchanged deadlines under ticks/reload, and invalid-
form release. It creates no listener and proves no HTTP/native/submission edge.
Use the metadata contract SHA-256 in `details-validation.json`
(`1dfcb1bd0206842e90769a12cb92e765ab991d11be1c10fecfa74ab18b48a4d7`)
and the committed UI contract SHA-256 in `controller-view-validation.json` when
admitting that proof. No such overlay has yet been allocated or run.
