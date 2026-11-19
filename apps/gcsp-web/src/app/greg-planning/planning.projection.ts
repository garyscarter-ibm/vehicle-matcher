import { ConstraintEditor, LearnedModelView, PlanAlternative, PlanDto, PlanningFact, PlanningLine, PlanningRecord, PlanningResult,
  PlanValueDto, PlanView, ProductionRequestView, ProductionSubmissionDto, ProductionValueDto, ProductionView } from './planning.types';

export const record = (v: unknown): v is PlanningRecord => v !== null && typeof v === 'object' && !Array.isArray(v);
export const text = (v: unknown): v is string => typeof v === 'string' && !!v.trim() && !/[\u0000-\u001f\u007f]/.test(v);
const whole = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) >= 0;
const rows = (v: unknown): PlanningRecord[] => Array.isArray(v) ? v.filter(record) : [];
const strings = (v: unknown): string[] => Array.isArray(v) ? v.filter(text) : [];
const shown = (v: unknown): string | number | null => text(v) || typeof v === 'number' && Number.isFinite(v) ? v : null;
export const words = (v: string): string => v.replace(/[-_]/g, ' ').replace(/^./, c => c.toUpperCase());
const field = (v: PlanningRecord, key: string): PlanningRecord => record(v[key]) ? v[key] : {};
const list = (v: unknown, predicate: (v: PlanningRecord) => boolean): boolean => Array.isArray(v) && v.every(row => record(row) && predicate(row));
export function versionPins(v: unknown): v is Readonly<Record<string, string>> {
  return record(v) && Object.keys(v).length > 0 && Object.keys(v).length <= 50
    && Object.entries(v).every(([key, value]) => text(key) && key.length <= 200 && text(value) && value.length <= 200);
}
const quantities = (v: unknown): boolean => list(v, q => text(q['derivativeId']) && text(q['modelId']) && whole(q['quantity']))
  && new Set(rows(v).map(q => q['derivativeId'])).size === rows(v).length;
const validMetrics = (v: PlanningRecord): boolean => {
  const coverage = field(v, 'expectedAcceptableCoverage'); const risk = field(v, 'unallocatedStockRisk');
  return whole(v['orderQuantity']) && whole(v['spendMinor']) && text(v['currency']) && whole(coverage['covered'])
    && whole(coverage['total']) && coverage['covered'] <= coverage['total'] && whole(risk['quantity']) && whole(risk['totalSupply'])
    && risk['quantity'] <= risk['totalSupply'];
};
export function validPlan(v: unknown): v is PlanDto {
  if (!record(v) || !text(v['planId']) || !text(v['runId']) || !text(v['asOf']) || !versionPins(v['versions'])
    || !['feasible', 'infeasible'].includes(v['status'] as string) || !quantities(v['quantities'])) return false;
  const pins = v['versions'];
  if (!['forecast', 'policy', 'stock', 'supply', 'cohort', 'catalog'].every(key => text(pins[key]))) return false;
  if (v['status'] === 'infeasible') return rows(v['quantities']).length === 0 && list(v['conflicts'], c => text(c['id']) && text(c['detail']));
  return validMetrics(v) && list(v['modelQuantities'], m => text(m['modelId']) && whole(m['quantity']))
    && list(v['alternatives'], a => text(a['kind']) && (a['status'] === 'feasible' && validMetrics(a) && quantities(a['quantities'])
      || a['status'] === 'infeasible' && list(a['conflicts'], c => text(c['id']) && text(c['detail']))));
}
export function validPlanValue(v: unknown): v is PlanValueDto {
  return record(v) && validPlan(v['plan']) && record(v['presentation'])
    && (v['mode'] === 'current' && v['preview'] === false || v['mode'] === 'preview' && v['preview'] === true && validPlan(v['activePlan']));
}
const requestRow = (r: PlanningRecord): boolean => text(r['requestId']) && text(r['model']) && text(r['derivative'])
  && text(r['state']) && whole(r['quantity']);
export function validProduction(v: unknown): v is ProductionValueDto {
  return record(v) && text(v['asOf']) && record(v['provider'])
    && list(v['submissions'], s => text(s['submissionId']) && text(s['planId']) && text(s['requestedAt']))
    && list(v['requests'], r => requestRow(r) && ['confirmedQuantity', 'queuedQuantity', 'releasedQuantity', 'outstandingQuantity'].every(k => whole(r[k]))
      && (r['confirmedQuantity'] as number) <= (r['quantity'] as number) && (r['queuedQuantity'] as number) <= (r['confirmedQuantity'] as number)
      && (r['releasedQuantity'] as number) <= (r['confirmedQuantity'] as number) && text(r['stage'])
      && list(r['history'], h => whole(h['seq']) && text(h['state']) && text(h['at']) && record(h['details']))
      && list(r['supplies'], s => text(s['supplyId']) && whole(s['quantity']) && text(s['confirmedAt'])
        && typeof s['queued'] === 'boolean' && (s['eligibleFrom'] === null || text(s['eligibleFrom'])) && whole(s['releasedQuantity'])));
}
export function validSubmission(v: unknown): v is ProductionSubmissionDto {
  return record(v) && text(v['submissionId']) && text(v['planId']) && text(v['message']) && list(v['requests'], requestRow);
}
const bad = <T>(): PlanningResult<T> => ({ status: 'unavailable', code: 'planning-response-malformed', reason: 'The service returned incomplete planning information.', retryable: true });
function nameOf(p: PlanningRecord, kind: 'model' | 'derivative', id: unknown): string {
  const match = rows(p[kind === 'model' ? 'models' : 'derivatives']).find(r => r[`${kind}Id`] === id);
  return match ? (kind === 'model' ? String(match['model']) : [match['model'], match['derivative']].filter(text).join(' ')) : String(id);
}
const one = (v: number): string => v.toFixed(1);
const count = (v: unknown): string => typeof v === 'number' && Number.isFinite(v) ? Number.isInteger(v) ? String(v) : one(v) : 'Not supplied';
const signed = (v: unknown): string => typeof v === 'number' && Number.isFinite(v) ? `${v > 0 ? '+' : ''}${count(v)}` : 'Not supplied';
const number = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const INCOMPLETE_LEARNED = "The learned model's answer was incomplete, so only the baseline plan is shown.";
const LEARNED_MEASURES: readonly (readonly [string, string])[] = [['Acceptable coverage', 'coverage'], ['Vehicles ordered', 'orderQuantity'],
  ['Spend (minor units)', 'spendMinor'], ['Unmet needs', 'unmetNeeds']];
function learnedModel(answer: PlanningRecord, p: PlanningRecord): LearnedModelView | null {
  const forecast = field(answer, 'forecast'); const model = field(forecast, 'model'); const aggregate = forecast['aggregate'];
  const diff = field(answer, 'differences'); const evaluation = field(forecast, 'evaluation');
  if (!text(model['artifactId']) || !Array.isArray(aggregate) || typeof diff['comparable'] !== 'boolean'
    || !aggregate.every(r => record(r) && text(r['vehicleClass']) && text(r['period']) && number(r['expected']) && number(r['low']) && number(r['high'])
      && r['low'] <= r['expected'] && r['expected'] <= r['high'])) return null;
  const overall = field(evaluation, 'overall'); const thin = strings(field(evaluation, 'thin')['vehicleClasses']);
  const score = (label: string, key: string): PlanningFact[] => {
    const m = field(overall, key);
    return number(m['logLoss']) && number(m['brier']) ? [{ label, value: `Log loss ${m['logLoss'].toFixed(4)}, Brier ${m['brier'].toFixed(4)}` }] : [];
  };
  const pair = (r: PlanningRecord) => ({ baseline: count(r['baseline']), learned: count(r['learned']), difference: signed(r['delta']) });
  const comparable = diff['comparable'];
  return {
    modelFacts: [['Model reference', model['artifactId']], ['Model version', model['modelVersion']], ['Feature version', model['featureVersion']],
      ['Activated under policy version', model['activationPolicyVersion']], ['Training data', field(forecast, 'data')['datasetKind']], ['Forecast version', forecast['version']]]
      .map(([label, value]) => ({ label: label as string, value: shown(value) })).filter(f => f.value !== null),
    classes: (aggregate as PlanningRecord[]).map(r => ({ label: `${words(r['vehicleClass'] as string)}, ${r['period']}`, expected: one(r['expected'] as number),
      low: one(r['low'] as number), high: one(r['high'] as number) })),
    evaluation: [...text(evaluation['label']) ? [{ label: evaluation['label'], value: 'Lower scores are better.' }] : [],
      ...score('Learned model', 'learned'), ...score('Expressed demand', 'expressedDemand'), ...score('Deterministic fit', 'deterministicFit'),
      ...thin.length ? [{ label: 'Thin evidence for vehicle classes', value: thin.map(words).join(', ') }] : []],
    limitations: strings(forecast['limitations']),
    differences: { comparable, note: comparable ? null : 'The learned and baseline plans cannot be compared, because one of them has no feasible order.',
      rows: !comparable ? [] : [...LEARNED_MEASURES.map(([label, key]) => ({ label, ...pair(field(diff, key)) })),
        ...rows(diff['derivatives']).filter(d => d['changed'] === true).map(d => ({ label: nameOf(p, 'derivative', d['derivativeId']), ...pair(d) }))] },
  };
}
function lines(v: unknown, presentation: PlanningRecord): PlanningLine[] {
  return rows(v).map(q => ({ id: String(q['derivativeId']), model: nameOf(presentation, 'model', q['modelId']),
    derivative: nameOf(presentation, 'derivative', q['derivativeId']), quantity: q['quantity'] as number }));
}
const constraints = (v: unknown): string[] => rows(v).map(c => [shown(c['id']), shown(c['detail'])].filter(v => v !== null).join(': '));
function metrics(plan: PlanningRecord): PlanningFact[] {
  if (plan['status'] !== 'feasible') return [];
  const coverage = field(plan, 'expectedAcceptableCoverage'); const risk = field(plan, 'unallocatedStockRisk');
  return [{ label: 'Acceptable coverage before renewal', value: `${coverage['covered']} of ${coverage['total']}` },
    { label: 'Unallocated-stock risk', value: `${risk['quantity']} of ${risk['totalSupply']}` },
    { label: `Spend (${shown(plan['currency']) ?? 'currency not supplied'} minor units)`, value: shown(plan['spendMinor']) },
    { label: 'Vehicles in this order', value: shown(plan['orderQuantity']) }];
}
function editors(plan: PlanDto, p: PlanningRecord): { editors: ConstraintEditor[]; unsupported: string[] } {
  const result: ConstraintEditor[] = []; const unsupported: string[] = [];
  for (const key of strings(p['editableKeys'])) {
    const provenance = rows(plan['policyProvenance']).find(r => r['key'] === key); const value = provenance?.['value'];
    if (key === 'orderPlan.budgetMinor' && whole(value)) {
      result.push({ key, label: 'Order budget', kind: 'budget', unit: `${shown(plan['currency']) ?? shown(p['currency']) ?? ''} minor units`, value, rows: [] }); continue;
    }
    const kind = key === 'orderPlan.modelBounds' ? 'model' : key === 'orderPlan.derivativeBounds' ? 'derivative' : null;
    if (kind && list(value, r => text(r[`${kind}Id`]) && whole(r['min']) && whole(r['max']))) {
      result.push({ key, label: kind === 'model' ? 'Model limits' : 'Derivative limits', kind: 'bounds', unit: 'vehicles',
        idField: `${kind}Id`, rows: rows(value).map(r => ({ id: String(r[`${kind}Id`]), label: nameOf(p, kind, r[`${kind}Id`]), min: r['min'] as number, max: r['max'] as number })) });
    } else unsupported.push(key);
  }
  return { editors: result, unsupported };
}
function alternative(a: PlanningRecord, p: PlanningRecord): PlanAlternative {
  const feasible = a['status'] === 'feasible';
  return { label: a['kind'] === 'zero-new-orders-baseline' ? 'No new orders' : a['kind'] === 'next-best-distinct-feasible' ? 'Next best plan' : String(a['kind'] ?? 'Alternative'),
    status: typeof a['status'] === 'string' ? a['status'] : 'unavailable', same: a['identicalToRecommendation'] === true,
    lines: feasible && quantities(a['quantities']) ? lines(a['quantities'], p) : [], facts: feasible ? metrics(a) : [], conflicts: constraints(a['conflicts']) };
}
export function projectPlan(input: unknown): PlanningResult<PlanView> {
  if (!record(input) || input['status'] !== 'ok') return record(input) && text(input['status']) ? input as unknown as PlanningResult<PlanView> : bad();
  if (!validPlanValue(input['value'])) return bad();
  const value = input['value']; const plan = value.plan; const p = value.presentation;
  const feasible = plan.status === 'feasible'; const coverage = field(plan, 'expectedAcceptableCoverage');
  const empty = feasible && coverage['total'] === 0; const order = shown(plan['orderQuantity']);
  const edit = editors(plan, p); const replan = field(value, 'replan'); const learned = field(value, 'learned');
  const learnedView = learned['status'] === 'available' ? learnedModel(learned, p) : null;
  const learnedNote = learned['status'] === 'available' ? learnedView ? null : INCOMPLETE_LEARNED
    : text(learned['limitation']) ? learned['limitation'] : text(learned['reason']) ? learned['reason'] : null;
  const forecast = shown(p['forecastBasis']); const risk = field(plan, 'unallocatedStockRisk'); const unbound = field(plan, 'unboundStock');
  const active = value.activePlan;
  const comparedIds = active ? [...new Set([...active.quantities, ...plan.quantities].map(q => q.derivativeId))] : [];
  const comparison = active ? [
    { label: 'Vehicles ordered', current: shown(active['orderQuantity']), preview: shown(plan['orderQuantity']) },
    { label: 'Spend (minor units)', current: shown(active['spendMinor']), preview: shown(plan['spendMinor']) },
    { label: 'Acceptable coverage', current: active.status === 'feasible' ? `${field(active, 'expectedAcceptableCoverage')['covered']} of ${field(active, 'expectedAcceptableCoverage')['total']}` : null,
      preview: feasible ? `${coverage['covered']} of ${coverage['total']}` : null },
    { label: 'Unallocated-stock risk', current: active.status === 'feasible' ? `${field(active, 'unallocatedStockRisk')['quantity']} of ${field(active, 'unallocatedStockRisk')['totalSupply']}` : null,
      preview: feasible ? `${risk['quantity']} of ${risk['totalSupply']}` : null },
    ...comparedIds.map(id => ({ label: nameOf(p, 'derivative', id),
      current: active.quantities.find(q => q.derivativeId === id)?.quantity ?? null,
      preview: plan.quantities.find(q => q.derivativeId === id)?.quantity ?? null })),
  ] : [];
  return { status: 'ok', value: { planId: plan.planId, versions: { ...plan.versions }, preview: value.preview,
    state: empty ? 'empty' : plan.status,
    title: !feasible ? 'No plan meets these limits' : empty ? 'No saved demand to plan for yet' : order === 0 ? 'No new order recommended' : `Order ${order} vehicles`,
    message: value.preview ? typeof value['message'] === 'string' ? value['message'] : 'Preview only. Nothing is saved, published or ordered.' : 'Nothing is ordered until Production confirms.',
    forecast: forecast === 'expressed-saved-demand' ? 'Expressed demand (deterministic baseline)' : String(forecast ?? 'Source not supplied'),
    forecastNote: forecast === 'expressed-saved-demand' ? 'Built from what employees have saved and confirmed they need. It is not a prediction.' : null,
    facts: [{ label: 'Plan for', value: plan.asOf }, { label: 'Plan reference', value: plan.planId }, ...Object.entries(plan.versions).map(([key, v]) => ({ label: `${words(key)} version`, value: v }))],
    lines: feasible ? lines(plan.quantities, p) : [], models: feasible ? rows(plan['modelQuantities']).map(r => ({ label: nameOf(p, 'model', r['modelId']), value: shown(r['quantity']) })) : [],
    metrics: metrics(plan), conflicts: constraints(plan['conflicts']), binding: constraints(plan['bindingConstraints']), limitations: strings(plan['limitations']),
    unmet: rows(plan['unmetNeeds']).map(n => ({ label: `Renewal ${shown(n['renewalAt']) ?? 'date not supplied'}`, reasons: strings(n['gates']).map(words), constraints: strings(n['constraintIds']) })),
    alternatives: rows(plan['alternatives']).map(a => alternative(a, p)), editors: edit.editors, unsupportedEditors: edit.unsupported,
    learned: learnedNote, learnedModel: learnedView,
    replan: text(replan['status']) ? words(replan['status']) : null,
    unbound: whole(unbound['count']) && unbound['count'] > 0 ? `${unbound['count']} cars left out of this plan${strings(unbound['models']).length ? ': ' + strings(unbound['models']).join(', ') : ''}.` : null,
    riskSources: rows(risk['bySource']).map(r => ({ label: String(r['sourceId']), value: shown(r['quantity']) })), comparison,
    canSubmit: feasible && !empty && !value.preview && typeof order === 'number' && order > 0 && plan.quantities.some(q => q.quantity > 0),
  } };
}
export function projectProduction(input: unknown): PlanningResult<ProductionView> {
  if (!record(input) || input['status'] !== 'ok') return record(input) && text(input['status']) ? input as unknown as PlanningResult<ProductionView> : bad();
  if (!validProduction(input['value'])) return bad();
  const v = input['value'];
  const requests: ProductionRequestView[] = v.requests.map(r => ({ id: String(r['requestId']), model: String(r['model']), derivative: String(r['derivative']),
    state: words(String(r['state'])), stage: words(String(r['stage'])), message: text(r['message']) ? r['message'] : null,
    reason: text(r['reason']) ? r['reason'] : null, code: text(r['code']) ? r['code'] : null,
    facts: [['Requested', 'quantity'], ['Confirmed', 'confirmedQuantity'], ['Queued for release', 'queuedQuantity'], ['Released to stock', 'releasedQuantity'],
      ['Outstanding', 'outstandingQuantity'], ['Plan reference', 'planId'], ['Submission reference', 'submissionId'], ['Requested at', 'requestedAt'],
      ['Delayed until', 'delayUntil'], ['Provider reference', 'providerReference'], ['Provider mode', 'providerMode']].map(([label, key]) => ({ label, value: shown(r[key]) })),
    history: rows(r['history']).map(h => ({ state: words(String(h['state'] ?? 'Unknown')), at: String(h['at'] ?? 'Time not supplied'),
      details: [['Confirmed', 'confirmedQuantity'], ['Reason', 'reason'], ['Response code', 'code'], ['Delayed until', 'delayUntil']]
        .map(([label, key]) => ({ label, value: shown(field(h, 'details')[key]) })).filter(f => f.value !== null) })),
    supplies: rows(r['supplies']).map(s => ({ id: String(s['supplyId']), facts: [['Quantity', 'quantity'], ['Confirmed at', 'confirmedAt'], ['Eligible from', 'eligibleFrom'],
      ['Released', 'releasedQuantity']].map(([label, key]) => ({ label, value: shown(s[key]) })).concat([{ label: 'Queued', value: typeof s['queued'] === 'boolean' ? s['queued'] ? 'Yes' : 'No' : null }]) })),
  }));
  return { status: 'ok', value: { asOf: v.asOf,
    provider: ['mode', 'provider', 'sourceVersion', 'status'].map(key => ({ label: words(key), value: shown(v.provider[key]) })),
    submissions: v.submissions.map(s => ({ label: String(s['submissionId']), value: `${s['requestedAt']} · ${s['planId']}` })), requests,
    fingerprint: JSON.stringify({ provider: v.provider, submissions: v.submissions, requests: v.requests }),
  } };
}
