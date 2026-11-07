# Waiting for Paula: source assessment — 6 November 2026

The existing services can produce the confirmed brief and unused offer decline required by FUCQ-122. The unchanged retained browser host cannot produce the first offer through its exposed UI alone: it supplies no stock pull provider, and startup registers buddy expiry rather than offer allocation. A bounded server-assisted composition is present in source. Its use for this case-confirmation journey remains **unexecuted and unproved**; this is an input proposal, not a defect diagnosis, runtime grant or acceptance result. FUCQ-96 is not an admission gate inferred from journey links.

This assessment changes one documentation path only. Original Story/ACs, Result/status, runner/catalogue and previous incomplete evidence remain intact. No tests, syntax checks, browser/server/DB, scenario/helper execution or runtime allocation occurred for this assessment.

## Source identity

Reads used shared `gcsp-poc` at `8db112046e68daa92b1b0418451fe6bfbdd9fb80`; the retained read-only host is `.claude/worktrees/DEV-2026-11-04-060` at `f5f44edabe811fb4680144a50b9ab30ada6ce8a9`. The producer/consumer files cited below, including the composition test/profile, were byte-compared between those clean trees and match. This comparison does not extend the earlier browser result or claim the complete FUCQ-122 branch was tested. Publication starts from owned branch `dev/DEV-2026-11-04-084` at `bcc3f68286bc321fdf0ed181d7dfef9b9feffd1f`.

Selected SHA-256 pins (identical in shared and retained trees):

| Source | SHA-256 |
| --- | --- |
| `server/gcsp/runtime.js` | `27ab9d02d5fa9b8777b40101f598b1c5b54be1145232e45dfe9a5a0d33672a5f` |
| `server/gcsp/brief/index.js` | `22500a517f8232947b33ac274e32bf60746ba9d8199851e750784f57737ee418` |
| `server/gcsp/cases/index.js` | `a080a47479444a94f041de1b0c094974c3eea655a8076f771ec33f82ecb43379` |
| `server/gcsp/offers/buddy-hold.js` | `b9f1a9be9cf42552a56313492bf0703b49ed715ffe2059f477ee11637c44b3d6` |
| `server/gcsp/offers/decision.js` | `a934455a09beb13e3682c1f10ebea95f0549ff2fad8db03d54ff947e7ed7789a` |
| `server/test/gcsp-offer-runtime-composition.test.js` | `c3f09bae5901ec98ba2913698814567d90d186020275757be23d9b4948c3bf32` |
| `server/test/helpers/runtime-composition-profile.js` | `01c07f817d322ba7e33734ee58483d10afe1291c2eef0f055fa9b1d66b169925` |

Paths/line numbers below refer to these source revisions, not to newly executed observations.

## Producers and required records

| Input | Actual caller and route | Writer and resulting record |
| --- | --- | --- |
| Confirmed brief | `blocks/gcsp/brief/brief-view.js:137` **Save this brief** → `brief-controller.js:166–209` → `brief-transport.js:15–32`: POST `/api/gcsp/brief/draft`, then `/api/gcsp/brief/confirm`, with separate command IDs, current draft/brief versions and explicit consent. `server/gcsp/brief/http.js:19–21` binds the trusted employee. | `server/gcsp/brief/index.js:121–203` validates and writes a next-version `briefs` row with `status: confirmed`, employee/slot/run, canonical policy, `confirmedBy` and `confirmedAt`, plus a `brief:changes` receipt. Editor context comes from `brief/editor.js`; keep its essential/inference guards. |
| Unused recorded decline | `blocks/gcsp/offer/entry.js:12` enables decisions. `offer-view.js:91–108` provides **Decline this offer**, reason selection and **Confirm decline**. `offer-controller.js:126–159` loads current reasons and submits current offer/hold/quote revisions through `offer/http-adapter.js:61–82`. GET `/api/gcsp/offers/:offerId/decision-reasons?runId=…`; POST `/api/gcsp/offers/:offerId/decision`. | `server/gcsp/offers/decision.js:230–299` authorizes the actual current offer and, in `local-synthetic` mode, releases hold/claim/stock, marks the offer `rejected`, inserts `decisions` with `decision: decline`, real `decisionId`, `offerId`, employee and `versions.brief`, and records `offer-declined`. Handlers are composed at `server/index.js:888–890`. |

A manual case update or lifecycle/order rejection does not create that offer-decision record. `server/gcsp/cases/index.js:133–153` requires an employee's decline with a nonempty `offerId`, a referenced confirmed brief, and no historical `brief.postDeclineChange.decisionId` consuming it. It projects the current brief version, registered preference path and permitted alternative values; use those returned values rather than inventing a remedy DTO.

## Existing service-assisted preparation

`server/test/gcsp-offer-runtime-composition.test.js:21–83` contains a concrete setup recipe. It is source evidence here; the test was not run.

1. `startGcspDemo({ runtime: { mode: 'memory', stockProvider: profile, … } })` returns the real services (`scripts/gcsp-demo.mjs`, `server/gcsp/runtime.js:146`). `runtime.createLocalSession()` creates real identity sessions and seeds the existing manual account (`runtime.js:130–144`). Resolve employee/presenter/Greg contexts through identity; do not construct or copy authority DTOs.
2. The recipe deliberately adopts the registered canonical bundles `offer-decline-reasons-v1` and `offer-followup-questions-v1`, using Greg's `policy.adoptReviewedAssumptions` and a one-second DemoClock advance between publications (`test:33–56`). `offer.declineReasons.v1` is absent from `policy/seed-v1.json`; its registered bundle supplies `body-style` (`policy/reviewed/offer-decline-reasons-v1.json:7–15`). Without the key, the real reason reader returns `decline-reasons-unavailable` (`offers/decision.js:57–67`). Adoption is an existing server-only operation with no HTTP route (`policy/adoption.js:24–54`); refresh contexts after activation. The second bundle supports the separate FUCQ-107 follow-up. The case confirmation route traced below does not read that question registry; omitting its adoption has not been exercised here.
3. The recipe saves/confirms an employee brief with body preference `estate` (value/importance confirmed, source employee), seats essential `gte 5 count` (confirmed), and search/hold consent (`test:57–60`; helper shapes at `server/test/helpers/employee-recommendation.js:9–11`). The existing editor is the browser producer; these exact service inputs are also already expressed in the composition source.
4. `createCompositionTestProfile().prepare(runtime, employee)` checks the real employee, prepared account and clock. It creates only a run-bound provider plan in its own Map, **no repository writes** (`server/test/helpers/runtime-composition-profile.js:12–42`). Exact existing candidate: order UUID `f1000000-0000-4000-8000-000000000001`, order number `9100001`, configuration `RjcwOlMx`, corpus `TEST-only-v1`, revision 1, model key `F70 Sports Hatch|120`, hatch/petrol/5 seats and the remaining exact facts at profile lines 26–37. Visibility is scoped to the real employee/company/scheme. The labelled `TEST-noon` window is `2026-11-05T12:00:00.000Z`, available until `2027-01-01T00:00:00.000Z`, with `supplyId: null`. These are simulated UTC dates, not the wall-clock execution date. This is explicitly synthetic TEST input, not FUCQ-77/78 corpus or live BMW evidence.
5. Advance the actual DemoClock from the recipe's `2026-11-05T09:00:00.000Z` policy start to that release instant and tick (`test:63–67`). The registered `stock-release` handler calls `profile.pull`, validates the source and writes released `stock` plus the release receipt (`stock/index.js:39–110,114–116`; `stock/synthetic-provider.js:8–37`). No direct store fixture substitutes for that producer.
6. Read actual stock/employee/slot revisions and call `runtime.buddy.allocate(employee, { commandId, orderUuid, expectedBriefVersion, expectedStockVersion, expectedEmployeeVersion, expectedSlotVersion })` (`test:68–72`). `offers/buddy-hold.js:183–256` requires the exact identity-owned context, current released visible stock, confirmed brief/hold consent and existing recommendation gates. Lines 283–343 create real quote, conditional hold/claim, active offer and captured notification. This bounded exact-candidate composition can prepare the consumer input without invoking FUCQ-96 winner selection. It proves no allocation fairness or full automatic-search journey.
7. Navigate to the actual returned offer reference using the existing account/offer access path; decline with the current canonical `body-style` reason and read the durable result. Do not confirm the offer page's FUCQ-107 follow-up first: its use of the decline would consume the input needed by Greg/Paula's case confirmation.

The source recipe therefore identifies an existing producer path and exact candidate. Successful execution against FUCQ-122, policy activation and all current feasibility guards remains to be observed; no success is inferred from reading its assertions.

## Existing case-confirmation continuation

Paula's existing help confirmation POST `/api/gcsp/cases` opens the actual renewal case; Greg reads `/api/gcsp/scheme-team/cases/options?caseId=…` and updates through `/api/gcsp/scheme-team/cases/update` (`server/gcsp/cases/http.js:10–11`). Move through server-returned statuses to propose the projected preference relaxation, for example `preferences.body.value` → `saloon` only if that value is actually returned. `blocks/gcsp/cases/gcsp-case-queue.js:227–241` carries the real decision/current brief version into the reviewed command.

For an applicable unchanged brief, `cases/case-content.js:30–44` displays **Waiting for your confirmation** and a review action. Paula's explicit confirmation calls `cases/gcsp-help.js:156–163` → `cases/http-adapter.js:55–56` → POST `/api/gcsp/brief/change-after-decline`. `server/gcsp/brief/index.js:174–203` validates her real unused decline/history, changes one registered value and writes the next confirmed brief with `postDeclineChange` linking decision, offer, from-version, path, before/after and employee/time.

`server/gcsp/cases/index.js:15–21,223–236` checks that exact linkage and preserved essentials before allowing resolution. A future observation must capture the actual waiting view, confirmation and ordinary reload/history through this path under the original ACs. The prior manual-decision resolved/closed captures establish none of this preference-confirmation branch.

## Limit and finite next action

The retained launcher supplied memory mode without `stockProvider`; `runtime.js:86–88` leaves stock release undefined. `server/index.js:875–890,905–916` composes existing reads/decisions and supplied release/expiry handlers, with no buddy-allocation browser route. `BuddyHoldService.start():37–48` registers expiry/reconciliation only. Saving a brief, advancing time or making a manual case update alone cannot supply the missing first offer/decline. The named `decline-then-change` scenario is also unavailable: `fixtures/scenarios/index.js:15,27–36,46–54` reports missing journey capabilities and refuses preparation. Its mechanics fixture is not a real decline producer.

Smallest proposed next action for root: select this existing composition recipe as the input preparation for a single bounded FUCQ-122 waiting/confirmation scenario, then prepare and review its exact runner/input changes before any separately authorised execution. Retain source/profile pins, real context/revision reads and producer receipts; drive the case remedy/confirmation through existing UI. Do not expand the application, scenario framework, ACs or Jira links to obtain this input. Source-only assessment is complete; original acceptance remains waiting/incomplete, with no Done recommendation.
