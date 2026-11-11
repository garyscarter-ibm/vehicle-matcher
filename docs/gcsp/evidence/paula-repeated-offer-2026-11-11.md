# Paula's repeated offer after a decline, 11 November 2026

Gary reported that Paula receives the same car on every release, even after changing fuel on decline, and requested scenario investigation. **The exact-car repeat is reproduced. The changed answer is saved correctly.** This is an interaction between current exclusion, charging and ranking rules, rather than evidence of a failed preference save.

Medium-priority Bug [FUCQ-388](https://ibm-consulting.atlassian.net/browse/FUCQ-388) records the finding independently and is natively related to verified original Story [FUCQ-107](https://ibm-consulting.atlassian.net/browse/FUCQ-107). It remains unassigned and To Do. No product behavior or policy was changed, no claimed Story criteria were expanded, and no acceptance or deployment is claimed. Follow `docs/gcsp/build-rules.md`, particularly Demo delivery and scope control.

## What causes it

1. `server/gcsp/allocation/index.js` compares the current confirmed brief with the historical brief pinned by each decline. A semantic preference or essential change removes the `declined-unchanged` exclusion. It does not require that the old car improve against the reason for decline. This implements the documented `offer.declinedCar.exclusion = untilRelevantConfirmedBriefChange` rule (`docs/gcsp/allocation-contract.md`).
2. Fuel is a weighted preference, not an eligibility constraint. Allocation proposes any otherwise eligible car; there is no minimum fit score or requirement that the requested fuel matches. The preference change is used in scoring, but does not guarantee a different car or fuel.
3. Main successful journey starts with an estate preference at importance 80, no fuel preference, and confirmed charging `not-ready`. Fuel follow-up adds the chosen fuel at the policy's importance 50. Changing that answer does not change charging. `chargingGates` in `server/scenarios/employee/index.js` therefore blocks all EV/PHEV stock in these runs. Remaining petrol and diesel cars can still contend with very low fit scores.
4. Equal scores use the policy's stable seeded lottery, including the exact car identity. An old car that becomes eligible again can win the same tie again. In the repeat below, the same diesel wins after an EV change with a **2/100** score. Its new offer and confirmed brief versions are real; the UI is not merely displaying the previous offer.

The follow-up's waiting/no-match projection also tests eligibility, rather than a minimum quality score. A future repair needs to keep that reader consistent with the agreed allocation rule.

## Observed scenarios

Independent local runtime, real HTTPS presenter/employee routes, real BriefService, allocator and hold services, generated stock, one worker. Six branches and eight declines completed. Each branch resets Main successful journey; Next release publishes the first tranche, Paula declines and optionally confirms one answer, then Next release runs the real services again. The charging control uses BriefService to confirm `home` before the first release. No deployed run was reset or modified.

| Scenario | Observed next outcome |
|---|---|
| Decline without a preference change | The declined exact car is excluded; a different petrol car is offered. |
| Add diesel after declining an X1 23d | The **same exact X1 23d** is reoffered. Diesel was previously absent from the brief; adding it changes the brief even though that car is already diesel. |
| Decline that X1 again; change diesel to EV | The **same exact diesel X1 23d** is reoffered at **2/100**, although the saved new brief says EV. All evaluated EV/PHEV candidates fail the charging gate. |
| Decline it again; change EV to petrol | A different petrol 320i Touring is offered, with matching body and fuel. |
| Fresh branch: choose EV, charging still not-ready | A petrol X1 23i is offered; EV candidates are blocked. This particular branch does not repeat the exact previous car. |
| Fresh branch: choose PHEV, charging still not-ready | A petrol 320i Touring is offered; PHEV candidates are blocked. |
| Body-style control: change estate to saloon | The same exact petrol X1 M35i SUV is reoffered at **0/100**, with no eligible saloon to beat it in this pool. |
| Charging control: confirm home charging, then choose EV | A plug-in hybrid X1 25e is replaced by an electric iX2 30. Twenty-eight EV candidates are eligible in that evaluated pool. |

The diesel loop retains order UUID `2bb358cc-85f9-4870-a185-3bc15e456a8a` through three distinct offers. This distinguishes an exact-car repeat from another unit of the same model. The saloon control retains `52393015-4394-40ab-ab38-c139f0bf21f0`. These are run-scoped generated identifiers from the independent proof, not deployed employee records.

The report's “every release” is not universal across the tested inputs. Exact repeats occur under the conditions above; matching fuel and available alternatives can change the outcome.

## Proposed repair boundary

Agree a more useful post-decline rule before changing canonical policy: either keep the rejected exact car excluded during this search/renewal, or allow it back only when the confirmed change gives a reason-specific basis to reconsider it. An EV/PHEV answer conflicting with recorded charging should expose the conflict and a useful next step, rather than treating a 2% combustion offer as a successful response. Preserve the distinction between soft preferences and essentials; do not infer charging access from a fuel selection or silently hard-filter every preference.

This recommendation is a discussion point in the independent Bug, not an implemented rule or a new criterion added to FUCQ-107.

## Validation and limits

Application baseline: `0b0ed5349eda` on `gcsp-poc`; unchanged application code key `cb000fcc7a1b24ad767ce14c6763da753098f46e81f903cc58012c0ccc9e4835`; Node 26.5.0. Memory repository and generated inventory; the normal policy/offer-journey composition is retained. No browser rendering, live PostgreSQL, deployed smoke or full suite was run.

The independent probe and compact JSON observations remain under ignored `.claude/test-runs/paula-repeat/`. All journey writes use the actual services/routes; repository reads establish exact identities, saved brief values and allocation evidence. A private copy of the existing HTTPS test helper permits a bounded 8 MiB response because generated-stock tick results exceed that helper's usual 1 MiB limit. Product HTTP limits were not edited.

Selected boundary checks, through `_tools/test_stamp.py --targeted 0b0ed534`:

```text
node --test --test-concurrency=1 server/test/gcsp-allocation.test.js server/test/gcsp-second-offer.test.js server/test/gcsp-scenario-decline-change.test.js
42 passed; 0 failed, skipped or cancelled; 25.1 seconds supervised wall time.
```

These tests confirm the existing semantic-change re-entry and successful body-change path. Passing them does not establish that the reported interaction is fixed. No production tests or source files were modified for this diagnosis.

The investigation probe first failed at an import path, then at the fixture's response-size cap; those harness issues were corrected locally. Five branches completed before the charging control rejected the unregistered literal `ready`; only that unfinished branch was resumed using the registered value `home`, and completed successfully. The retained observations distinguish those failures from product defects. A broad Jira-operation discovery call was cancelled after stalling; narrower discovery and subsequent Bug creation/link/readback succeeded.

Every test invocation used the resource supervisor's external ownership manifest, run-owned TLS/inventory scratch, bounded output, process cleanup and finalizer. All owned scratch roots were verified absent after successful and failed attempts. Small probe sources, observations, logs and cleanup/impact receipts remain ignored; no large outputs or compatibility exceptions were needed. The Bug's stored description, To Do status, Medium priority and native Relates link to Story FUCQ-107 were read back and verified.
