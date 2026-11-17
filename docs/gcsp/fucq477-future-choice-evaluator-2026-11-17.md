# FUCQ-477 future-choice evaluator and renewal helper (2026-11-17)

This is a source-only increment of original FUCQ-477 acceptance. Nothing was compiled or run. It ports the existing Node decisions into two standalone `gcsp.api.planning` classes. It is not Story completion: `PlanningDemand` is still unbound (see "Remaining").

## Files
| File | Ports | Author |
|---|---|---|
| `services/gcsp-api/src/main/java/gcsp/api/planning/PlanningRenewal.java` | `server/gcsp/predict/plan/renewal.js` `renewalInstant` | Claude coordinator |
| `services/gcsp-api/src/test/java/gcsp/api/planning/PlanningRenewalTest.java` | 8 cases | Claude coordinator |
| `services/gcsp-api/src/main/java/gcsp/api/planning/FutureChoiceEvaluator.java` | `server/gcsp/predict/plan/future-choices.js` `evaluateChoices` | Scrappy Doo (implementer) |
| `services/gcsp-api/src/test/java/gcsp/api/planning/FutureChoiceEvaluatorTest.java` | see the result file | Scrappy Doo (implementer) |

Neither class is a CDI bean or is wired anywhere. The interface is frozen in `.claude/results/fucq477-future-choice-interface-10.json`.

## PlanningRenewal
- **Contract source:** `employee.contract.manualContext.contracts`, filtered to `status == "current"`.
  - More than one current contract gives null.
  - The date comes from the one current contract if there is one, or else from `employee.contract.contractEndDate`.
  - A current contract with no date does not fall back to the top-level date.
- **Date format:** only a plain `yyyy-MM-dd` string is accepted. The result is `<date>T23:59:59.999Z`, F112's UTC end of day. It must also pass the planner's instant rule (`JsTime.parse`), so impossible days such as 2027-02-30 are null.
- **Where Node throws, Java throws too:** no employee, `contracts` present but not an array, or a null contract entry. In Node those are TypeErrors, which the evaluator's catch turns into `planning-future-evaluation-unavailable`. Java keeps the same outcome.
- The coordinator checked every test case against Node's `renewalInstant` directly with `node` (read-only, no project code changed).

**End of day is the existing contract.** Java `Prepare.due` (`Prepare.java:291`) uses the start of the day for a different purpose. Prepare is read-only here and is not changed. Planning follows Node and F112.

## FutureChoiceEvaluator
See the result file for the full mapping and deviations: `.claude/results/claude-assist-fucq477-future-choice-source-2026-11-17-10.md`.
- **Constructor:** `FutureChoiceEvaluator(PolicyService, PolicyFutureTerms)`. **Call:** `evaluateChoices(Principal, JsonNode input)`.
- **Identity:** Node's `identity.requireRole(context, 'greg')`, before and after, is `OrderPlanService.greg(principal)`. A refusal gives `Outcomes.forbidden()`.
- **Shared helpers it reuses:** `recommendation.BriefRules`, `Gates`, `PreferenceScoring`, `RecommendationConfig` and `Slider`; `evidence.CanonicalJson.digest`; and planning's `Js`, `JsTime`, `Outcomes` and `PolicyFutureTerms`. All are public or in the same package, and none was edited.

## Remaining for FUCQ-477 (not in this increment)
- **No PlanningDemand binding yet:** nothing yet reads the cohort, history and catalogue from the database and calls this evaluator. Readiness 06 sizes those as slice A, the cohort reader (about 3 points), and slice C, the PostgreSQL `PlanningDemand` bean (about 2 points).
- **FUCQ-515 (M1) is open:** hold expiry is on wall time, while the planner is on the run clock.

## Unrun
Nothing here was compiled, tested or executed. Suggested selection for a later grant:
- `-Dtest=PlanningRenewalTest,FutureChoiceEvaluatorTest` in `services/gcsp-api`.
- Both are plain JUnit 5 with no PostgreSQL, so they fit one chunk.
