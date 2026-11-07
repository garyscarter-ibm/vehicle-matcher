# Greg driver eligibility: diagnosis and proposed source repair

FUCQ-100 coordination, 6 November 2026. Read-only diagnosis requested by the dispatcher.
Product source remains the accepted runtime at `95d7741`, with documentation checkpoint `fbd5297`.
No product edit, adoption, test, browser, listener, native database or full-suite run is authorised here.
The [source plan](evidence/fucq100/greg-eligibility-source-plan.json) pins the inspected files.

## Symptom and evidence

The dispatcher reported 25/26 combined FUCQ-103 checks passing, with weighted HTTP fit remaining
suppressed. Its independent first-run receipt is shared
`.claude/test-runs/ownership/fucq103-runtime-first-parent-review-20261106.json`.
No reproduction was rerun for this diagnosis. Source inspection confirms the data-path failure:

1. `seedManualDemoContext` persists `contract.manualContext.drivers[].eligible`, including its typed
   value and provenance. It does not set `employeeFacts.driverEligible`.
2. The actual employee runtime provider reads coherent manual account/driver records, selects the
   current-contract driver or employee driver, and projects that driver's `eligible` fact into the
   recommendation provider's `employeeFacts.driverEligible`.
3. Greg demand and publish-fit each clone only persisted `manualContext.employeeFacts`. Neither
   derives the driver fact. Their repository loaders also omit `entitlement_slots`.
4. FUCQ-29 correctly emits `driver-unconfirmed` for the missing fact. Decisions cannot become eligible;
   Greg counts unmet demand and fit excludes those decisions. `meanBestScore` is correctly suppressed
   when fewer than the policy threshold of briefs have eligible scored stock.

The failure is in source projection. Privacy suppression and eligibility gating follow their inputs.
A policy weight cannot remove an unknown driver gate. A single valid employee also
cannot make an aggregate available when the unchanged cohort threshold is five.

The later focused receipt, shared
`.claude/test-runs/ownership/fucq103-runtime-focus-parent-review-20261106.json`, accepts 5/5 focused checks
and reuses 21 earlier checks. It explicitly records `defaultRuntimeWeightedPreviewAcceptance: false`.
The published combined checkpoint `f6a66e88a3ab264681b389c43d5d60aa81dfa9fb` retains the controlled
test, which copies the real persisted driver's fact into `employeeFacts` before creating five
synthetic subjects. That establishes the controlled combined calculation, not default preparation.
The combined commit and its remote were read back; the inspected test is pinned there and is not adopted here.

## Origin and affected boundaries

FUCQ-99 / DEV-2026-11-04-063 authored the saved-demand projection. Its closed story, merged at
`1d137e04377bc1e3fb1e2728cd52c94ece9e7990`, requires unmet demand to use shared eligibility gates and
preserve aggregate privacy. This is the confirmed basis for linking the demand reader to that story.
FUCQ-103 / DEV-2026-11-04-066 owns policy preview and `greg/publish/fit.js`; its acceptance requires
actual fit changes without relaxing eligibility or held quotes. The dispatcher coordinates both lanes.
This note records diagnosis in the existing 100 story; it creates no Bug, Jira scope or claim.

The canonical employee provider already projects a driver fact after actual account validation.
Buddy local and remote readers use the employee's own `kind === 'employee'` driver and fill a missing
flattened fact. Manual browsing uses its explicitly selected draft driver. These are distinct selection
contexts. No change to those paths is proposed in this repair, and their first-match/fallback behavior
is not claimed to prove a universal driver-binding contract.

Some existing 99/103 fixtures insert only a flattened driver fact into a partial manualContext.
Those fixtures explain why isolated calculation tests missed the canonical preparation gap. A legacy
flattened fact alone does not establish which persisted driver it describes. Fixtures targeting the
canonical boundary must carry actual account, driver and slot records; they must not repair this gap
by writing a constant true or bypassing the recommendation gate.

## Proposed finite production scope

After dispatcher review and explicit 99/103 ownership coordination, change exactly four product paths:

| Path | Proposed change |
|---|---|
| `server/gcsp/manual-context/recommendation-facts.js` (new) | One pure persisted-subject projection shared by both Greg readers; no repository writes or identity/session operation |
| `server/gcsp/greg/index.js` | Add entitlement slots to the existing load/read-fence set; obtain the bound driver fact through that projection |
| `server/gcsp/greg/publish/index.js` | Add entitlement slots to the rows shared by active/draft fit and the final stability fence |
| `server/gcsp/greg/publish/fit.js` | Consume the same projection instead of relying on a duplicated flattened field |

The projector takes rows already read under the caller's Greg guard and current run. Bind the confirmed
brief to the exact persisted employee and entitlement slot. Require their employee/run/slot identities
to agree. Validate the manual account's employee/company/scheme/grade binding and its existing dated
source/record-set contract. Retain internal employee/slot revisions in the input identity and read fence.

When the slot names a current contract, require exactly one matching contract for that employee, slot
and scheme, then exactly one driver matching its explicit driverId and employeeId. An unresolved
explicit reference cannot fall back to another driver. With no current contract reference, use only a
unique employee-kind driver for that employee. Never select a driver because eligibility is true,
because it is first in an array, or because the requester has a role.

Copy the bound driver's original `eligible` fact, including unknown, false and provenance, into a
cloned employeeFacts projection. That bound fact governs the derived field; a contradictory flattened
true cannot override a bound false or unknown. Missing/ambiguous/unconfirmed driver evidence remains
`driver-unconfirmed`; foreign source bindings must fail closed without exposing identifying details.
Keep typed fact validation and all policy, points, essentials and time gates in FUCQ-29. Do not mint
new assurance, observation time or provenance and do not persist a derived eligibility cache.

Greg still authorises the original trusted Greg context at entry and before response. The internal
employee calculation context comes solely from persisted rows. This projector grants no employee
session or mutation authority. Existing stock visibility, decline exclusion and aggregate response
allowlists remain in force. No driver identity, licence, contact, trip data or individual score enters
Greg's response. Small cohorts remain suppressed.

The exact treatment of structurally invalid bindings versus absent facts must be reviewed against
existing generic source-unavailable and driver-unconfirmed outcomes before implementation. Preserve
public response shapes and avoid introducing driver-specific identifying error payloads.

## Proposed validation, awaiting source and resource grant

Author one focused integration file, `server/test/gcsp-greg-driver-eligibility.test.js`, and update the
canonical preparation in `server/test/gcsp-greg-demand.test.js` only after ownership coordination.
Any change to 103's existing test files remains with 103 or a separately named grant.

- Prepare the real canonical manual records without a flattened driverEligible field. Through the
  ordinary shared runtime/repository, show matching employee and Greg gate outcomes for the same
  employee and exact released stock. Do not insert a separate success-shaped candidate or fact.
- Cover bound true, false, absent, unknown and malformed fact provenance; missing/duplicate/foreign
  drivers and slots; a missing explicitly referenced contract/driver; a nominated current driver;
  and a no-current-contract employee with exactly one employee driver.
- With enough explicitly synthetic, correctly bound subjects to meet unchanged privacy policy, prove
  actual weighted active/draft fit differs using the retained 103 scorer. Remove a subject and prove
  suppression remains. Use actual canonical preparation for each subject, not a copied flattened fact.
- Preserve original driver fact bytes/provenance, repository records, policy and quoted offer pins.
  Verify that changing employee or slot during either read produces the existing conflict outcome.
- Retain non-Greg/stale-run refusal, stock visibility, decline and unknown charging behavior. Assert
  aggregate responses contain no employee/driver identifiers or private source data.

Before executing, freeze the reviewed combined source/import/input/environment graph, installed module
identities, Node/runner hashes, exact selected checks and the final source baseline. Proposed admission
limits are one worker, 120 seconds, 768 MiB RSS, 128 MiB owned scratch and 2 MiB combined logs, with an
external manifest, checkpoint and full owned-process/group/reservation/scratch teardown. These are
proposed bounds, not an allocation or permission to rerun old checks. Browser/native/full/provider
runs and final story acceptance remain separate.

No policy seed, weighted scorer, shared identity/core, runtime/index composition, buddy/manual mutation,
allocator 96, remote adapter, case remedy or bootstrap host change is part of this four-path proposal.
The incoming 69, 122 and 126 handoffs remain separate source decisions.
