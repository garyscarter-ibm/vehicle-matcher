# FUCQ-115 offline choice model contract

5 November 2026. Independent implementation under Gary's technical-readiness direction.
Story DEV-2026-11-04-092, branch `dev/DEV-2026-11-04-092`, base
`fc1e283a079aa2ffe6e0a78fe74ba3002e7b9cda`. This records implementation contracts and
proposals; neither source imports nor canonical policy adoption has occurred.

## Scope and stable gates

Product component: existing `demand-planning`; no boundary change. The full durable
plan is in `.product-map/work.json`: `contract`, `optimizer`, `dataset`, `evaluation`,
`artifact`, `policy`, `acceptance`. The last five include real producer/baseline,
policy and final delivery gates; unit fixtures cannot close them. Runtime prediction,
planning, a new screen and verified BMW calibration are outside this story.

The implementation is plain JavaScript, with no new runtime dependency. Its offline
model files have no repository writes, network, listener or active-run mutation.
Technical readiness follows actual interfaces rather than Jira journey order;
FUCQ-27/28/61 date holds and all other claims remain unchanged.

## Statistical boundary

Each example has a stable record, cycle and cohort identity, an observation instant,
the pre-choice brief and terms, eligible/available alternatives and one observed
choice. A final explicit `wait` alternative is always present. Conditional-logit
probabilities use stable log-sum-exp. The optimizer minimizes mean negative log
likelihood plus `lambda * sum(beta squared) / 2`, including the wait intercept.
Its full-batch descent, finite iteration bound and line search are deterministic.
Convergence status, gradient norm and loss remain visible even on poor runs.

Vehicle attributes and preference/importance interactions are explicit, versioned
features. Confirmed seat/boot requirements interact with candidate capacity; they
never authorize changing an essential gate. Choice-set membership remains the
published record producer's authority. Unknown facts are represented as missing,
not fabricated measurements. Draft/inferred preferences cannot silently become
confirmed intent. Outcomes, IDs, cohort labels, future observations and satisfaction
are not feature inputs. Learned probabilities are estimates, not deterministic fit.

Training uses earlier cycles and excludes every held-out cohort. Later-cycle
evaluation distinguishes familiar versus unseen cohorts. Reject overlaps, duplicate
record IDs, invalid time order and absent partitions; never repair a split by moving
records into training. The FUCQ-113 `renewal.cohort` is a cycle identity; a separate
policy-selected grade cohort holdout prevents calling temporal separation alone
generalization to an unseen employee group. Verify both cohorts have useful support.

Only explicit selected/accepted outcomes identify chosen vehicles; explicit waited
outcomes identify wait. Decline, expiry, pending and unobserved choice sets are
censored, with exclusion counts. Offered vehicles and missing outcomes are not
invented employee choices. Duplicate exact stock configurations retain their own
alternative identity, preventing target ambiguity.

## Evaluation and presentation

Report actual mean log loss and multiclass Brier score (sum across alternatives per
choice), probability-band reliability (one binary event per alternative), class and
cohort summaries, support and thin flags. Evaluate the same records against actual
FUCQ-99 expressed-demand and FUCQ-29 deterministic-fit computations; a fit-to-
probability mapping and smoothing must be explicitly reviewed policy assumptions.
The independent metric API accepts complete baseline distributions and provenance;
it rejects missing, negative, nonfinite or unnormalized probabilities. A fixture
distribution proves arithmetic only, never either real baseline integration.
Zero-probability outcomes are counted; a policy logarithm floor is reported.
Poor results are retained, including worse-than-baseline deltas.

A safe forecast/plan-panel fixture will expose only aggregate metrics, support,
versions, synthetic origin, limitations and baseline availability. No employee IDs,
records or predicted success copy. Backend-only: no new screenshots or components.
Future consumers follow `docs/gcsp/experience-quality.md`, `COMPONENTS.md`, current
Density and references `docs/gcsp/screens/00-employee-account.webp`,
`01-replace-vehicle.webp`, and `docs/gcsp/evidence/fucq-6/README.md` revision `a7fc178`.

## Artifact and policy

A canonical finite JSON payload includes schema/feature/model versions, named
coefficients, training settings/policy provenance, immutable source manifest,
partition identities/counts, computed evaluation, optimizer diagnostics, exclusions
and synthetic generator assumptions. SHA-256 of those bytes is its artifact ID.
Exclusive content-addressed creation never overwrites existing bytes. Readers verify
the digest and schema before accepting an artifact; corruption is unavailable.
Synthetic data is explicitly `synthetic-trained`. Basic logit's independence of
irrelevant alternatives and observational/counterfactual limits remain visible.

`fucq115-policy-proposal.json` is an exact additive proposal, not an active source.
Read all adopted training keys through one pinned PolicyService version; missing or
malformed keys return typed unavailable. No local fallback or second registry.
Activation reads `choice.model.reference` through PolicyService and uses existing
`publishPolicyVersion` dated publication. Historical pins remain readable; no active
quotes or prices change. The dispatcher must review/adopt keys through FUCQ-103's
reviewed-bundle interface and coordinate the one shared source before activation.

## Finite FUCQ-113 import and dataset proposal

`fucq115-source-proposal.json` records 29 transitive source files from published
`ddd884b33311b0d62225e107a4ba7d45a464c146`, each SHA-256 and current identity. Twenty-two
already match this branch. Five records modules, the CLI and the fixture need root review (seven
paths in total). No broad merge or dirty source copy is authorized. The JSON
source map is authoritative.
`policy-definitions.json` is an additional source proposal, not imported implicitly.

The committed six-record fixture SHA-256
`62d83d2caac6675a0f224cb86ff1d564d09f83596402458e506041facf0d5772` proves only schema.
Proposed meaningful bounded run: actual published generator, one seed, 80 fictional
employees across four nonoverlapping cycles (320 records), maximum 40,000 choice
entries, grade-cohort support checked before training, explicit wait/noise and
censoring reported. Retain canonical learning/comparison policy snapshots and input
hashes. A larger coefficient-recovery unit experiment may use a separately labelled
known-logit generator, but cannot masquerade as actual FUCQ-113 integration.
If source policy/corpus cannot produce useful partitions, record that exact failure
and continue independent checks. Structural configuration fixtures remain labelled;
they do not establish FUCQ-77 corpus or live observed-producer delivery.

## Validation and resources

Initial independent slice: new model modules and dedicated
`server/test/gcsp-choice-model.test.js`, explicit scoped `node --test
--test-concurrency=1 server/test/gcsp-choice-model.test.js`. Check coefficient
recovery, wait probabilities, numerical stability, split leakage, arithmetic,
serialization/digest integrity and typed policy failure as the modules arrive.
Actual generator, baseline service composition, canonical adoption/dated publish,
CLI run against committed data and final root-granted `npm test` remain separate
gates. New JavaScript has no reliable automatic affected-test map; explicit boundary
checks are selected by inspected imports, with no silent full-suite fallback.

Before every proof/test use `_tools/test_resources.py`: one worker, 120s,
768MiB RAM, 128MiB combined scratch/output, 2MiB logs. External ownership manifests,
HostBudget reservation, group supervisor/finalizer, checkpoints, database URL alias
and NODE_OPTIONS/debug-trace removal, stop/join and verified scratch/reservation
cleanup. Retain compact summaries and useful failures under the shared ignored
`.claude/test-runs`; no 256MiB allocation, native database, browser or corpus
collection. No full suite without the dispatcher's serial grant.

Agent: Pluto, requested/selected `gpt-6.1-sol` / `high`, no fallback. Effective session
settings are subject to dispatcher verification; no descendants in the initial slice.
