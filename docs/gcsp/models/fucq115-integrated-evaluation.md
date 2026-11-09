# FUCQ-115 integrated evaluation (real demo fleet)

Status: **not evaluated, in either run.** The FUCQ-99 expressed-demand baseline cannot be built on the real
corpus, so the trainer refuses (`baseline-unavailable`, `FUCQ-99.exact-body-count`). No artifact was written.
`artifacts/2ce1109d...json` and `evaluation-summary.fixture.json` (80x4 fixture run) are unchanged. Nothing is
activated; the FUCQ-29 deterministic baseline still drives the plan.

## Root cause
The corpus `gcsp-demo-fleet` 2026-11-08.1 (240 builds, manifest digest `7c9cc707ab44...45a9c`) has **no body
or fuel fact for any build** (240 of 240 unknown). FUCQ-99 demand is keyed by body, and every offered
alternative has no body, so no exact count can be matched. Cohort size is not the cause. The small-count
rule (`greg.demand.smallCountThreshold` 5) also hides thin groups; neither it nor any learning.* default was lowered.

## Run A: default policy, 12 x 3 (36 records)
Regenerate: `node scripts/gcsp/generate-learning-records.mjs --seed 1 --output DIR` (deterministic, dataHash
`1e4fcfcccc2babac...782537` reproduced; policy `gcsp-policy-v1+fucq113-learning-v1`, generator
`learning-records.sha256.v1`). The reviewed split needs cycles 2 and 3, so the trainer publishes a dated
`+evaluation-cycles` successor keeping cycle 2. 26 choices (10 censored): training 16, held-out 9
(unseen G8-10 1, familiar 8), excluded 1. Training employees: 10, every body group under 5.

## Run B: offline sensitivity, 60 x 4 (240 records)
`node scripts/gcsp/run-integrated-choice-evaluation.mjs` adopts both reviewed sets, then publishes one dated
successor (`+sensitivity`) from `fucq115-sensitivity-60x4.json` (learning.cohortSize 60, learning.cycles 4;
assumed, offline only). With exactly those two keys generation stops: `learning.maximumChoiceEntries` (4096)
is exceeded, as 240 records x 51 cars (cohort 60 x 0.85) = 12240. A scratch run with that third key raised
(not committed) generated deterministically (dataHash `83271690e817...c230f814`, reproduced on a second run;
policy `...+sensitivity`): 184 offered, 110 selected, 115 accepted, 14 declined, 55 expired, 56 waited.
- 69 censored, 171 choices: training 68, held-out 82 (unseen G8-10 20, familiar 62), excluded 21.
- Training employees 41 by desired body: estate 14, saloon 17, suv 6, unspecified 4 (under 5, suppressed).
- Offered alternatives by body: 1077 of 1077 have none. The baseline still returns unavailable.

## Run A exploratory (uncommitted): model versus FUCQ-29 only, held-out choices
| Set (n) | Model log loss / Brier | FUCQ-29 log loss / Brier |
|---|---|---|
| later (9) | 0.885 / 0.447 | 0.738 / 0.386 |
| familiar (8) | 0.815 / 0.403 | 0.695 / 0.358 |
| unseen G8-10 (1) | 1.446 / 0.799 | 1.083 / 0.608 |

The model is worse on every row; all rows are thin (below 20). Optimizer stopped at its iteration limit.

## Honest limits
Synthetic-trained: labels come from the FUCQ-113 generator (latent fit, uniform noise, wait propensity,
constrained supply), not BMW employee choices or a logit process. Without body or fuel facts the model's
vehicle features are mostly empty. A three-way comparison needs body (or an agreed class mapping) on the
fleet, which is a product decision, not a model change. Observational points associations are not causal.
