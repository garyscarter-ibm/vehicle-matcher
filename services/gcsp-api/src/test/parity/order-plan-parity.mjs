// Offline generator for src/test/resources/order-plan-parity/cases.json.gz (gzip keeps ~1 MB of JSON near 60 KB; never run by the Java tests).
// Run from the repository root: node services/gcsp-api/src/test/parity/order-plan-parity.mjs
// Needs server/node_modules (the policy module imports pg). Prints Node wall time per heavy case.
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { planOrder } from '../../../../../server/gcsp/predict/plan/solver.js';
import { readPlanningPolicy } from '../../../../../server/gcsp/predict/plan/policy.js';
import { createPolicyOrderPlanCatalog } from '../../../../../server/gcsp/predict/plan/catalog.js';
import { createPolicyService } from '../../../../../server/gcsp/policy/index.js';
import { planningInput } from '../../../../../server/test/helpers/order-plan-input.js';

const here = dirname(fileURLToPath(import.meta.url));
const seedPath = join(here, '../../../../../server/gcsp/policy/seed-v1.json');
const outPath = join(here, '../resources/order-plan-parity/cases.json.gz');
const clone = (v) => JSON.parse(JSON.stringify(v));
const seed = JSON.parse(await readFile(seedPath, 'utf8'));
const ASOF = '2026-11-06T00:00:00.000Z';
const day = 86400000;
const iso = (ms) => new Date(ms).toISOString();

const cases = [];
const timings = [];
const names = new Set();
function plan(id, category, mutate = () => {}, base = planningInput()) {
  if (names.has(id)) throw new Error(`duplicate case ${id}`);
  names.add(id);
  let input = clone(base); const replaced = mutate(input); if (replaced !== undefined) input = replaced;
  const t = process.hrtime.bigint();
  const expected = planOrder(clone(input));
  const ms = Number(process.hrtime.bigint() - t) / 1e6;
  timings.push([id, ms]);
  cases.push({ id, category, kind: 'plan', input, expected: clone(expected) });
}
const inboundRow = (o = {}) => ({ supplyId: 'ack-1', derivativeId: 'a', quantity: 1, releasedQuantity: 0, state: 'confirmed',
  expectedAt: '2026-11-26T00:00:00.000Z', provenance: { sourceVersion: 'production-v1' }, ...o });
const stockRow = (id, d, o = {}) => ({ stockId: id, derivativeId: d, availableAt: ASOF, heldForEntitlementId: null, ...o });

// Feasible, substitution, held, excluded, visibility, inbound, release, lead time, deadlines.
plan('feasible/helper-input', 'feasible');
plan('feasible/competition-substitution', 'feasible', (s) => { s.constraints.derivativeBounds.forEach((b) => { b.max = 0; }); s.stock = [stockRow('first', 'a'), stockRow('second', 'b')]; });
plan('feasible/competition-one-short', 'feasible', (s) => { s.constraints.derivativeBounds.forEach((b) => { b.max = 0; }); s.stock = [stockRow('first', 'a')]; });
plan('feasible/held-stock', 'feasible', (s) => { s.constraints.budgetMinor = 0; s.stock = [stockRow('held', 'a', { heldForEntitlementId: 'flexible' })]; });
plan('feasible/held-for-unknown-entitlement', 'feasible', (s) => { s.constraints.budgetMinor = 0; s.stock = [stockRow('held', 'a', { heldForEntitlementId: 'outside-cohort:slot-z' })]; });
plan('feasible/excluded-stock', 'feasible', (s) => { s.constraints.budgetMinor = 0; s.forecast.entitlements[0].excludedStockIds = ['only']; s.stock = [stockRow('only', 'a')]; });
plan('feasible/excluded-stock-other-lot', 'feasible', (s) => { s.constraints.budgetMinor = 0; s.forecast.entitlements[0].excludedStockIds = ['only', 'never']; s.stock = [stockRow('only', 'a'), stockRow('spare', 'a')]; });
plan('feasible/visibility-permitted', 'feasible', (s) => { s.constraints.budgetMinor = 0; s.stock = [stockRow('restricted', 'a', { permittedEntitlementIds: ['flexible'] })]; });
plan('feasible/visibility-empty-list', 'feasible', (s) => { s.constraints.budgetMinor = 0; s.stock = [stockRow('nobody', 'a', { permittedEntitlementIds: [] })]; });
plan('feasible/visibility-null', 'feasible', (s) => { s.constraints.budgetMinor = 0; s.stock = [stockRow('open', 'a', { permittedEntitlementIds: null })]; });
plan('feasible/inbound-on-renewal-boundary', 'feasible', (s) => { s.inbound = [inboundRow()]; });
plan('feasible/inbound-one-ms-after-renewal', 'feasible', (s) => { s.inbound = [inboundRow({ expectedAt: '2026-11-26T00:00:00.001Z' })]; });
plan('feasible/inbound-one-ms-before-renewal', 'feasible', (s) => { s.inbound = [inboundRow({ expectedAt: '2026-11-25T23:59:59.999Z' })]; });
plan('feasible/inbound-offset-instant', 'feasible', (s) => { s.inbound = [inboundRow({ expectedAt: '2026-11-26T01:00:00+01:00' })]; });
plan('feasible/inbound-after-horizon', 'feasible', (s) => { s.inbound = [inboundRow({ expectedAt: '2026-12-07T00:00:00.000Z' })]; });
plan('feasible/released-quantities', 'feasible', (s) => { s.constraints.budgetMinor = 0; s.stock = [stockRow('released-1', 'a')]; s.inbound = [inboundRow({ quantity: 1, releasedQuantity: 1, expectedAt: s.asOf })]; });
plan('feasible/released-partial', 'feasible', (s) => { s.inbound = [inboundRow({ quantity: 3, releasedQuantity: 1, expectedAt: '2026-11-10T00:00:00Z' })]; });
plan('feasible/lead-time-after-renewal', 'feasible', (s) => { s.catalog.forEach((d) => { d.leadTimeDays = 21; }); });
plan('feasible/lead-time-exactly-renewal', 'feasible', (s) => { s.catalog.forEach((d) => { d.leadTimeDays = 20; }); });
plan('feasible/lead-time-mixed', 'feasible', (s) => { s.catalog[0].leadTimeDays = 31; s.catalog[1].leadTimeDays = 5; });
plan('feasible/horizon-exactly-reached', 'feasible', (s) => { s.catalog[0].leadTimeDays = 30; });
plan('feasible/renewal-already-passed', 'feasible', (s) => { s.forecast.entitlements.forEach((e) => { e.renewalAt = '2026-11-05T00:00:00.000Z'; }); s.stock = [stockRow('old', 'a', { availableAt: '2026-11-04T00:00:00.000Z' })]; });
plan('feasible/requiredBy-earlier-than-renewal', 'feasible', (s) => { s.forecast.entitlements[0].requiredBy = '2026-11-12T00:00:00.000Z'; });
plan('feasible/requiredBy-allows-order', 'feasible', (s) => { s.forecast.entitlements.forEach((e) => { e.requiredBy = '2026-11-16T00:00:00.000Z'; }); });
plan('feasible/requiredBy-one-ms-short', 'feasible', (s) => { s.forecast.entitlements.forEach((e) => { e.requiredBy = '2026-11-15T23:59:59.999Z'; }); });
plan('feasible/requiredBy-already-passed', 'feasible', (s) => { s.forecast.entitlements[0].requiredBy = '2026-11-05T00:00:00.000Z'; s.forecast.entitlements[0].renewalAt = '2026-11-05T00:00:00.000Z'; s.forecast.entitlements[1].requiredBy = '2026-11-05T12:00:00.000Z'; });
plan('feasible/requiredBy-passed-renewal-later', 'feasible', (s) => { s.asOf = '2026-11-06T00:00:00.000Z'; s.forecast.entitlements[0].requiredBy = '2026-11-05T00:00:00.000Z'; });
plan('feasible/no-acceptable-choice-gate', 'feasible', (s) => { s.forecast.entitlements[0].acceptableDerivativeIds = []; s.forecast.entitlements[0].gates = ['eligibility-unconfirmed', 'eligibility-unconfirmed']; s.constraints.derivativeBounds[1].min = 1; });
plan('feasible/objective-cost-weight', 'feasible', (s) => { s.constraints.objectiveWeights.costMinor = 20; });
plan('feasible/objective-min-raises-order', 'feasible', (s) => { s.constraints.objectiveWeights.costMinor = 20; s.constraints.derivativeBounds[0].min = 1; });
plan('feasible/budget-slack-nine', 'feasible', (s) => { s.constraints.budgetMinor = 9; });
plan('feasible/no-entitlements', 'feasible', (s) => { s.forecast.entitlements = []; });
plan('feasible/no-entitlements-with-stock', 'feasible', (s) => { s.forecast.entitlements = []; s.stock = [stockRow('x', 'a')]; });
plan('feasible/entitlement-input-order', 'feasible', (s) => { s.forecast.entitlements.reverse(); s.catalog.reverse(); s.constraints.modelBounds.reverse(); s.constraints.derivativeBounds.reverse(); });
plan('feasible/unicode-and-escapes', 'feasible', (s) => { s.runId = 'run é中 "q"\\'; s.forecast.limitations = ['line\nbreak   😀']; });
plan('feasible/extra-input-fields-digest', 'feasible', (s) => { s.extra = { z: 1.5, a: [1, { '10': 1, '2': 2, b: 3 }], '3': true }; });
plan('feasible/large-numbers', 'feasible', (s) => { s.catalog[0].unitCostMinor = 4000000000000000; s.catalog[1].unitCostMinor = 1; s.constraints.budgetMinor = 9007199254740991; s.constraints.objectiveWeights.costMinor = 1; s.constraints.derivativeBounds[0].max = 2; });
plan('feasible/zero-weights-except-cost', 'feasible', (s) => { s.constraints.objectiveWeights = { coverage: 0, unallocatedStock: 0, costMinor: 1 }; });
plan('feasible/decimal-quantity-weights-as-floats', 'feasible', (s) => { s.constraints.budgetMinor = 20.0; s.catalog[0].unitCostMinor = 1e1; });

// Infeasible.
plan('infeasible/derivative-min-above-max', 'infeasible', (s) => { s.constraints.derivativeBounds[0].min = 3; s.constraints.derivativeBounds[0].max = 1; });
plan('infeasible/model-min-above-max', 'infeasible', (s) => { s.constraints.modelBounds[1].min = 3; s.constraints.modelBounds[1].max = 2; });
plan('infeasible/both-min-above-max', 'infeasible', (s) => { s.constraints.derivativeBounds.forEach((b) => { b.min = 5; b.max = 4; }); s.constraints.modelBounds[0].min = 9; s.constraints.modelBounds[0].max = 0; });
plan('infeasible/budget-below-minimum-spend', 'infeasible', (s) => { s.constraints.derivativeBounds[0].min = 2; s.constraints.budgetMinor = 9; });
plan('infeasible/budget-zero-with-minimum', 'infeasible', (s) => { s.constraints.derivativeBounds[1].min = 1; s.constraints.budgetMinor = 0; });
plan('infeasible/model-bound-conflict', 'infeasible', (s) => { s.constraints.derivativeBounds[0].min = 2; s.constraints.modelBounds[0].max = 1; });
plan('infeasible/model-min-unreachable', 'infeasible', (s) => { s.constraints.modelBounds[0].min = 3; });
plan('infeasible/lead-time-beyond-horizon', 'infeasible', (s) => { s.catalog[0].leadTimeDays = 31; s.constraints.derivativeBounds[0].min = 1; });
plan('infeasible/everything-conflicts', 'infeasible', (s) => { s.constraints.derivativeBounds.forEach((b) => { b.min = 2; }); s.constraints.budgetMinor = 1; s.constraints.modelBounds.forEach((b) => { b.max = 1; }); s.catalog[1].leadTimeDays = 40; });

// Boundary and binding constraints.
plan('boundary/spend-equals-budget', 'boundary', (s) => { s.constraints.budgetMinor = 18; });
plan('boundary/spend-one-below-budget', 'boundary', (s) => { s.constraints.budgetMinor = 19; });
plan('boundary/spend-one-above-budget', 'boundary', (s) => { s.constraints.budgetMinor = 17; });
plan('boundary/quantity-at-min-and-max', 'boundary', (s) => { s.constraints.derivativeBounds[0].min = 1; s.constraints.derivativeBounds[0].max = 1; s.constraints.derivativeBounds[1].min = 1; s.constraints.derivativeBounds[1].max = 1; });
plan('boundary/all-bounds-zero', 'boundary', (s) => { s.constraints.derivativeBounds.forEach((b) => { b.max = 0; }); s.constraints.modelBounds.forEach((b) => { b.max = 0; }); });
plan('boundary/model-bound-tighter-than-derivative', 'boundary', (s) => { s.constraints.modelBounds[0].max = 1; });
plan('boundary/horizon-zero-days', 'boundary', (s) => { s.constraints.horizonDays = 0; s.forecast.horizonEnd = s.asOf; s.forecast.entitlements.forEach((e) => { e.renewalAt = s.asOf; }); s.catalog.forEach((d) => { d.leadTimeDays = 0; }); });
plan('boundary/lead-time-zero', 'boundary', (s) => { s.catalog.forEach((d) => { d.leadTimeDays = 0; }); });
plan('boundary/asof-with-offset', 'boundary', (s) => { s.asOf = '2026-11-06T01:00:00+01:00'; });
plan('boundary/stock-available-exactly-asof', 'boundary', (s) => { s.constraints.budgetMinor = 0; s.stock = [stockRow('now', 'a', { availableAt: s.asOf })]; });

// Ties: equal objective broken by spend, quantity, then vector string.
plan('ties/equal-objective-spend-breaks', 'ties');
plan('ties/equal-spend-and-quantity-vector-breaks', 'ties', (s) => { s.catalog[1].unitCostMinor = 10; s.constraints.budgetMinor = 100; });
plan('ties/multi-digit-vector-string', 'ties', (s) => {
  s.catalog.forEach((d) => { d.unitCostMinor = 5; }); s.constraints.budgetMinor = 1000; s.constraints.objectiveWeights = { coverage: 100, unallocatedStock: 10, costMinor: 0 };
  s.constraints.derivativeBounds.forEach((b) => { b.max = 12; }); s.constraints.modelBounds.forEach((b) => { b.max = 12; });
  s.forecast.entitlements = Array.from({ length: 12 }, (_, i) => ({ entitlementId: `e${i}`, employeeId: `emp${i}`, renewalId: `r${i}`, entitlementSlotId: `s${i}`,
    renewalAt: '2026-11-26T00:00:00.000Z', acceptableDerivativeIds: ['a', 'b'], gates: [] }));
});
plan('ties/zero-weights-all-equal', 'ties', (s) => { s.constraints.objectiveWeights = { coverage: 0, unallocatedStock: 0, costMinor: 1 }; s.constraints.derivativeBounds.forEach((b) => { b.min = 0; }); });
plan('ties/identical-plans-differ-in-allocation', 'ties', (s) => { s.catalog[1].unitCostMinor = 10; s.constraints.derivativeBounds.forEach((b) => { b.max = 1; }); s.constraints.budgetMinor = 100; });

// Changed constraints: the same demand with each Greg-editable key changed.
plan('changed/budget-raised', 'changed', (s) => { s.constraints.budgetMinor = 1000; });
plan('changed/budget-lowered', 'changed', (s) => { s.constraints.budgetMinor = 10; });
plan('changed/budget-zero', 'changed', (s) => { s.constraints.budgetMinor = 0; });
plan('changed/modelBounds-narrowed', 'changed', (s) => { s.constraints.modelBounds[0].max = 0; });
plan('changed/modelBounds-min-raised', 'changed', (s) => { s.constraints.modelBounds[1].min = 1; });
plan('changed/derivativeBounds-max-raised', 'changed', (s) => { s.constraints.derivativeBounds.forEach((b) => { b.max = 4; }); s.constraints.modelBounds.forEach((b) => { b.max = 4; }); s.constraints.budgetMinor = 100; });
plan('changed/derivativeBounds-min-raised', 'changed', (s) => { s.constraints.derivativeBounds[0].min = 1; });
plan('changed/weights-coverage-only', 'changed', (s) => { s.constraints.objectiveWeights = { coverage: 1, unallocatedStock: 0, costMinor: 0 }; });
plan('changed/weights-unallocated-heavy', 'changed', (s) => { s.constraints.objectiveWeights = { coverage: 1, unallocatedStock: 100, costMinor: 0 }; s.stock = [stockRow('s1', 'a'), stockRow('s2', 'b'), stockRow('s3', 'b')]; });
plan('changed/same-demand-new-version-pin', 'changed', (s) => { s.versions.forecast = 'other'; });

// Current draft.
plan('draft/valid-feasible', 'draft', (s) => { s.currentDraft = { quantities: [{ derivativeId: 'b', quantity: 1 }] }; s.constraints.derivativeBounds[1].min = 1; });
plan('draft/valid-matches-best', 'draft', (s) => { s.currentDraft = { quantities: [{ derivativeId: 'a', quantity: 1 }, { derivativeId: 'b', quantity: 1 }] }; });
plan('draft/over-bounds-infeasible', 'draft', (s) => { s.currentDraft = { quantities: [{ derivativeId: 'a', quantity: 9 }] }; });
plan('draft/over-budget-infeasible', 'draft', (s) => { s.currentDraft = { quantities: [{ derivativeId: 'a', quantity: 2 }, { derivativeId: 'b', quantity: 2 }] }; });
plan('draft/empty-quantities', 'draft', (s) => { s.currentDraft = { quantities: [] }; });
plan('draft/better-than-recommendation-none', 'draft', (s) => { s.currentDraft = { quantities: [{ derivativeId: 'a', quantity: 0 }] }; });
plan('draft/unknown-derivative', 'draft', (s) => { s.currentDraft = { quantities: [{ derivativeId: 'unknown', quantity: 1 }] }; });
plan('draft/duplicate-derivative', 'draft', (s) => { s.currentDraft = { quantities: [{ derivativeId: 'a', quantity: 1 }, { derivativeId: 'a', quantity: 1 }] }; });
plan('draft/negative-quantity', 'draft', (s) => { s.currentDraft = { quantities: [{ derivativeId: 'a', quantity: -1 }] }; });
plan('draft/fractional-quantity', 'draft', (s) => { s.currentDraft = { quantities: [{ derivativeId: 'a', quantity: 0.5 }] }; });
plan('draft/quantities-not-array', 'draft', (s) => { s.currentDraft = { quantities: 'x' }; });
plan('draft/null-draft', 'draft', (s) => { s.currentDraft = null; });
plan('draft/null-row', 'draft', (s) => { s.currentDraft = { quantities: [null] }; });
plan('draft/with-stock-and-unmet', 'draft', (s) => { s.stock = [stockRow('s', 'a')]; s.forecast.entitlements[0].requiredBy = '2026-11-12T00:00:00.000Z'; s.currentDraft = { quantities: [{ derivativeId: 'b', quantity: 2 }] }; });

// Invalid inputs.
const bad = {
  'not-object': () => 'x', 'array-input': () => [], 'null-input': () => null,
  'no-runId': (s) => { delete s.runId; }, 'empty-runId': (s) => { s.runId = ''; }, 'long-runId': (s) => { s.runId = 'x'.repeat(513); },
  'bad-asOf': (s) => { s.asOf = '2026-11-31T00:00:00Z'; }, 'asOf-no-zone': (s) => { s.asOf = '2026-11-06T00:00:00'; }, 'asOf-25h': (s) => { s.asOf = '2026-11-06T25:00:00Z'; },
  'versions-missing': (s) => { delete s.versions.catalog; }, 'versions-not-object': (s) => { s.versions = []; },
  'forecast-no-basis': (s) => { delete s.forecast.basis; }, 'forecast-bad-horizon': (s) => { s.forecast.horizonEnd = 'tomorrow'; },
  'limitations-not-text': (s) => { s.forecast.limitations = [1]; }, 'entitlements-banded': (s) => { s.forecast.entitlements = { count: { kind: 'band', fewerThan: 5 } }; },
  'catalog-empty': (s) => { s.catalog = []; }, 'catalog-duplicate': (s) => { s.catalog[1].derivativeId = 'a'; }, 'catalog-fractional-cost': (s) => { s.catalog[0].unitCostMinor = 1.5; },
  'catalog-negative-lead': (s) => { s.catalog[0].leadTimeDays = -1; }, 'lead-time-overflow': (s) => { s.catalog[0].leadTimeDays = Number.MAX_SAFE_INTEGER; },
  'cost-overflow': (s) => { s.catalog[0].unitCostMinor = Number.MAX_SAFE_INTEGER; },
  'weights-all-zero': (s) => { s.constraints.objectiveWeights = { coverage: 0, unallocatedStock: 0, costMinor: 0 }; },
  'weights-missing': (s) => { delete s.constraints.objectiveWeights.costMinor; }, 'currency-lowercase': (s) => { s.constraints.currency = 'gbp'; }, 'currency-number': (s) => { s.constraints.currency = 123; },
  'budget-negative': (s) => { s.constraints.budgetMinor = -1; }, 'horizon-mismatch': (s) => { s.forecast.horizonEnd = '2026-12-07T00:00:00.000Z'; },
  'derivative-bound-missing': (s) => { s.constraints.derivativeBounds.pop(); }, 'model-bound-unknown': (s) => { s.constraints.modelBounds[0].modelId = 'nope'; },
  'bound-duplicate': (s) => { s.constraints.derivativeBounds[1].derivativeId = 'a'; }, 'bound-fractional': (s) => { s.constraints.derivativeBounds[0].max = 1.5; },
  'duplicate-employee': (s) => { s.forecast.entitlements[1].employeeId = s.forecast.entitlements[0].employeeId; },
  'duplicate-slot': (s) => { s.forecast.entitlements[1].entitlementSlotId = s.forecast.entitlements[0].entitlementSlotId; },
  'duplicate-entitlement': (s) => { s.forecast.entitlements[1].entitlementId = 'flexible'; },
  'renewal-invalid-date': (s) => { s.forecast.entitlements[1].renewalAt = '2026-11-31T00:00:00Z'; }, 'renewal-after-horizon': (s) => { s.forecast.entitlements[1].renewalAt = '2026-12-06T00:00:00.001Z'; },
  'requiredBy-after-renewal': (s) => { s.forecast.entitlements[0].requiredBy = '2026-11-27T00:00:00.000Z'; }, 'requiredBy-invalid': (s) => { s.forecast.entitlements[0].requiredBy = 'x'; },
  'acceptable-unknown': (s) => { s.forecast.entitlements[0].acceptableDerivativeIds = ['zzz']; }, 'acceptable-duplicate': (s) => { s.forecast.entitlements[0].acceptableDerivativeIds = ['a', 'a']; },
  'gates-not-text': (s) => { s.forecast.entitlements[0].gates = [3]; }, 'excluded-not-array': (s) => { s.forecast.entitlements[0].excludedStockIds = 'x'; },
  'excluded-duplicate': (s) => { s.forecast.entitlements[0].excludedStockIds = ['x', 'x']; },
  'stock-future': (s) => { s.stock = [stockRow('future', 'a', { availableAt: '2026-11-07T00:00:00Z' })]; }, 'stock-duplicate': (s) => { s.stock = [stockRow('x', 'a'), stockRow('x', 'b')]; },
  'stock-unknown-derivative': (s) => { s.stock = [stockRow('x', 'q')]; }, 'stock-held-missing': (s) => { s.stock = [{ stockId: 'x', derivativeId: 'a', availableAt: s.asOf }]; },
  'stock-permitted-duplicate': (s) => { s.stock = [stockRow('x', 'a', { permittedEntitlementIds: ['f', 'f'] })]; }, 'stock-not-array': (s) => { s.stock = {}; },
  'inbound-requested': (s) => { s.inbound = [{ supplyId: 'request', derivativeId: 'a', state: 'requested', quantity: 1, releasedQuantity: 0, expectedAt: s.asOf }]; },
  'inbound-zero-quantity': (s) => { s.inbound = [inboundRow({ quantity: 0 })]; }, 'inbound-released-too-many': (s) => { s.inbound = [inboundRow({ releasedQuantity: 2 })]; },
  'inbound-bad-date': (s) => { s.inbound = [inboundRow({ expectedAt: 'soon' })]; }, 'inbound-missing': (s) => { delete s.inbound; },
  'unsafe-integer-bound': (s) => { s.constraints.derivativeBounds[0].max = 9007199254740993; },
  'arithmetic-overflow-weights': (s) => { s.constraints.objectiveWeights.costMinor = Number.MAX_SAFE_INTEGER; s.catalog[0].unitCostMinor = 1000; },
  'proto-key': (s) => { s.__proto__x = 1; s.versions.constructor = 'x'; },
};
for (const [name, change] of Object.entries(bad)) plan(`invalid/${name}`, 'invalid', (s) => change(s));

// Unsupported.
plan('unsupported/derivatives-13', 'unsupported', (s) => {
  s.catalog = Array.from({ length: 13 }, (_, i) => ({ derivativeId: `d${String(i).padStart(2, '0')}`, modelId: 'model-a', unitCostMinor: 1, leadTimeDays: 5 }));
  s.constraints.derivativeBounds = s.catalog.map((d) => ({ derivativeId: d.derivativeId, min: 0, max: 1 }));
  s.constraints.modelBounds = [{ modelId: 'model-a', min: 0, max: 13 }]; s.forecast.entitlements.forEach((e) => { e.acceptableDerivativeIds = ['d00']; });
});
plan('unsupported/candidate-plans', 'unsupported', (s) => { s.constraints.derivativeBounds.forEach((b) => { b.max = 1000; }); });
plan('unsupported/candidate-plans-exact-limit-plus-one', 'unsupported', (s) => { s.constraints.derivativeBounds[0].max = 49999; s.constraints.derivativeBounds[1].max = 1; s.constraints.derivativeBounds[1].min = 0; s.constraints.derivativeBounds[0].min = 0; s.constraints.modelBounds.forEach((b) => { b.max = 99999; }); s.constraints.derivativeBounds[1].max = 1; s.constraints.derivativeBounds[0].max = 25000; });
plan('unsupported/entitlements-129', 'unsupported', (s) => {
  s.forecast.entitlements = Array.from({ length: 129 }, (_, i) => ({ ...s.forecast.entitlements[0], entitlementId: `e${i}`, employeeId: `m${i}`, renewalId: `r${i}`, entitlementSlotId: `s${i}` }));
  s.constraints.derivativeBounds.forEach((b) => { b.max = 0; });
});
plan('unsupported/supply-lots-257', 'unsupported', (s) => { s.forecast.entitlements.length = 1; s.stock = Array.from({ length: 255 }, (_, i) => stockRow(`s${String(i).padStart(3, '0')}`, 'a')); });
plan('unsupported/matching-effort', 'unsupported', (s) => {
  s.constraints.budgetMinor = 100000; s.constraints.derivativeBounds.forEach((b) => { b.max = 100; }); s.constraints.modelBounds.forEach((b) => { b.max = 100; });
  s.forecast.entitlements = Array.from({ length: 128 }, (_, i) => ({ entitlementId: `e${i}`, employeeId: `m${i}`, renewalId: `r${i}`, entitlementSlotId: `s${i}`,
    renewalAt: s.forecast.entitlements[0].renewalAt, acceptableDerivativeIds: ['a', 'b'], gates: [] }));
});

// Seed-scale: the retained seed's planning policy and catalogue, with a synthetic cohort.
const scratch = await mkdtemp(join(tmpdir(), 'gcsp-order-plan-parity-'));
let counter = 0;
async function policyService(ops = []) {
  const value = clone(seed);
  for (const op of ops) {
    if (op.op === 'remove') value.assumptions = value.assumptions.filter((a) => !a.key.startsWith(op.prefix));
    else if (op.op === 'set') value.assumptions.find((a) => a.key === op.key).value = op.value;
    else if (op.op === 'patch') { let t = value.assumptions.find((a) => a.key === op.key).value; for (const p of op.path.slice(0, -1)) t = t[p]; t[op.path.at(-1)] = op.value; }
  }
  const path = join(scratch, `seed-${counter++}.json`);
  await writeFile(path, JSON.stringify(value));
  return createPolicyService({ filePath: path, retainedFilePaths: [] });
}
const READ = { runId: 'order-plan-parity-run', asOf: ASOF, policyVersion: seed.policyVersion };
const rules = await readPlanningPolicy(await policyService(), READ);
const catalogRead = await createPolicyOrderPlanCatalog({ policy: await policyService() }).readCatalog({ runId: READ.runId }, READ);
if (rules.status !== 'ok' || catalogRead.status !== 'ok') throw new Error('retained seed must supply the planning policy');

function rng(seedValue) {
  let a = seedValue;
  return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
// Same shape as the service builds from policy: constraints from rules, catalogue with the policy lead time.
function seedScale(entitlementCount, { edited = false, seedValue = 7, flex = 0.5 } = {}) {
  const random = rng(seedValue);
  const { leadTimeDays, provenance, ...constraints } = clone(rules.value);
  const derivatives = catalogRead.value.derivatives;
  if (edited) {
    constraints.budgetMinor = 12000000;
    constraints.derivativeBounds.find((b) => b.derivativeId === 'g20-saloon-320i').max = 1;
    constraints.derivativeBounds.find((b) => b.derivativeId === 'g61-i5-40').min = 1;
    constraints.modelBounds.find((b) => b.modelId === 'g20-saloon').max = 3;
  }
  const horizonMs = Date.parse(ASOF) + constraints.horizonDays * day;
  const ids = derivatives.map((d) => d.derivativeId);
  const entitlements = Array.from({ length: entitlementCount }, (_, i) => {
    const renewalMs = Date.parse(ASOF) + Math.floor(5 + random() * 114) * day;
    const acceptable = ids.filter(() => random() < flex); if (random() < 0.9 && !acceptable.length) acceptable.push(ids[Math.floor(random() * ids.length)]);
    const e = { entitlementId: `ent-${String(i).padStart(3, '0')}`, employeeId: `emp-${i}`, renewalId: `ren-${i}`, entitlementSlotId: `slot-${i}`,
      renewalAt: iso(renewalMs), acceptableDerivativeIds: acceptable, gates: random() < 0.1 ? ['eligibility-unconfirmed'] : [] };
    if (random() < 0.15) e.requiredBy = iso(renewalMs - Math.floor(random() * 20) * day);
    return e;
  });
  const stock = Array.from({ length: 30 }, (_, i) => {
    const row = { stockId: `veh-${String(i).padStart(2, '0')}`, derivativeId: ids[Math.floor(random() * ids.length)], availableAt: iso(Date.parse(ASOF) - Math.floor(random() * 30) * day),
      heldForEntitlementId: random() < 0.15 ? entitlements[Math.floor(random() * entitlementCount)].entitlementId : null };
    if (random() < 0.3) row.permittedEntitlementIds = entitlements.filter(() => random() < 0.6).map((e) => e.entitlementId);
    return row;
  });
  for (const e of entitlements) if (random() < 0.1) e.excludedStockIds = stock.filter(() => random() < 0.3).map((s) => s.stockId);
  const inbound = [{ supplyId: 'ack-a', derivativeId: ids[0], quantity: 2, releasedQuantity: 1, state: 'confirmed', expectedAt: iso(Date.parse(ASOF) + 40 * day), provenance: { sourceVersion: 'production-v1' } },
    { supplyId: 'ack-b', derivativeId: ids[2], quantity: 1, releasedQuantity: 0, state: 'confirmed', expectedAt: iso(Date.parse(ASOF) + 90 * day), provenance: { sourceVersion: 'production-v1' } }];
  return { runId: READ.runId, asOf: ASOF,
    versions: { forecast: 'seed-scale-forecast-v1', policy: rules.policyVersion, stock: 'stock-v1', supply: 'supply-v1', cohort: 'cohort-v1', clock: 'clock-v1', catalog: catalogRead.value.version },
    forecast: { basis: 'synthetic-seed-scale', horizonEnd: iso(horizonMs), limitations: ['Synthetic cohort for parity.'], entitlements },
    catalog: derivatives.map((d) => ({ derivativeId: d.derivativeId, modelId: d.modelId, unitCostMinor: d.unitCostMinor, leadTimeDays })),
    constraints, stock, inbound };
}
plan('seed-scale/128-entitlements', 'seed-scale', () => {}, seedScale(128));
plan('seed-scale/128-entitlements-greg-edits', 'seed-scale', () => {}, seedScale(128, { edited: true }));
plan('seed-scale/128-entitlements-narrow-choices', 'seed-scale', () => {}, seedScale(128, { flex: 0.25, seedValue: 5 }));
plan('seed-scale/24-entitlements-draft', 'seed-scale', (s) => { s.currentDraft = { quantities: [{ derivativeId: 'g20-saloon-330e', quantity: 2 }, { derivativeId: 'f70-hatch-120', quantity: 1 }] }; }, seedScale(24, { seedValue: 11 }));
plan('seed-scale/12-entitlements-greg-edits', 'seed-scale', () => {}, seedScale(12, { edited: true, seedValue: 23 }));

// Policy and catalogue outcomes for the retained seed and its failures.
const policyCases = [
  { id: 'policy/seed', ops: [], read: READ },
  { id: 'policy/seed-unpinned-version-only', ops: [], read: { ...READ, policyVersion: 'wrong-version' } },
  { id: 'policy/no-policy-version', ops: [], read: { runId: READ.runId, asOf: ASOF } },
  { id: 'policy/incomplete-orderPlan-removed', ops: [{ op: 'remove', prefix: 'orderPlan.' }], read: READ },
  { id: 'policy/incomplete-budget-removed', ops: [{ op: 'remove', prefix: 'orderPlan.budgetMinor' }], read: READ },
  { id: 'policy/lead-time-invalid', ops: [{ op: 'set', key: 'supply.leadTimeDays', value: 'eight weeks' }], read: READ },
  { id: 'policy/lead-time-fractional', ops: [{ op: 'set', key: 'supply.leadTimeDays', value: 1.5 }], read: READ },
  { id: 'policy/lead-time-changed', ops: [{ op: 'set', key: 'supply.leadTimeDays', value: 10 }], read: READ },
  { id: 'policy/budget-edited', ops: [{ op: 'set', key: 'orderPlan.budgetMinor', value: 0 }], read: READ },
  { id: 'policy/catalog-removed', ops: [{ op: 'remove', prefix: 'orderPlan.catalog.v1' }], read: READ },
  { id: 'policy/catalog-negative-cost', ops: [{ op: 'patch', key: 'orderPlan.catalog.v1', path: ['derivatives', 0, 'unitCostMinor'], value: -1 }], read: READ },
  { id: 'policy/catalog-bad-currency', ops: [{ op: 'patch', key: 'orderPlan.catalog.v1', path: ['currency'], value: 'pounds' }], read: READ },
  { id: 'policy/catalog-unknown-configuration', ops: [{ op: 'patch', key: 'orderPlan.catalog.v1', path: ['derivatives', 1, 'configurationIds'], value: ['nope'] }], read: READ },
  { id: 'policy/catalog-fact-number-without-unit', ops: [{ op: 'patch', key: 'orderPlan.catalog.v1', path: ['configurations', 0, 'facts', 'seats', 'unit'], value: null }], read: READ },
  { id: 'policy/catalog-unknown-fact', ops: [{ op: 'patch', key: 'orderPlan.catalog.v1', path: ['configurations', 0, 'facts', 'seats', 'value'], value: null }], read: READ },
  { id: 'policy/catalog-future-effective', ops: [], read: { ...READ, asOf: '2026-11-04T00:00:00.000Z' }, catalogRunMismatch: false },
  { id: 'policy/catalog-run-mismatch', ops: [], read: READ, contextRunId: 'another-run' },
];
const FULL_CATALOG = new Set(['policy/seed']);
for (const c of policyCases) {
  const policy = await policyService(c.ops);
  const rulesOut = await readPlanningPolicy(policy, c.read);
  const catalogOut = await createPolicyOrderPlanCatalog({ policy }).readCatalog({ runId: c.contextRunId ?? c.read.runId }, c.read);
  const editable = await policy.getAssumption('orderPlan.gregEditableKeys', c.read);
  // Ok catalogues are bulky: keep them whole for two cases, otherwise a SHA-256 of their sorted-key JSON.
  const sorted = (v) => Array.isArray(v) ? v.map(sorted) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sorted(v[k])])) : v;
  const catalogExpected = catalogOut.status === 'ok' && !FULL_CATALOG.has(c.id)
    ? { status: 'ok', digest: createHash('sha256').update(JSON.stringify(sorted(catalogOut))).digest('hex') } : clone(catalogOut);
  cases.push({ id: c.id, category: 'policy', kind: 'policy', ops: c.ops, read: c.read, contextRunId: c.contextRunId ?? c.read.runId,
    expected: { rules: clone(rulesOut), catalog: catalogExpected, editable: editable.status === 'ok' ? clone(editable.value.value) : null } });
}
await rm(scratch, { recursive: true, force: true });

const text = `${JSON.stringify(cases)}\n`;
await writeFile(outPath, gzipSync(text, { level: 9, mtime: 0 }));
const count = {}; for (const c of cases) count[c.category] = (count[c.category] ?? 0) + 1;
console.log(`${cases.length} cases, ${text.length} bytes of JSON`, JSON.stringify(count));
const statuses = {}; for (const c of cases.filter((x) => x.kind === 'plan')) statuses[c.expected.status] = (statuses[c.expected.status] ?? 0) + 1;
console.log('plan statuses', JSON.stringify(statuses));
const slow = timings.filter(([id]) => id.startsWith('seed-scale') || id.startsWith('unsupported') || id.startsWith('ties/multi')).map(([id, ms]) => `${id}=${ms.toFixed(0)}ms`);
console.log(`Node wall time: total ${timings.reduce((n, [, ms]) => n + ms, 0).toFixed(0)}ms; ${slow.join(' ')}`);
