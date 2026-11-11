# Paula's Touring preference: diagnosis and proposed rule changes

11 November 2026. Russell supplied two observations and confirmed that this was the full feedback batch. Diagnosis only: **the proposals below are not adopted, and no product, policy, skill or employee preference has been changed**. The invoked `diagnose-and-fix` skill requires presenting the proposed edits and decision proofs together before approval.

## What happened

Paula's Estate preference was saved and evaluated. The stored offer was **BMW X2 M35i in Black Sapphire**, with an overall score of **31**. Its quote explicitly records desired body `estate`, importance **80**, and body fit **0**. It nevertheless passed eligibility, the five-seat essential, timing and points (**800 of 1,300**). The current rules permit an eligible car with a body-style mismatch to become an automatic offer.

The Tourings in the checked hosted preview were present in stock but ineligible for Paula:

| Released variant in the checked preview | Count | Recorded blockers |
| --- | ---: | --- |
| i5 40 Touring | 22 | G7 excluded by `choices-fs-uk-062-exclude`; 1,400 points exceeds her 1,300 allowance; charging unavailable |
| 3 Series Touring M340i | 11 | G7 excluded by `choices-fs-uk-017-exclude` |
| 3 Series Touring 330e | 1 | Charging unavailable |

These are all **34 estates among the 200 stock candidates checked**. No 320i Touring appeared in that preview. Being in a release does not by itself establish scheme eligibility or practical suitability for Paula. Changing those exclusions, her allowance or charging facts would be a separate decision; it is not the proposed remedy.

Her rejection was recorded and the hold released. The subsequent hosted question asked **“Which body style would you prefer?”**, offered Estate, and reported `currentValue: "estate"`. The Estate option itself is not individually disabled in current source. Selecting it produces an invalid unchanged answer, so **Confirm is disabled**; the backend independently rejects the same answer. This prevents her from completing the follow-up while retaining the preference the offer failed.

## Evidence identity and limits

- Inspected source: `gcsp-poc`, commit `9f013f3a8cd67139d7c615c1180154e2b3b14743`.
- Hosted run: `demo-f987444edd03cfaa7c3ec7ecc3818e1c`.
- X2 order: `a407dcb1-3be0-475f-bdcc-4b8fa268e3de`.
- Offer: `buddy-offer:f6228f99493c3ea217d8b54a7ba91c8bf2aac110e37039ed968b300be732462e`.
- Decline: `offer-decision:c932663d8b360aaac538a96be4b579cefd141780fd7798dc463de81d249aed01`.
- Offer creation wall time: **11 November 2026, 22:13:08.175 UTC**. Its quoted domain time is **12 November 2026, 11:30 UTC**, under the demo clock; that is not the wall-clock observation time.
- The quote pins **brief version 1** and `gcsp-policy-v1+offer-journey-v1`. Historical brief version 1 confirms body Estate at importance 80 as the only preference, with five-seat and `charging: not-ready` essentials. These rows carry `scenario:main-successful-journey` provenance.
- Current brief version 2 retains those values and adds Same Again. Its preview can also exclude other cars as `same-again-different`. That later state must not be treated as an original-allocation replay.

The stored original quote and historical brief establish the saved preference and the accepted mismatch. The current preview establishes the listed stock blockers at inspection. **No historical allocation receipt was fetched, and Render's exact deployed source revision was not verified.** Consequently this does not establish the entire original release pool, its ordering or other employees' competing allocations. It explains why the inspected Tourings cannot qualify under the observed facts, without claiming a complete historical replay.

## Responsible rules and classification

### 1. Automatic offer can disregard the chosen body style

The [recommendation contract](employee-recommendation.md) says that hard gates run first and suitable candidates enter preference ranking. In [the evaluator](../../server/gcsp/recommendation/index.js), `suitable` is `gateStatus === 'eligible'`; preference mismatch does not itself fail that gate. [Preference scoring](../../server/scenarios/employee/index.js) records the mismatch. [Allocation](../../server/gcsp/allocation/index.js) admits eligible, consented contenders and applies its separate fairness ordering. No automatic-offer rule requires a match to the saved body style or permission for a compromise.

**Classification: missing product rule / ambiguous meaning of “suitable”.** The preference was not lost. The rules allowed an offer that failed it. Importance 80 is a scoring input, not existing authority to forbid another body style. This evidence does not prove that an implementation skill ignored a correct rule.

### 2. Rejection assumes the employee must change their preference

The documented chain is specific:

1. [HLD agreement Q16](hld-agreement-2026-11-04.md) says Paula confirms **one preference change** after declining.
2. [FUCQ-91's record](../../_dev/done/2026-11/DEV-2026-11-04-049.md) and the [canonical feedback contract](feedback-actions.md) require one changed field and reject semantic no-ops.
3. [FUCQ-107's follow-up contract](offer-followup-contract.md) explicitly reuses that change operation and preserves no-op errors. Its native Jira Story was read: the AC requires one confirmed preference change and a new brief version.
4. [Question policy](../../server/gcsp/offers/followup-policy-definitions.json) targets only `preferences.body.value`. The [controller](../../blocks/gcsp/offer-followup/followup-controller.js) and [server validator](../../server/gcsp/offers/followup-policy.js) refuse equality, including scalar/array equivalents such as `estate` and `['estate']`. FUCQ-368 deliberately extended that equality handling.
5. [FUCQ-386's scope](../../_dev/done/2026-11/DEV-2026-11-11-004.md) explicitly excludes changing the existing follow-up. Its [independent review](evidence/fucq386/independent-visual-review.md) checked entry into that flow.

**Classification: wrong/underspecified product rule, with a missing reaffirmation branch.** “My preference remains correct; the offer failed it” is meaningful feedback, even though it is not a brief change. The existing brief no-op protection remains useful and should not be removed globally. Selecting Body style as a decline reason does not change value or importance, and this follow-up cannot increase importance.

### 3. Review tested changing a preference, not retaining it

The [controller tests](../../server/test/gcsp-second-offer-controller.test.js) expressly expect unchanged answers to fail. The [service tests](../../server/test/gcsp-second-offer.test.js) include a successful Estate-to-SUV change and explicitly reject unchanged answers. They verify the authored contract but omit the reported user intention. The experience contract requires relevant states, but does not name this connected scenario.

**Classification: missing review scenario.** Existing records establish the product instruction, implementation, test and review chain. They do not establish a complete historical skill invocation chain, so no generic skill is blamed or edited on assumption. The corrective review rule belongs in the shared project experience contract.

## Follow-up: can the release produce a matching Touring?

Russell asked whether releases prevent a matching car appearing or merely depend on the draw. Read-only source and local-corpus inspection confirms **a 320i Touring can be generated**. Canonical policy permits it for Paula's G7 grade at **1,100 points**, within her 1,300 allowance; its petrol body/seat facts meet the observed essentials.

The generator is a weighted, deterministic selection, not a demand-led search. The canonical mix gives 3 Series Touring a relative weight of 6 out of 101, approximately six cars in a 100-car release, across its derivatives. Run and tranche identities seed configuration selection, so a later tranche can differ while a retry is repeatable. See [configuration selection](../../server/gcsp/vehicle-evidence/stock-generator.js).

The [main-successful-journey scenario](../../server/gcsp/fixtures/scenarios/catalogue-v1.js) deliberately guarantees at least three cars Paula qualifies for, with model/colour diversity. Its [qualification check](../../server/gcsp/stock/release-guarantee.js) uses the scenario's initial eligibility, points, essentials and charging facts. It does not check body preference or fit score. SUVs can satisfy it; it does not promise an Estate or an actual allocation.

There is also structural skew in the available configuration/colour pool. Independent investigator Taz projected the active local corpus `7c9cc707ab44b36f9cb5eb64b54170b25d914d5ee7e31722384c737612c45a9c` through the current [plan rules](../../server/gcsp/vehicle-evidence/stock-configuration-plan.js):

| G21 derivative | Raw configurations | Retained plan |
| --- | ---: | ---: |
| M340i | 10 | 6 |
| 320i | 10 | 4 |
| 330e | 10 | 4 |

Label filtering and the first-eight-per-colour cap reduce coverage. Ordinary draws then intersect that plan with aggregate colour weights: Alpine White offers five M340i, one 320i and two 330e configurations; Black Sapphire offers one M340i. Three further retained 320i configurations use `BMW Individual Paintwork`, which has no exact aggregate colour weight. Consequently ordinary draws can select only the **one white 320i configuration**. The guarantee's replacement pool can use the other qualifying configurations too, but need not choose an Estate when other cars already fulfil its conditions.

Thus another release can produce a matching 320i, but the mix and configuration/colour coverage make it uncommon, and the guarantee does not protect Paula's body preference. There is no blanket prohibition and no guaranteed eventual match. These are current checkout/local-corpus findings, not verification of the deployed corpus or a replay of the original draw. No generation, tests, scratch allocations, product changes or Jira writes were performed for this follow-up. Taz retained the previously recorded model/effort and no descendants. The proposals below remain pending; this question does not adopt them.

## Proposed edits — approval required

These are exact proposed passages for editable, tracked project documents, not changes to an installed skill. Approved implementation would also reconcile dependent contracts and canonical policy through separately agreed scope. Existing claimed Story ACs, Jira statuses and ownership remain as recorded.

### A. Require permission before offering a different body style

Target: `employee-recommendation.md`, “Evaluation and presentation”, first paragraph.

**Before**

> Every supplied exact car receives a decision before recommendation display limits. Eligibility, confirmed essentials, allowance versus monthly points and timing run first. Only suitable exact candidates enter preference ranking. The separate preference value and importance preserve indifference; comfort and sportiness can coexist. Inference and strategic steering do not replace confirmed facts or essentials.

**Proposed after**

> Every supplied exact car receives a decision before recommendation display limits. Eligibility, confirmed essentials, allowance versus monthly points and timing run first. Only eligible exact candidates enter preference ranking. Eligibility and preference fit are reported separately. When an employee has an active, confirmed body-style preference with importance above the canonical indifference minimum, Buddy may automatically offer only an eligible car matching a selected body style, unless the employee has explicitly authorised a different-body alternative. If none qualifies, Buddy keeps looking and explains the blockers; other body styles may be shown as alternatives for explicit opt-in. Permission names the exact alternative and applies only to that offer in the current search; it does not carry into future searches. The separate preference value and importance preserve indifference; comfort and sportiness can coexist. Inference and strategic steering do not replace confirmed facts or essentials. This automatic-offer permission does not change scheme eligibility, saved importance or essential requirements, and applies consistently to previews, release allocation and follow-up offers.

This is a **new delegation rule for body style**, requiring agreement. It is not inferred from importance 80 and does not turn the saved preference into a scheme eligibility rule. The existing points and allocation-fairness policies still operate within the permitted candidates.

**Decision POC:** using the observed 34 blocked Tourings and zero body fit for the X2, the proposed decision is **keep looking, explain why, and offer an explicit choice to consider alternatives**. Adding a small eligible-Touring boundary selects the matching body instead. The indifference boundary leaves normal eligible ranking available when body importance is zero. Permission for one named alternative allows that car only in the current search, not another car or a future search. These in-memory decision examples passed scoped assertions; no allocation or hold was created.

**Next run:** Paula would see why the available Tourings do not qualify, instead of receiving an automatic SUV offer. Buddy could offer a particular SUV only after her explicit permission for that named alternative.

### B. Let Paula reaffirm an already-saved preference

Target 1: `hld-agreement-2026-11-04.md`, Q16 decision text. Preserve the historical agreement and append the approved successor decision if accepted.

**Before**

> After declining, Paula confirms one preference change, such as body style or an essential requirement, rather than lowering a Choices cash-contribution ceiling.

**Proposed successor**

> After declining, Paula can confirm one preference refinement or reaffirm the preference the offer failed. Reaffirmation records her feedback and keeps her current brief value, importance and version. A real change to body style or an essential requirement uses the canonical confirmed-change operation. A change in importance or permission to consider another body style requires its own explicit confirmation.

Target 2: `offer-followup-contract.md`, FUCQ-91 / FUCQ-30 source boundary.

**Before**

> Appends one approved version and `brief:changes` event, preserves remaining business fields, refuses repeated/no-op changes.

**Proposed after**

> A confirmed business change appends one approved version and `brief:changes` event, preserves remaining business fields, and refuses repeated/no-op changes. Reaffirming the already-saved preference is a separate, explicitly confirmed feedback action tied to the owned decline and current brief. It records an idempotent feedback receipt, preserves the brief value, importance and version, and completes the response. Continuation and later-offer comparison support both changed and reaffirmed briefs, using actual evaluation results. Reaffirmation alone neither strengthens a preference nor authorises an alternative body style.

The dependent question, confirmation, waiting and comparison passages would be reconciled to these two explicit outcomes. An unchanged ordinary edit would still be a no-op; this proposal does not weaken the shared reducer or invent a new brief version.

**Decision POC:** the actual hosted question was loaded into the existing controller. Choosing Estate returned invalid, `canConfirm: false`, and **zero network writes**. The proposed decision records **preference reaffirmed: Estate**, preserves importance **80** and brief version **2**, and resumes the search. “Waiting” in this POC is the proposed continuation decision, not a claim that a new live evaluation ran. The new feedback receipt and reload behavior remain to be implemented and verified.

**Next run:** Paula could select “I still want Estate” and complete her response. She would not have to choose a body style she does not want, and her preference would not silently become stronger.

### C. Review the whole preference-to-feedback decision

Target: `experience-quality.md`, “Author and brief each story”, item 2.

**Before**

> In `acceptance`, name the changed screen/interaction, the states it must handle and the observable visual/UX outcomes. Select the relevant states below rather than copying a generic polish checkbox.

**Proposed after**

> In `acceptance`, name the changed screen/interaction, the states it must handle and the observable visual/UX outcomes. For preference-led recommendation and rejection journeys, include a case where the employee rejects an offer because it fails an already-saved preference. Verify that they can retain that preference and complete their response without choosing an unwanted value. Review saved input, offered facts, feedback and the next evaluation together, including the case where released cars match the preference but fail eligibility or essentials. Any change to preference value, importance or permission for an alternative requires explicit employee confirmation. Select relevant states rather than copying a generic polish checkbox.

**Decision POC:** apply this review instruction to the observed Estate → SUV → Body style → Estate sequence. Against the proposed A–C rules, it fails review because automatic offering lacks compromise permission and the response cannot complete with the saved answer. The old changed-value test alone would not expose either gap. Under A and B's proposed decisions, the same scenario requires a keep-looking explanation and permits reaffirmation. This is a bounded review-decision exercise, not rendered UI validation.

**Next build/review:** the connected case becomes explicit future acceptance and review scope after agreement. It does not retroactively expand existing claimed Stories or establish their failure against newly proposed criteria.

## Validation, resource receipt and outstanding implementation

The investigation used read-only hosted offer, preview, history and follow-up requests in isolated HTTP sessions. It did not save preferences, change the release clock, create decisions, reset a run or change the user's foreground browser. Successful sessions logged out. The local controller reproduction and in-memory decision POCs passed. Independent investigator **Taz** reviewed the follow-up contract, history and this report. The report review found the zero-importance boundary and an unspecified alternative-consent scope; both proposals were corrected and the decision examples extended. Taz re-reviewed the corrected report and found no remaining material errors; that review approves accuracy, not adoption of the proposals. Requested/selected `gpt-6.1-sol` with `high` effort, no fallback or descendants. Effective runtime settings were not independently verified.

Local retained evidence is under `.claude/test-runs/paula-touring-diagnosis-20261111/`, with the impact map at `.claude/test-runs/impact/paula-touring-diagnosis-20261111.json`. The concise input and final POC output preserve the facts and decision results described above. These ignored local files are not shared deployment evidence.

Actual failed/setup attempts are retained in `initial-attempt-notes.json`: an initial synthetic equipment-scoring hypothesis failed its expected ordering and is **not the established incident cause**; duplicate empty expired-path cookies caused initial unknown-session reads before correction; and a lookup into an overwritten early log caused a POC setup KeyError before scratch allocation. Early supervisor calls reused a log filename, so concise findings were reconstructed from actual tool responses and the final POC used a separate log directory. The first malformed-cookie login session could not be explicitly revoked after its cookie was discarded; no local credential remains, and it expires under application policy.

Seven supervisor-owned scratch roots were verified removed, with **0 measured scratch bytes** and no filesystem leftovers or large-output compatibility exception. Concise summaries, manifests and bounded logs remain in the named run directory. Taz performed no test/scratch allocation.

No application test suite, native PostgreSQL check or rendered desktop/narrow UI review was run: there is no implementation change. The affected-test selector refused the unspecified Node runner; explicit scoped probes were selected instead. This is **scoped diagnosis and decision evidence**, not a passing full-suite or UI-completion claim. Documentation validation checks local links, quoted source passages and `git diff --check`.

After approval, agree bounded implementation scope before changing claimed contracts. Gary's project-wide Jira-write pause of 11 November remains binding: retain agreed scope and evidence in the repository, and reconcile Jira only after a collaborator explicitly unpauses Jira writes. Approval of these proposals alone does not lift that pause. Start with affected recommendation/allocation and follow-up policy/controller/service boundaries, including idempotency, reload and unchanged-version continuation. Verify an actual release-to-offer-to-decline continuation. Any UI implementation requires independent substantive desktop/narrow critique, realistic states and correction/reinspection under the standing experience contract. None of that implementation or acceptance is claimed here.
