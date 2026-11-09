// SYNTHETIC fixtures for Greg's order plan panel: fictional cars and counts, no real employee or retailer.
// Shapes copy the recorded server values (server/test/fixtures/gcsp-order-plan-operations.json); outcomes go through planOutcome.
import { planOutcome, PLAN_MESSAGES } from './http-adapter.js';

export const FIXTURE_NAMES = Object.freeze(['loading', 'ready', 'no-demand', 'preview', 'infeasible', 'stale', 'submitted', 'replanned', 'unavailable', 'refused', 'learned', 'learned-coverage']);

const T0 = '2026-11-05T09:00:00.000Z';
const T1 = '2026-11-05T09:01:00.000Z';
const BASIS = 'deterministic-acceptable-matching-before-renewal';
// Long names on purpose: the panel must wrap them.
const CATALOGUE = [
  { id: 'g20-saloon-320i', modelId: 'g20-saloon', model: '3 Series Saloon', derivative: '320i', cost: 3900000, max: 3 },
  { id: 'g20-saloon-330e', modelId: 'g20-saloon', model: '3 Series Saloon', derivative: '330e', cost: 4600000, max: 2 },
  { id: 'g21-touring-320i', modelId: 'g21-touring', model: '3 Series Touring', derivative: '320i', cost: 4200000, max: 3 },
  { id: 'g61-i5-40', modelId: 'g61-i5', model: 'i5 Touring', derivative: 'eDrive40 M Sport Pro with Technology Plus and Comfort Packs', cost: 6200000, max: 2 },
];
const MODEL_MAX = { 'g20-saloon': 4, 'g21-touring': 3, 'g61-i5': 2 };
const TOURING = 'g21-touring-320i';
const I5 = 'g61-i5-40';

const FALLBACK_BASE = 'only the baseline plan from expressed demand is shown';
const learnedFallback = () => ({ status: 'fallback', label: 'Synthetic-trained model', recommended: false, submittable: false, reason: 'no-active-model',
  limitation: `No learned model is active, so ${FALLBACK_BASE}.` });
const learnedCoverage = () => ({ status: 'fallback', label: 'Synthetic-trained model', recommended: false, submittable: false, reason: 'outside-coverage',
  limitation: `Some employees or vehicle classes are outside what the model was trained on, so ${FALLBACK_BASE}.`,
  coverage: { cohorts: ['G8-10'], vehicleClasses: ['unknown'] }, model: { artifactId: 'sha256:90100e040d79c3a31201dc9e7785d2c544557be8722511a6c3143aef1b36fb17', featureVersion: 'choice-features.v1' } });
const score = (logLoss, brier, count, thin = false) => ({ count, logLoss, brier, zeroProbabilityOutcomes: 0, thin });
// Delta is learned minus baseline, as the server computes it.
function differencesFor(base, plan) {
  const pair = (read) => { const [b, l] = [read(base), read(plan)]; return { baseline: b, learned: l, delta: l - b }; };
  const qty = (p, id) => p.quantities.find((q) => q.derivativeId === id)?.quantity ?? 0;
  return { comparable: true, coverage: pair((p) => p.expectedAcceptableCoverage.covered), orderQuantity: pair((p) => p.orderQuantity), spendMinor: pair((p) => p.spendMinor),
    unmetNeeds: pair((p) => p.unmetNeeds.length),
    derivatives: CATALOGUE.map((d) => { const row = pair((p) => qty(p, d.id)); return { derivativeId: d.id, ...row, changed: row.delta !== 0 }; }) };
}
// A realistic learned result: one derivative up, one down, the long i5 name unchanged.
const learnedAvailable = (base) => {
  const plan = feasible({ id: 'learned001', q: { 'g20-saloon-320i': 1, [TOURING]: 1, [I5]: 1 }, covered: 4, total: 4, risk: [0, 4] });
  return { status: 'available', label: 'Synthetic-trained model', recommended: false, submittable: false, plan,
    forecast: { version: 'forecast.learned.v1', model: { artifactId: 'sha256:90100e040d79c3a31201dc9e7785d2c544557be8722511a6c3143aef1b36fb17', featureVersion: 'choice-features.v1', modelVersion: 'choice-model.v1',
      activationPolicyVersion: 'gcsp-policy-v1', activationEffectiveFrom: '2026-11-04T00:00:00.000Z' },
    data: { dataHash: 'sha256:27281203f346f5155eacd89c55cf4c87a21a1027c5790d7ea8a4ed012319efe0', datasetKind: 'synthetic', generatorVersion: 'learning-generator.v1', trainingPolicyVersion: 'gcsp-policy-v1' },
    settings: { choiceMassThreshold: 0.8, waitExclusionThreshold: 0.5, intervalZ: 1.96 }, modelExpectsWait: 0.18,
    aggregate: [{ vehicleClass: 'estate', period: '2027-02', employees: 4, expected: 2.1, low: 0.8, high: 3.4 }],
    evaluation: { label: 'Synthetic-trained; offline evaluation', partitionCounts: { train: 2400, validation: 480, later: 640 },
      overall: { learned: score(0.912, 0.478, 640), expressedDemand: score(1.204, 0.601, 640), deterministicFit: score(1.086, 0.553, 640) },
      deltas: {}, thin: { cohorts: [], vehicleClasses: ['estate'] } },
    limitations: ['Trained on synthetic data; this does not describe validated BMW employee behaviour.',
      'Probabilities are the model\'s estimate over each employee\'s permitted vehicles or waiting, not a fit score.'] },
    differences: differencesFor(base, plan) };
};
const presentation = () => ({ forecastBasis: 'expressed-saved-demand', editableKeys: ['orderPlan.modelBounds', 'orderPlan.derivativeBounds', 'orderPlan.budgetMinor'],
  currency: 'GBP', derivatives: CATALOGUE.map((d) => ({ derivativeId: d.id, modelId: d.modelId, model: d.model, derivative: d.derivative })),
  models: Object.keys(MODEL_MAX).map((modelId) => ({ modelId, model: CATALOGUE.find((d) => d.modelId === modelId).model })) });

const provenance = (policyVersion, { budget = 20000000, derivativeMax = {}, modelMin = {} } = {}) => {
  const row = (key, value, unit) => ({ key, value, unit, status: 'assumed', basis: 'Synthetic fixture value.', source: 'fixture', sourceDate: '2026-11-05', policyVersion, effectiveFrom: '2026-11-04T00:00:00.000Z' });
  return [row('orderPlan.horizonDays', 120, 'days'), row('orderPlan.budgetMinor', budget, 'GBP minor units'), row('orderPlan.currency', 'GBP', 'ISO currency'),
    row('orderPlan.modelBounds', Object.entries(MODEL_MAX).map(([modelId, max]) => ({ modelId, min: modelMin[modelId] ?? 0, max })), 'vehicles'),
    row('orderPlan.derivativeBounds', CATALOGUE.map((d) => ({ derivativeId: d.id, min: 0, max: derivativeMax[d.id] ?? d.max })), 'vehicles'),
    row('orderPlan.objectiveWeights', { coverage: 100, unallocatedStock: 10, costMinor: 0 }, 'weights'), row('supply.leadTimeDays', 56, 'days')];
};

const versions = (clock, policy = 'gcsp-policy-v1', tag = 'a') => ({ forecast: `forecast-${tag}-${clock}`, cohort: 'cohort-1', policy, stock: 'stock-1', supply: `supply-${clock}`,
  catalog: `${policy}:order-plan-catalog.v1`, clock: String(clock) });

// One feasible plan from plain numbers, with every key the live plan has.
function feasible({ id, at = T0, clock = 1, policy = 'gcsp-policy-v1', q = {}, covered, total, risk, unmet = [], binding = [], alternatives = [], extra = {}, supply, unbound }) {
  const quantities = CATALOGUE.map((d) => ({ derivativeId: d.id, modelId: d.modelId, quantity: q[d.id] ?? 0 }));
  const modelQuantities = Object.keys(MODEL_MAX).map((modelId) => ({ modelId, quantity: quantities.filter((x) => x.modelId === modelId).reduce((n, x) => n + x.quantity, 0) }));
  const spendMinor = quantities.reduce((n, x) => n + x.quantity * CATALOGUE.find((d) => d.id === x.derivativeId).cost, 0);
  const view = { quantities, modelQuantities, allocations: [], expectedAcceptableCoverage: { covered, total, fraction: total ? covered / total : 0, basis: BASIS },
    unallocatedStockRisk: { quantity: risk[0], totalSupply: risk[1], basis: 'unmatched-supply-within-horizon', bySource: risk[2] ?? [] },
    spendMinor, currency: 'GBP', orderQuantity: quantities.reduce((n, x) => n + x.quantity, 0),
    objective: { value: 100 * covered - 10 * risk[0], weights: { coverage: 100, unallocatedStock: 10, costMinor: 0 }, terms: { coverage: 100 * covered, unallocatedStock: -10 * risk[0], cost: 0 },
      tradeOff: 'Maximise weighted acceptable coverage, less unmatched supply and order cost; budget and quantity bounds remain hard.' },
    bindingConstraints: binding, unmetNeeds: unmet };
  const alt = (kind, spec, same) => ({ kind, status: 'feasible', ...spec, identicalToRecommendation: same });
  return { contractVersion: '1.0.0', planId: `order-plan-${id}`, runId: 'demo-fixture-run', asOf: at, versions: versions(clock, policy, id),
    limitations: ['Saved confirmed briefs only; employees without a saved brief are not inferred.'],
    solver: { method: 'bounded-exhaustive-integer-search-with-capacity-matching', limits: { derivatives: 12, entitlements: 128, supplyLots: 256, candidatePlans: 50000, matchingSteps: 2000000 },
      complete: true, optimalWithinDeclaredModel: true, visited: 72, feasibleCount: 13, matchingSteps: 13 },
    status: 'feasible', ...view, alternatives: alternatives.map((a) => alt(a.kind, { ...view, ...a.spec }, a.same === true)),
    currentDraftComparison: null, policyProvenance: provenance(policy, extra.provenance), supplyActivity: supply ?? { requests: [], responses: [] },
    unboundStock: unbound ?? { count: 0, models: [] } };
}

const touring2 = { [TOURING]: 2, [I5]: 1 };
// The solver reports every minimum of 0 as binding; the panel leaves these out.
const ZERO_MINIMUMS = [{ id: 'derivative:g20-saloon-320i:min', detail: 'Quantity meets minimum 0.' }, { id: 'model:g20-saloon:min', detail: 'Quantity meets minimum 0.' }];
const planned = (extra = {}) => feasible({ id: 'ready0001', q: touring2, covered: 3, total: 4, risk: [1, 4, [{ sourceId: `order:${I5}`, quantity: 1 }]],
  binding: [...ZERO_MINIMUMS, { id: 'derivative:g61-i5-40:max', detail: 'Quantity meets maximum 1.' }, { id: 'model:g61-i5:max', detail: 'Quantity meets maximum 1.' }],
  unmet: [{ entitlementId: 'slot-fixture-1', renewalAt: '2027-02-15T23:59:59.999Z', gates: ['acceptable-supply-scarcity', 'arrival-after-renewal'],
    constraintIds: [`derivative:${I5}:max`, `lead-time-before-renewal:${I5}`] }],
  alternatives: [{ kind: 'zero-new-orders-baseline', spec: { quantities: CATALOGUE.map((d) => ({ derivativeId: d.id, modelId: d.modelId, quantity: 0 })), spendMinor: 0, orderQuantity: 0,
    expectedAcceptableCoverage: { covered: 1, total: 4, fraction: 0.25, basis: BASIS }, unallocatedStockRisk: { quantity: 0, totalSupply: 1, basis: 'unmatched-supply-within-horizon', bySource: [] } } },
  { kind: 'next-best-distinct-feasible', spec: { quantities: CATALOGUE.map((d) => ({ derivativeId: d.id, modelId: d.modelId, quantity: d.id === TOURING ? 2 : 0 })), spendMinor: 8400000, orderQuantity: 2,
    expectedAcceptableCoverage: { covered: 2, total: 4, fraction: 0.5, basis: BASIS }, unallocatedStockRisk: { quantity: 1, totalSupply: 3, basis: 'unmatched-supply-within-horizon', bySource: [{ sourceId: `order:${TOURING}`, quantity: 1 }] } } }],
  ...extra });

const readValue = (plan, replan = { status: 'no-submission' }, learned = learnedFallback()) => ({ mode: 'current', preview: false, plan, replan, presentation: presentation(), learned });
const READY = () => readValue(planned());
const LEARNED = () => { const plan = planned(); return readValue(plan, undefined, learnedAvailable(plan)); };
const LEARNED_COVERAGE = () => readValue(planned(), undefined, learnedCoverage());
const NO_DEMAND = () => readValue(feasible({ id: 'nodemand1', covered: 0, total: 0, risk: [0, 0],
  alternatives: [{ kind: 'zero-new-orders-baseline', same: true, spec: {} }] }));

const CHANGES = [{ key: 'orderPlan.derivativeBounds', value: CATALOGUE.map((d) => ({ derivativeId: d.id, min: 0, max: d.id === TOURING ? 1 : d.max })) }];
const PREVIEW = (withLearned = false) => {
  const policy = 'preview-fixture0001';
  const plan = feasible({ id: 'preview001', policy, q: { [TOURING]: 1, [I5]: 1 }, covered: 2, total: 4, risk: [1, 3, [{ sourceId: `order:${I5}`, quantity: 1 }]],
    binding: [{ id: `derivative:${TOURING}:max`, detail: 'Quantity meets maximum 1.' }],
    unmet: [{ entitlementId: 'slot-fixture-1', renewalAt: '2027-02-15T23:59:59.999Z', gates: ['acceptable-supply-scarcity'], constraintIds: [`derivative:${TOURING}:max`] }],
    alternatives: [{ kind: 'zero-new-orders-baseline', spec: { quantities: CATALOGUE.map((d) => ({ derivativeId: d.id, modelId: d.modelId, quantity: 0 })), spendMinor: 0, orderQuantity: 0,
      expectedAcceptableCoverage: { covered: 1, total: 4, fraction: 0.25, basis: BASIS }, unallocatedStockRisk: { quantity: 0, totalSupply: 1, basis: 'unmatched-supply-within-horizon', bySource: [] } } }],
    extra: { provenance: { derivativeMax: { [TOURING]: 1 } } } });
  return { mode: 'preview', preview: true, writes: 'none', message: 'Preview only. Nothing is saved, published or ordered.', activePolicyVersion: 'gcsp-policy-v1',
    draftPolicyVersion: policy, changes: CHANGES, plan, activePlan: planned(), presentation: presentation(), learned: withLearned ? learnedAvailable(plan) : learnedFallback() };
};
const INFEASIBLE = () => {
  const policy = 'preview-fixture0002';
  const plan = { contractVersion: '1.0.0', planId: 'order-plan-infeasible1', runId: 'demo-fixture-run', asOf: T0, versions: versions(1, policy, 'infeasible1'),
    limitations: ['Saved confirmed briefs only; employees without a saved brief are not inferred.'],
    solver: { method: 'bounded-exhaustive-integer-search-with-capacity-matching', limits: { derivatives: 12, entitlements: 128, supplyLots: 256, candidatePlans: 50000, matchingSteps: 2000000 }, complete: true, visited: 144 },
    status: 'infeasible', quantities: [], conflicts: [{ id: 'budget', detail: 'Spend 6200000 exceeds 5000000 GBP minor units.' }, { id: 'model:g61-i5:min', detail: 'Minimum 1.' }],
    conflictAnalysis: 'explanatory-non-minimal-constraint-set', alternatives: [], policyProvenance: provenance(policy, { budget: 5000000, modelMin: { 'g61-i5': 1 } }),
    supplyActivity: { requests: [], responses: [] }, unboundStock: { count: 0, models: [] } };
  return { mode: 'preview', preview: true, writes: 'none', message: 'Preview only. Nothing is saved, published or ordered.', activePolicyVersion: 'gcsp-policy-v1',
    draftPolicyVersion: policy, changes: [{ key: 'orderPlan.budgetMinor', value: 5000000 }, { key: 'orderPlan.modelBounds', value: Object.entries(MODEL_MAX).map(([modelId, max]) => ({ modelId, min: modelId === 'g61-i5' ? 1 : 0, max })) }],
    plan, activePlan: planned(), presentation: presentation(), learned: learnedFallback() };
};

const request = (state, quantity, derivativeId = TOURING) => ({ requestId: `request-fixture-${derivativeId === TOURING ? 1 : 2}`, commandId: `sub-1:${derivativeId}`, derivativeId, quantity, state, requestedAt: T0 });
const MIN_TWO = () => [{ key: 'orderPlan.derivativeBounds', value: CATALOGUE.map((d) => ({ derivativeId: d.id, min: d.id === TOURING ? 2 : 0, max: d.max })) }];
const submittedRequests = () => [request('requested', 2), request('requested', 1, I5)];
const SUBMITTED = () => readValue(planned({ supply: { requests: submittedRequests(), responses: [] } }),
  { status: 'unchanged-since-submission', submittedPlanId: 'order-plan-ready0001', submittedAt: T0, currentPlanId: 'order-plan-ready0001', changes: MIN_TWO(), requests: submittedRequests(), responses: [] });
// Min 2 was set only in the draft that was submitted, so the plan under the active limits orders nothing (FUCQ-290).
const REQUESTED_NO_ORDER = () => readValue(feasible({ id: 'noorder001', q: {}, covered: 1, total: 4, risk: [0, 1], binding: [...ZERO_MINIMUMS, { id: 'derivative:g21-touring-320i:min', detail: 'Quantity meets minimum 0.' }],
  supply: { requests: [request('requested', 2)], responses: [] } }),
{ status: 'unchanged-since-submission', submittedPlanId: 'order-plan-preview001', submittedAt: T0, currentPlanId: 'order-plan-noorder001', changes: MIN_TWO(), requests: [request('requested', 2)], responses: [] });
const REPLANNED = () => {
  const after = { kind: 'partly-confirmed', requestId: 'request-fixture-1', supplyId: 'supply-1', quantity: 1, at: T1 };
  const plan = feasible({ id: 'replanned1', at: T1, clock: 2, q: { [TOURING]: 1, [I5]: 1 }, covered: 3, total: 4, risk: [1, 4, [{ sourceId: 'supply:supply-1', quantity: 1 }]],
    binding: [{ id: 'derivative:g61-i5-40:max', detail: 'Quantity meets maximum 1.' }],
    alternatives: [{ kind: 'zero-new-orders-baseline', spec: { quantities: CATALOGUE.map((d) => ({ derivativeId: d.id, modelId: d.modelId, quantity: 0 })), spendMinor: 0, orderQuantity: 0,
      expectedAcceptableCoverage: { covered: 2, total: 4, fraction: 0.5, basis: BASIS }, unallocatedStockRisk: { quantity: 0, totalSupply: 1, basis: 'unmatched-supply-within-horizon', bySource: [] } } }],
    supply: { requests: [request('partly-confirmed', 2)], responses: [after] } });
  return readValue(plan, { status: 'replanned', submittedPlanId: 'order-plan-ready0001', submittedAt: T0, currentPlanId: plan.planId, changes: MIN_TWO(), requests: [request('partly-confirmed', 2)], responses: [after], after });
};
const SUBMISSION = () => ({ submissionId: 'submission-fixture0001', planId: 'order-plan-ready0001', message: 'Requested. Production has not confirmed any of this yet.',
  requests: [TOURING, I5].map((derivativeId, i) => ({ derivativeId, commandId: `fixture-submit:${derivativeId}`, quantity: touring2[derivativeId], status: 'ok',
    request: { requestId: `request-fixture-${i + 1}`, state: 'requested' } })) });
const STALE_BODY = () => ({ status: 'conflict', code: 'replan-needed', reason: 'Inputs changed since the preview. Replan before submitting.', changedInputs: ['stock', 'plan'],
  current: { planId: 'order-plan-fresh0001', versions: versions(1, 'gcsp-policy-v1', 'fresh0001') }, contractVersion: '1.0.0' });

/** Server values by name, for shape tests and galleries. Every call returns fresh objects. */
export const FIXTURE_VALUES = Object.freeze({ ready: READY, learned: LEARNED, 'learned-coverage': LEARNED_COVERAGE, 'no-demand': NO_DEMAND, preview: () => PREVIEW(), infeasible: INFEASIBLE, submitted: SUBMITTED, 'requested-no-order': REQUESTED_NO_ORDER, replanned: REPLANNED,
  submission: SUBMISSION, 'stale-body': STALE_BODY });

function never(signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) reject(new DOMException('Aborted', 'AbortError'));
    signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
  });
}
const ready = (make) => async () => planOutcome(200, { status: 'ok', value: make() });

/** { readPlan, previewPlan, submitPlan } for the named fixture, or null when the name is unknown. The preview and infeasible states are reached by previewing. */
export function planFixtureAdapter(name) {
  if (!FIXTURE_NAMES.includes(name)) return null;
  const same = (outcome) => ({ readPlan: async () => outcome(), previewPlan: async () => outcome(), submitPlan: async () => outcome() });
  if (name === 'unavailable') return same(() => planOutcome(503, { status: 'unavailable' }));
  if (name === 'refused') return same(() => planOutcome(403, { status: 'forbidden' }));
  const reads = { loading: READY, ready: READY, learned: LEARNED, 'learned-coverage': LEARNED_COVERAGE, 'no-demand': NO_DEMAND, preview: READY, infeasible: READY, stale: READY, submitted: SUBMITTED, replanned: REPLANNED };
  const previews = { infeasible: INFEASIBLE, learned: () => PREVIEW(true) };
  return {
    readPlan: name === 'loading' ? ({ signal } = {}) => never(signal) : ready(reads[name]),
    previewPlan: ready(previews[name] ?? (() => PREVIEW())),
    submitPlan: name === 'stale' ? async () => planOutcome(409, STALE_BODY()) : ready(SUBMISSION),
  };
}

export { PLAN_MESSAGES };
