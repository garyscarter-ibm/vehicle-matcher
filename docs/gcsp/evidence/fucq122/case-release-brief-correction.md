# C4 brief input correction and retained C1 trace

6 November 2026. FUCQ-122 / DEV-2026-11-04-084. Author-only correction from
`9dca7ba230a80c000954ec52a212d56219c11bab`. No revised run is authorized by this
checkpoint; one revised-run allowance remains unused.

## Decided

Change only `server/test/gcsp-case-release-http.test.js:62` from preference value
`hatch` to `hatchback`. All four cases use this setup. The adopted policy's
`employee.recommendation.v1` body enum accepts `hatchback`, not `hatch`.
The seats essential, assertions, case names, routes and actual runtime path stay
unchanged. The FUCQ-100 C1 profile, canonical policy, product semantics and all
shared/owned harness helpers retain their exact bytes. The separate
alternative-car fixture observation is outside this correction.

The corrected test was published first at
`1a20692f2f31ecf2f2a88864c64e1fa89b5e0d1c`. The current source-plan and admission
now pin that immutable test revision. This is independent stdlib authoring;
`case-release-freeze.py` was not executed or imported.

## Retained run and cleanup

Grant `fucq122-c4-9dca7ba-1220` is consumed. Its supervisor exited 2 after about
27.3 seconds. Node launched and the original TAP reports the first case failed
in `setup()` at line 63, POST `/api/gcsp/brief/draft`: `invalid` instead of `ok`.
Observed counts are **1 reported, 0 passed, 1 failed, 3 not reached**. No TAP
summary was produced. This correction supplies no new execution result.
The retained `firstFailure` is the first-TAP-failure stop (`RuntimeError`, stage
`execution`); it must not be recast as a source-verification failure.

Original run, preserved without edits:
`/Users/garycarter/Code/GitHub/vehicle-matcher/.claude/test-runs/fucq122-c4/case-http-3e30146a2e3d4cb0918afe5611ae5684`.
Original `output.log` SHA-256:
`6b1e8305dcc47d4db9260f14bcb28c161d9ebc11e43be368f4bb552cc26259ed`.
The final query again entered parse-or-identity rejection handling (helper 264).
Its specific rejected invariant remains unknown. The initial finalizer refused
cleanup with `Scratch open-file absence is unknown` and retained resources.
Neither that failure nor the first setup failure is erased by later cleanup.

The lead's later exact-owner reconciliation receipt is
`.claude/test-runs/ownership/fucq122-lead-reconcile-1220.json`, SHA-256
`6b77e29ad835adc8174d9e85eaab7c0c052f885c90954bc16d94e3b89d2088fb`.
It records removal of only the manifest-owned scratch and dead reservation,
with originals preserved. Root independently collected that result in
`.claude/test-runs/ownership/dispatcher-collections-1231.json`, observed at
`2026-11-06T12:36:27.161510+00:00`, SHA-256
`6af08225e6756131aff161f24422b4dbc8f6c5c77fae47ae5cc7a343c6103d7f`.
That combined collection is PASS on **721 checks overall**; its FUCQ-122 section
records 273 current PIDs and 117 groups checked, the original failure, later
exact-owner cleanup and incomplete behavior acceptance. It made no resource
mutation. This authoring checkpoint read those retained receipts and compared
all ten original-artifact hashes/byte counts recorded by the lead. It did not
repeat cleanup, inspect the live ledger or perform resource probes.

## Static trace against the actual retained C1 profile

All source below was read from the existing source plan's retained Git-blob
payloads. Composition remains `f179ae6043414a2b07de3edb2b425338299ea37b`.
The C1 profile remains `46fa208e84a85ddc5cca843af59bb9794f63cada`, SHA-256
`01c07f817d322ba7e33734ee58483d10afe1291c2eef0f055fa9b1d66b169925`.

1. The profile authenticates the real employee and reads the actual ready manual
   account and clock before preparing immutable synthetic TEST input. Its line
   33 retains `body: fact('hatch')`; its known seats fact is 5. No profile byte
   is corrected or normalized by this checkpoint.
2. Retained `server/gcsp/policy/seed-v1.json` (SHA-256
   `c58fcd9054fa32cded07c4ee742b39d196f94aa15c8d0fbf7752874954df8a31`)
   maps body to the `bodyStyles` answer and `fit` component. Its enum at lines
   11439-11455 includes `hatchback`; `validateBriefContent` in
   `server/scenarios/employee/index.js:39-44` rejects the old `hatch` preference.
   The one-literal correction removes this specific validation defect.
3. `server/vehicles/index.js:54-69,73-99` validates fact structure/provenance
   and retains string values; it does not alias body values. The released-stock
   port (`server/gcsp/manual-context/ports.js:46-64`) projects the actual
   released row's `facts` as its snapshot without a body alias. The remaining
   profile value at scoring is therefore `hatch`.
4. `scorePreferences` (`server/scenarios/employee/index.js:85-124`, SHA-256
   `50e3b25317158c29605420af080c1ec6bd76ded94d298d33badfc90a4dc0d91c`)
   uses the known body fact directly and passes `bodyStyles: ['hatchback']`
   to `rankCars`. Only the body fit dimension has positive weight here.
   Retained policy has `retailBudgetEnabled: false` and body `miss: 0`.
5. `server/engine.js:136-147,585-593,622-681` (SHA-256
   `bbe8a865d280fb75075e93a139a3badbaa20972a18406baeeafb8ca2fc56a550`)
   compares `picks.includes(car.body)` exactly. `hatchback` does not equal
   `hatch`, so the body score is 0. The hard filters do not filter body, retail
   budget is disabled, and this preference has no people filter. The singleton
   survives this filter path; its body-only `fit` is finite 0. Engine
   `tradeOffs` at lines 743-753 also records the different desired/actual body.
6. `scorePreferences` consequently emits finite `preference-fit` evidence with
   desired `hatchback`, observed/score 0, and the retained `hatch` fact in
   `tradeOffs`. This value mismatch alone adds no preference-fact unknown.
   `server/gcsp/recommendation/index.js:147-153` (SHA-256
   `08acfe895804cf60dcc178591ecbdd1816f12ce70944f832f1ae394902c7e172`)
   derives `suitable` from hard-gate status, without a minimum preference score.
   `server/gcsp/cases/index.js:275-286` (SHA-256
   `a080a47479444a94f041de1b0c094974c3eea655a8076f771ec33f82ecb43379`)
   refuses unknowns and then requires `suitable`; it does not require a body
   preference match or positive score.

The concrete residual mismatch is a **zero-fit body preference tradeoff**, not
an observed successful proposal or a newly proven downstream blocker. C4's
assertions require actual availability, persisted driver, exact released
snapshot and proposal/replay/refusal behavior; they do not assert exact body fit
or score. Other eligibility, essential, points, timing, manual/buddy and case
integration outcomes still require the selected four-case evidence. No
assertion is weakened to bypass them.

## Validate and remaining gate

Corrected test: 15654 bytes, SHA-256 `54a1798996b607a8dc3af154fb38429a6ac6ed84c3fb1cd6de252d740ad56c03`.
Git blob: `cf972c53576bae8d6c13bc0a0a0fac8aa39627ea`.
Source-plan SHA-256: `e509ec368b0f5888e3623e9cb17f75af5f351653351a7c0d5b5979262f8d5d87`.
Admission SHA-256: `ad7253650a90e8b090c6ad3d93defb8c1c857bcb369348c412d34bc32edd5151`.

Static comparison restricts the test delta to the one literal. Historical
receipts stay retained, including the exact prior audit object inside the
current `case-release-freeze-audit.json`. Source selection matches the
collector's `selected()`: both the test and its owned HTTP client select
`1a20692f2f31ecf2f2a88864c64e1fa89b5e0d1c`, with the client's blob/hash/payload
unchanged. Composition/profile pins, all other rows,
edges/assets/installed inventory, four names, helper bytes, 25-node identities,
launcher records, environment, budgets/accounting and ledger contract remain
unchanged except the test/source-plan nodes' content/physical metadata.

Performed only static retained-source/evidence reads, text correction, stdlib
metadata/hash comparisons and named-path Git publication. No C4 helper/import,
collector, syntax/AST, test, listener, browser, native/full run, probes, live
ledger reads, scratch/source mirrors, allocations, descendants or grant
consumption/renewal occurred. Claim, lease and worktree remain retained. Agents:
requested/selected `gpt-6.1-sol/high`, no fallback or descendants.

Independent focused review of the exact correction and refreshed pins remains
required before a revised assignment can bind the unused allowance to the
reviewed revision/admission. Refreezing gives no execution permission. Grants
1016, 1029 and 1220 remain consumed. Earlier 81/81 evidence, actual F77/F78
corpus, default/reset, browser, native and full-build acceptance gaps retain
their separate source identities and remain unchanged.
