import { describe, expect, it } from 'vitest';
import { projectPlan, projectProduction } from './planning.projection';

const pins = { policy: 'p1', forecast: 'f1', stock: 's1', supply: 'i1', cohort: 'c1', catalog: 'v1' };
function plan() { return { planId: 'order-plan-1', runId: 'run-1', asOf: '2026-11-16T12:00:00Z', versions: pins, status: 'feasible',
  quantities: [{ derivativeId: 'd1', modelId: 'm1', quantity: 2 }], modelQuantities: [{ modelId: 'm1', quantity: 2 }],
  orderQuantity: 2, spendMinor: 8345678, currency: 'GBP', expectedAcceptableCoverage: { covered: 1, total: 3 },
  unallocatedStockRisk: { quantity: 1, totalSupply: 2, bySource: [{ sourceId: 'order:d1', quantity: 1 }] },
  alternatives: [], bindingConstraints: [{ id: 'budget', detail: 'Not enough budget for another vehicle.' }],
  policyProvenance: [{ key: 'orderPlan.budgetMinor', value: 9000000 }, { key: 'orderPlan.modelBounds', value: [{ modelId: 'm1', min: 0, max: 4 }] }],
  limitations: ['Deterministic feasibility, not employee selection.'], unmetNeeds: [{ renewalAt: '2026-12-01', gates: ['acceptable-supply-scarcity'], constraintIds: ['budget'] }] }; }
function value() { return { mode: 'current', preview: false, plan: plan(), presentation: { forecastBasis: 'expressed-saved-demand', editableKeys: ['orderPlan.budgetMinor', 'orderPlan.modelBounds'], models: [{ modelId: 'm1', model: '3 Series' }], derivatives: [{ derivativeId: 'd1', modelId: 'm1', model: '3 Series', derivative: '320i' }] },
  learned: { status: 'unavailable', limitation: 'The learned forecast is unavailable right now, so only the baseline plan is shown.' }, replan: { status: 'no-submission' } }; }
const ok = (value: unknown) => ({ status: 'ok', value });
function request() { return { requestId: 'request-1', model: '3 Series', derivative: '320i', quantity: 8, state: 'partly-confirmed', stage: 'partly-released',
  confirmedQuantity: 5, queuedQuantity: 4, releasedQuantity: 2, outstandingQuantity: 3,
  message: '5 of 8 confirmed. 2 released to stock.', reason: null, history: [{ seq: 1, state: 'partly-confirmed', at: '2026-11-16T12:00:00Z', details: { confirmedQuantity: 5 } }], supplies: [] }; }
function production(requests: unknown[] = [request()]) { return { asOf: '2026-11-16T12:00:00Z', provider: { mode: 'remote', status: 'available' }, submissions: [], requests }; }

describe('planning display projection', () => {
  it('preserves exact server figures and pins without recomputing totals or probabilities', () => {
    const result = projectPlan(ok(value())); expect(result.status).toBe('ok'); if (result.status !== 'ok') return;
    expect(result.value.metrics.map(f => f.value)).toEqual(['1 of 3', '1 of 2', 8345678, 2]);
    expect(result.value.versions).toEqual(pins); expect(result.value.lines[0]).toEqual({ id: 'd1', model: '3 Series', derivative: '3 Series 320i', quantity: 2 });
    expect(result.value.forecastNote).toContain('not a prediction'); expect(result.value.canSubmit).toBe(true);
  });
  it('uses only actual editable keys and unconverted minor units', () => {
    const v = value(); v.presentation.editableKeys.push('orderPlan.horizonDays');
    const result = projectPlan(ok(v)); if (result.status !== 'ok') throw new Error('unreadable fixture');
    expect(result.value.editors[0].value).toBe(9000000); expect(result.value.editors[1].rows[0].max).toBe(4);
    expect(result.value.unsupportedEditors).toEqual(['orderPlan.horizonDays']);
  });
  it('returns incomplete or malformed values as unavailable rather than zero recommendations', () => {
    for (const source of [null, {}, { ...plan(), spendMinor: undefined }, { ...plan(), quantities: [{ derivativeId: 'd1', modelId: 'm1', quantity: -1 }] }, { ...plan(), versions: { policy: 'p1' } }]) {
      expect(projectPlan(ok({ ...value(), plan: source })).status).toBe('unavailable');
    }
  });
  it('preserves unavailable default-adapter reasons and HTTP evidence', () => {
    const result = { status: 'unavailable', code: 'planning-forecast-not-configured', reason: 'Forecast unavailable.', httpStatus: 503, retryable: true };
    expect(projectPlan(result)).toEqual(result);
  });
  it('shows infeasibility and conflicting limits without recommended order quantities', () => {
    const result = projectPlan(ok({ ...value(), plan: { ...plan(), status: 'infeasible', quantities: [], conflicts: [{ id: 'budget', detail: 'Minimum exceeds budget.' }] } }));
    if (result.status !== 'ok') throw new Error('unreadable fixture');
    expect(result.value.state).toBe('infeasible'); expect(result.value.lines).toEqual([]); expect(result.value.metrics).toEqual([]);
    expect(result.value.conflicts).toEqual(['budget: Minimum exceeds budget.']); expect(result.value.canSubmit).toBe(false);
  });
  it('renders feasible and infeasible alternatives and rejects malformed alternative metrics', () => {
    const alternative = { ...plan(), kind: 'zero-new-orders-baseline', identicalToRecommendation: true };
    const v = { ...value(), plan: { ...plan(), alternatives: [alternative, { kind: 'next-best-distinct-feasible', status: 'infeasible', conflicts: [{ id: 'model:m1:min', detail: 'Limit conflicts.' }] }] } };
    const result = projectPlan(ok(v)); if (result.status !== 'ok') throw new Error('unreadable fixture');
    expect(result.value.alternatives.map(a => [a.label, a.status])).toEqual([['No new orders', 'feasible'], ['Next best plan', 'infeasible']]);
    expect(result.value.alternatives[0].facts[0].value).toBe('1 of 3');
    expect(projectPlan(ok({ ...value(), plan: { ...plan(), alternatives: [{ ...alternative, expectedAcceptableCoverage: {} }] } })).status).toBe('unavailable');
  });
  it('keeps preview comparison values server-supplied and never makes an edited preview submittable', () => {
    const result = projectPlan(ok({ ...value(), mode: 'preview', preview: true, activePlan: plan(), plan: { ...plan(), orderQuantity: 1, spendMinor: 4000001 } }));
    if (result.status !== 'ok') throw new Error('unreadable fixture');
    expect(result.value.comparison[1]).toEqual({ label: 'Spend (minor units)', current: 8345678, preview: 4000001 });
    expect(result.value.preview).toBe(true); expect(result.value.canSubmit).toBe(false);
  });
  it('retains current-only and preview-only derivatives without inventing an absent-side zero', () => {
    const activePlan = { ...plan(), quantities: [...plan().quantities, { derivativeId: 'current-only', modelId: 'm1', quantity: 4 }] };
    const previewPlan = { ...plan(), quantities: [...plan().quantities, { derivativeId: 'preview-only', modelId: 'm1', quantity: 3 }], unallocatedStockRisk: { quantity: 0, totalSupply: 3 } };
    const result = projectPlan(ok({ ...value(), mode: 'preview', preview: true, activePlan, plan: previewPlan }));
    if (result.status !== 'ok') throw new Error('unreadable fixture');
    expect(result.value.comparison[3]).toEqual({ label: 'Unallocated-stock risk', current: '1 of 2', preview: '0 of 3' });
    expect(result.value.comparison.slice(4)).toEqual([
      { label: '3 Series 320i', current: 2, preview: 2 },
      { label: 'current-only', current: 4, preview: null },
      { label: 'preview-only', current: null, preview: 3 },
    ]);
  });
  it('distinguishes no saved demand from a failed source and keeps learned unavailability visible', () => {
    const result = projectPlan(ok({ ...value(), plan: { ...plan(), orderQuantity: 0, expectedAcceptableCoverage: { covered: 0, total: 0 } } }));
    if (result.status !== 'ok') throw new Error('unreadable fixture');
    expect(result.value.state).toBe('empty'); expect(result.value.learned).toContain('unavailable'); expect(result.value.canSubmit).toBe(false);
  });
  describe('learned model answer', () => {
    const metric = (logLoss: number, brier: number) => ({ logLoss, brier });
    const available = () => ({ status: 'available', label: 'Learned model', recommended: false, submittable: false,
      plan: { ...plan(), orderQuantity: 3 },
      forecast: { version: 'forecast-9', model: { artifactId: 'sha256:2ce1109d', featureVersion: 'features-2', modelVersion: 'model-4', activationPolicyVersion: 'gcsp-policy-v1+learned-model-v1' },
        data: { dataHash: 'abc', datasetKind: 'synthetic', generatorVersion: 'g1', trainingPolicyVersion: 't1' }, settings: {},
        aggregate: [{ vehicleClass: 'saloon', period: '2026-12', employees: 2, expected: 0.81, low: 0.1, high: 1.6 },
          { vehicleClass: 'estate', period: '2026-12', employees: 1, expected: 1, low: 1, high: 1 }],
        evaluation: { label: 'Held-out check', partitionCounts: {}, overall: { learned: metric(0.52, 0.18), expressedDemand: metric(0.61, 0.22), deterministicFit: metric(0.58, 0.2) },
          thin: { cohorts: [], vehicleClasses: ['estate'] } },
        modelExpectsWait: 1, limitations: ['Synthetic-trained; not validated on BMW employee choices.'] },
      differences: { comparable: true, coverage: { baseline: 1, learned: 2, delta: 1 }, orderQuantity: { baseline: 2, learned: 3, delta: 1 },
        spendMinor: { baseline: 8345678, learned: 9000000, delta: 654322 }, unmetNeeds: { baseline: 1, learned: 0, delta: -1 },
        derivatives: [{ derivativeId: 'd1', baseline: 2, learned: 3, delta: 1, changed: true }, { derivativeId: 'd2', baseline: 0, learned: 0, delta: 0, changed: false }] } });
    const project = (learned: unknown) => { const r = projectPlan(ok({ ...value(), learned })); if (r.status !== 'ok') throw new Error('unreadable fixture'); return r.value; };
    it('projects an available answer into model facts, class rows, evaluation, limitations and differences', () => {
      const v = project(available()); const m = v.learnedModel!;
      expect(v.learned).toBeNull(); expect(m).not.toBeNull();
      expect(m.modelFacts[0]).toEqual({ label: 'Model reference', value: 'sha256:2ce1109d' });
      expect(m.modelFacts.map(f => f.label)).toEqual(['Model reference', 'Model version', 'Feature version', 'Activated under policy version', 'Training data', 'Forecast version']);
      expect(m.classes).toEqual([{ label: 'Saloon, 2026-12', expected: '0.8', low: '0.1', high: '1.6' }, { label: 'Estate, 2026-12', expected: '1.0', low: '1.0', high: '1.0' }]);
      expect(m.evaluation.map(f => f.label)).toContain('Held-out check'); expect(m.evaluation.some(f => String(f.value).includes('0.52'))).toBe(true);
      expect(m.evaluation.some(f => String(f.value).includes('Estate'))).toBe(true);
      expect(m.limitations).toEqual(['Synthetic-trained; not validated on BMW employee choices.']);
      expect(m.differences.comparable).toBe(true);
      expect(m.differences.rows.map(r => r.label)).toEqual(['Acceptable coverage', 'Vehicles ordered', 'Spend', 'Unmet needs', '3 Series 320i']);
      expect(m.differences.rows[2]).toEqual({ label: 'Spend', baseline: '£83,457', learned: '£90,000', difference: '+£6,543' });
      expect(m.differences.rows[4]).toEqual({ label: '3 Series 320i', baseline: '2', learned: '3', difference: '+1' });
      expect(v.planId).toBe('order-plan-1'); expect(v.canSubmit).toBe(true);
    });
    it('says the plans cannot be compared and lists no rows when not comparable', () => {
      const a = available(); a.differences = { comparable: false } as never;
      const m = project(a).learnedModel!; expect(m.differences.comparable).toBe(false); expect(m.differences.rows).toEqual([]); expect(m.differences.note).toContain('cannot be compared');
    });
    it('keeps the fallback line unchanged for fallback answers', () => {
      const v = project({ status: 'fallback', label: 'Learned model', reason: 'no-active-model', limitation: 'No learned model is active.' });
      expect(v.learned).toBe('No learned model is active.'); expect(v.learnedModel).toBeNull();
      expect(project({ status: 'fallback', reason: 'no-active-model' }).learned).toBe('no-active-model');
    });
    it('gives one honest note, never figures, when an available answer is incomplete', () => {
      const noModel = available(); delete (noModel.forecast.model as Record<string, unknown>)['artifactId'];
      const badRow = available(); badRow.forecast.aggregate[0] = { ...badRow.forecast.aggregate[0], low: 2 };
      const nan = available(); nan.forecast.aggregate[1] = { ...nan.forecast.aggregate[1], expected: null as never };
      for (const a of [noModel, badRow, nan, { status: 'available' }]) {
        const v = project(a); expect(v.learnedModel).toBeNull(); expect(v.learned).toBe("The learned model's answer was incomplete, so only the baseline plan is shown.");
      }
    });
  });
  it('keeps requested, confirmed, queued, released and outstanding separate', () => {
    const result = projectProduction(ok(production())); if (result.status !== 'ok') throw new Error('unreadable fixture');
    expect(result.value.requests[0].facts.slice(0, 5).map(f => f.value)).toEqual([8, 5, 4, 2, 3]);
    expect(result.value.requests[0].history[0].details).toEqual([{ label: 'Confirmed', value: 5 }]);
    expect(result.value.requests[0].stage).toBe('Partly released');
  });
  it('does not infer missing quantities, and preserves actual refusal and pending state', () => {
    expect(projectProduction(ok(production([{ ...request(), confirmedQuantity: undefined }]))).status).toBe('unavailable');
    const result = projectProduction(ok(production([{ ...request(), state: 'refused', stage: 'refused', reason: 'Capacity unavailable.' }])));
    if (result.status !== 'ok') throw new Error('unreadable fixture');
    expect(result.value.requests[0].reason).toBe('Capacity unavailable.'); expect(result.value.requests[0].state).toBe('Refused');
    expect(projectProduction({ status: 'pending', httpStatus: 202, operationId: 'operation-1' }).status).toBe('pending');
  });
  it('ignores read observation time for replan invalidation but includes real response history', () => {
    const a = projectProduction(ok(production())); const b = projectProduction(ok({ ...production(), asOf: '2026-11-17T12:00:00Z' }));
    if (a.status !== 'ok' || b.status !== 'ok') throw new Error('unreadable fixture');
    expect(a.value.fingerprint).toBe(b.value.fingerprint);
    const c = projectProduction(ok(production([{ ...request(), state: 'delayed', reason: 'Transport delayed.' }])));
    if (c.status !== 'ok') throw new Error('unreadable fixture'); expect(c.value.fingerprint).not.toBe(a.value.fingerprint);
  });
});
