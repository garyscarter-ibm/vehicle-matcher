// Pure mapping from a Greg order-plan read or preview value to display data. No DOM: every figure comes from the server.
import {
  FORECAST_LABEL, FORECAST_QUALIFIER, FORECAST_NOTE, PREVIEW_FALLBACK, NO_ORDER, INFEASIBLE_ACTION, NO_DEMAND_ACTION, NO_DEMAND_NOTE,
  alternativeLabel, changeLabel, detailText, formatDate, formatDemoTime, gateText, humanise, inputLabel, money, plural,
  requestStateLabel, responseLabel, SUBMISSION_LABELS, LEARNED_LABEL, LEARNED_UNREADABLE, UNBOUND_TITLE, unboundStockText,
} from './plan-copy.js';

export const LIMIT_KEYS = Object.freeze({ models: 'orderPlan.modelBounds', derivatives: 'orderPlan.derivativeBounds', budget: 'orderPlan.budgetMinor' });

/** Thrown for a value without a plan; the panel shows its "unavailable" state. */
export class PlanViewError extends Error {
  constructor(reason) { super(`Order plan value unreadable: ${reason}`); this.name = 'PlanViewError'; this.code = 'malformed-plan'; }
}
const list = (v) => (Array.isArray(v) ? v : []);
const object = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// Names come from presentation (server catalogue); an unknown id shows as itself.
function namer(presentation) {
  const derivatives = new Map(list(presentation?.derivatives).map((d) => [d.derivativeId, d]));
  const models = new Map(list(presentation?.models).map((m) => [m.modelId, m.model]));
  const derivative = (id) => { const d = derivatives.get(id); return d ? `${d.model} ${d.derivative}` : String(id); };
  const model = (id) => models.get(id) ?? list(presentation?.derivatives).find((d) => d.modelId === id)?.model ?? String(id);
  return { derivative, model, parts: (id) => derivatives.get(id) ?? null };
}

/** Constraint id (budget, derivative:<id>:max, model:<id>:min, lead-time:<id> ...) -> label. */
export function constraintLabel(id, names) {
  const [kind, ref, edge] = String(id).split(':');
  const bound = edge === 'min' ? 'minimum' : 'maximum';
  if (id === 'budget') return 'Budget';
  if (kind === 'derivative' && ref && ['min', 'max'].includes(edge)) return `${names.derivative(ref)} ${bound}`;
  if (kind === 'model' && ref && ['min', 'max'].includes(edge)) return `${names.model(ref)} ${bound}`;
  if (kind === 'lead-time' && ref) return `${names.derivative(ref)} lead time`;
  if (kind === 'lead-time-before-renewal' && ref) return `${names.derivative(ref)} cannot arrive before the renewal`;
  if (kind === 'lead-time-before-required-by' && ref) return `${names.derivative(ref)} cannot arrive by the date needed`;
  return humanise(id);
}
const constraints = (rows, names, currency) => list(rows).map((c) => ({ id: c.id, label: constraintLabel(c.id, names), detail: detailText(c.detail, currency) }));

const linesOf = (quantities, names) => list(quantities).map((q) => ({
  derivativeId: q.derivativeId, modelId: q.modelId, model: names.parts(q.derivativeId)?.model ?? names.model(q.modelId),
  derivative: names.parts(q.derivativeId)?.derivative ?? String(q.derivativeId), name: names.derivative(q.derivativeId), quantity: q.quantity, zero: q.quantity === 0,
}));
const ordered = (lines) => lines.filter((l) => l.quantity > 0);
const orderText = (lines) => {
  const rows = ordered(lines);
  return rows.length === 1 ? rows[0].name : rows.map((l) => `${l.quantity} × ${l.name}`).join(', ');
};
const orderHeadline = (n, lines) => `Order ${plural(n, 'vehicle')}: ${orderText(lines)}`;

function coverageOf(c) {
  if (!object(c) || !Number.isFinite(c.total)) return null;
  const percent = Math.round((Number.isFinite(c.fraction) ? c.fraction : c.total ? c.covered / c.total : 0) * 100);
  return { covered: c.covered, total: c.total, fraction: c.fraction, percent, short: `${c.covered} of ${c.total}`,
    label: c.total === 0 ? 'No renewals to cover yet' : `${c.covered} of ${c.total} renewals covered before renewal` };
}
function sourceLabel(sourceId, names) {
  const [kind, ref] = String(sourceId).split(':');
  if (kind === 'order') return `New order: ${names.derivative(ref)}`;
  if (kind === 'supply') return 'Confirmed inbound from Production';
  if (kind === 'stock') return 'Vehicle already in stock';
  return humanise(sourceId);
}
function riskOf(r, names) {
  if (!object(r) || !Number.isFinite(r.quantity)) return null;
  return { quantity: r.quantity, totalSupply: r.totalSupply, short: plural(r.quantity, 'vehicle'),
    label: r.totalSupply === 0 ? 'No vehicles in supply, so none can be left unmatched'
      : `${r.quantity} of ${plural(r.totalSupply, 'vehicle')} in supply not matched to a renewal`,
    sources: [...list(r.bySource).reduce((byLabel, s) => {
      const label = sourceLabel(s.sourceId, names); const seen = byLabel.get(label);
      if (seen) seen.quantity += s.quantity; else byLabel.set(label, { sourceId: s.sourceId, quantity: s.quantity, label });
      return byLabel;
    }, new Map()).values()] };
}

function alternativeOf(alt, names, currency) {
  const label = alternativeLabel(alt.kind);
  const sameAsRecommended = alt.identicalToRecommendation === true;
  if (alt.status !== 'feasible') {
    const conflicts = constraints(alt.conflicts, names, currency);
    return { kind: alt.kind, label, status: alt.status, sameAsRecommended, conflicts, lines: [], coverage: null, risk: null, spend: null, orderQuantity: null,
      summary: `Not possible inside these limits${conflicts.length ? `: ${conflicts.map((c) => c.label).join(', ')}` : ''}.` };
  }
  const lines = linesOf(alt.quantities, names);
  const coverage = coverageOf(alt.expectedAcceptableCoverage); const risk = riskOf(alt.unallocatedStockRisk, names);
  const parts = [alt.orderQuantity > 0 ? orderHeadline(alt.orderQuantity, lines) : 'No new vehicles', coverage && `Covers ${coverage.short} renewals`,
    Number.isFinite(alt.spendMinor) && `Spend ${money(alt.spendMinor, currency)}`, risk && `${risk.short} unmatched`].filter(Boolean);
  return { kind: alt.kind, label, status: alt.status, sameAsRecommended, conflicts: [], lines: ordered(lines), coverage, risk,
    spend: Number.isFinite(alt.spendMinor) ? money(alt.spendMinor, currency) : null, orderQuantity: alt.orderQuantity, summary: `${parts.join('. ')}.` };
}

function unmetOf(need, names) {
  const date = formatDate(need.renewalAt);
  return { renewalAt: need.renewalAt, label: `Renewal on ${date ?? 'an unknown date'}`,
    reasons: list(need.gates).length ? need.gates.map((g) => gateText(g, names.derivative)) : ['No reason was given'],
    blockedBy: list(need.constraintIds).map((id) => constraintLabel(id, names)) };
}

function versionsOf(value, plan, presentation) {
  const basis = presentation?.forecastBasis;
  const known = basis === 'expressed-saved-demand';
  const planIdShort = String(plan.planId).replace(/^order-plan-/, '').slice(0, 8);
  return { forecast: { basis: basis ?? null, label: known ? FORECAST_LABEL : (basis ?? 'Source not stated'), qualifier: known ? FORECAST_QUALIFIER : null,
    note: known ? FORECAST_NOTE : null },
  policy: plan.versions?.policy ?? null, basePolicy: value.activePolicyVersion ?? plan.versions?.policy ?? null,
  asOf: plan.asOf, asOfLabel: formatDemoTime(plan.asOf), planId: plan.planId, planIdShort };
}

// Current editable values, read from the plan's own policy provenance in the order the server lists the editable keys.
function limitsOf(plan, presentation, names) {
  const at = (key) => list(plan.policyProvenance).find((p) => p.key === key);
  return list(presentation?.editableKeys).flatMap((key) => {
    const row = at(key); if (!row) return [];
    if (key === LIMIT_KEYS.budget) {
      return [{ key, kind: 'budget', label: 'Order budget', minor: row.value, pounds: row.value / 100, unit: row.unit, currency: plan.currency ?? presentation?.currency ?? 'GBP' }];
    }
    const model = key === LIMIT_KEYS.models;
    if (!model && key !== LIMIT_KEYS.derivatives) return [];
    const idField = model ? 'modelId' : 'derivativeId';
    return [{ key, kind: 'bounds', idField, label: model ? 'Model limits' : 'Derivative limits',
      rows: list(row.value).map((b) => ({ id: b[idField], label: model ? names.model(b.modelId) : names.derivative(b.derivativeId), min: b.min, max: b.max })) }];
  });
}

function differencesOf(plan, active, names, currency) {
  const quantity = (p, id) => list(p?.quantities).find((q) => q.derivativeId === id)?.quantity ?? null;
  const ids = [...new Set([...list(active?.quantities), ...list(plan.quantities)].map((q) => q.derivativeId))];
  const lines = ids.map((id) => {
    const current = quantity(active, id); const next = quantity(plan, id);
    const change = current !== null && next !== null ? next - current : null;
    return { derivativeId: id, name: names.derivative(id), current, preview: next, change, changed: next === null || change !== 0,
      changeLabel: next === null ? 'No plan' : changeLabel(change) };
  });
  const pair = (before, after) => ({ before, after, changed: before !== after });
  const covers = (p) => coverageOf(p?.expectedAcceptableCoverage)?.short ?? null;
  const risks = (p) => riskOf(p?.unallocatedStockRisk, names)?.short ?? null;
  const spends = (p) => (Number.isFinite(p?.spendMinor) ? money(p.spendMinor, currency) : null);
  const metrics = { coverage: pair(covers(active), covers(plan)), risk: pair(risks(active), risks(plan)), spend: pair(spends(active), spends(plan)),
    orderQuantity: pair(active?.orderQuantity ?? null, plan.orderQuantity ?? null) };
  const changed = lines.some((l) => l.changed) || Object.values(metrics).some((m) => m.changed);
  const summary = plan.status === 'infeasible' ? 'No plan meets these limits, so there is nothing to compare yet.'
    : changed ? 'This preview differs from the current plan.' : 'This preview gives the same plan as now.';
  return { changed, summary, lines, ...metrics };
}

function submissionOf(replan, names) {
  if (!object(replan) || !['unchanged-since-submission', 'replanned'].includes(replan.status)) return null;
  const replanned = replan.status === 'replanned';
  return { status: replanned ? 'replanned' : 'submitted', message: SUBMISSION_LABELS[replanned ? 'replanned' : 'submitted'],
    submittedAt: replan.submittedAt, submittedAtLabel: formatDemoTime(replan.submittedAt), after: replanned ? responseLabel(replan.after) : null,
    afterAt: replanned ? (replan.after?.at ?? null) : null, afterAtLabel: replanned ? formatDemoTime(replan.after?.at) : null,
    requests: list(replan.requests).map((r) => ({ name: names.derivative(r.derivativeId), quantity: r.quantity, state: r.state, stateLabel: requestStateLabel(r.state) })) };
}

const text = (v) => (typeof v === 'string' && v.trim() ? v : null);
const strings = (v) => list(v).filter((x) => typeof x === 'string' && x);
const metric = (m) => (object(m) && Number.isFinite(m.logLoss) && Number.isFinite(m.brier)
  ? { logLoss: m.logLoss.toFixed(3), brier: m.brier.toFixed(3), count: m.count, thin: m.thin === true } : null);
const signedMoney = (delta, currency) => (!Number.isFinite(delta) || delta === 0 ? 'No change' : `${delta > 0 ? '+' : '-'}${money(Math.abs(delta), currency)}`);

// Learned plan beside the baseline: rows for the comparison, evaluation facts and limits. Never invents a figure.
function learnedOf(value, names, currency) {
  if (value === undefined || value === null) return null;
  const kinds = ['available', 'fallback', 'unavailable'];
  const label = object(value) && text(value.label) ? value.label : LEARNED_LABEL;
  if (!object(value) || !kinds.includes(value.status)) return { status: 'unavailable', label, reason: null, limitation: LEARNED_UNREADABLE, coverage: null };
  if (value.status !== 'available') {
    const c = object(value.coverage) ? { cohorts: strings(value.coverage.cohorts), vehicleClasses: strings(value.coverage.vehicleClasses) } : null;
    return { status: value.status, label, reason: value.reason ?? null, limitation: text(value.limitation) ?? LEARNED_UNREADABLE, coverage: c && (c.cohorts.length || c.vehicleClasses.length) ? c : null };
  }
  const d = object(value.differences) ? value.differences : {};
  const comparable = d.comparable === true;
  const row = (name, p, format, sign) => ({ name, baseline: format(p?.baseline), learned: format(p?.learned), difference: sign(p?.delta), changed: Number.isFinite(p?.delta) && p.delta !== 0 });
  const derivatives = list(d.derivatives).map((r) => ({ name: names.derivative(r.derivativeId), baseline: String(r.baseline), learned: String(r.learned),
    difference: changeLabel(r.delta), changed: r.changed === true, quantity: Math.max(Number(r.baseline) || 0, Number(r.learned) || 0) }))
    .sort((a, b) => Number(b.changed) - Number(a.changed) || Number(b.quantity > 0) - Number(a.quantity > 0));
  const rows = comparable ? [...derivatives, row('Vehicles ordered', d.orderQuantity, String, changeLabel), row('Employees covered', d.coverage, String, changeLabel),
    row('Unmet needs', d.unmetNeeds, String, changeLabel), row('Spend', d.spendMinor, (m) => money(m, currency), (n) => signedMoney(n, currency))] : [];
  const f = object(value.forecast) ? value.forecast : {}; const ev = object(f.evaluation) ? f.evaluation : {}; const o = object(ev.overall) ? ev.overall : {};
  const model = object(f.model) ? f.model : {}; const learnedScore = metric(o.learned);
  return { status: 'available', label, comparable, rows, changedCount: rows.filter((r) => r.changed).length,
    evaluation: learnedScore ? { label: text(ev.label), learned: learnedScore, expressed: metric(o.expressedDemand), fit: metric(o.deterministicFit),
      count: learnedScore.count, thin: learnedScore.thin || Boolean(ev.thin?.cohorts?.length || ev.thin?.vehicleClasses?.length),
      thinCohorts: strings(ev.thin?.cohorts), thinClasses: strings(ev.thin?.vehicleClasses) } : null,
    model: { artifact: typeof model.artifactId === 'string' ? model.artifactId.replace(/^sha256:/, '').slice(0, 12) : null,
      policy: text(model.activationPolicyVersion), data: text(f.data?.datasetKind) }, limitations: strings(f.limitations) };
}

// Cars the server left out because no catalogue entry lists them; nothing is shown for none.
function unboundOf(v) {
  const count = object(v) ? v.count : 0;
  if (!Number.isSafeInteger(count) || count < 1) return null;
  const models = list(v.models).filter((m) => typeof m === 'string' && m.trim());
  return { count, models, title: UNBOUND_TITLE, message: unboundStockText(count, models) };
}

/** Read or preview value -> everything the panel renders (see the keys below). Throws PlanViewError without a plan. */
export function toPlanView(value) {
  const plan = value?.plan;
  if (!object(plan) || typeof plan.planId !== 'string') throw new PlanViewError('no plan');
  const presentation = value.presentation ?? null;
  const names = namer(presentation);
  const currency = plan.currency ?? presentation?.currency ?? 'GBP';
  const preview = value.preview === true || value.mode === 'preview';
  const infeasible = plan.status === 'infeasible';
  const coverage = infeasible ? null : coverageOf(plan.expectedAcceptableCoverage);
  const kind = infeasible ? 'infeasible' : !preview && coverage?.total === 0 ? 'no-demand' : preview ? 'preview' : 'ready';
  const lines = infeasible ? [] : linesOf(plan.quantities, names);
  const orders = ordered(lines);
  const action = infeasible ? INFEASIBLE_ACTION : kind === 'no-demand' ? NO_DEMAND_ACTION
    : plan.orderQuantity > 0 ? orderHeadline(plan.orderQuantity, lines) : NO_ORDER;
  const alternatives = infeasible ? [] : list(plan.alternatives).map((a) => alternativeOf(a, names, currency));
  return {
    kind, preview, previewMessage: preview ? (value.message || PREVIEW_FALLBACK) : null, submission: preview ? null : submissionOf(value.replan, names),
    unbound: unboundOf(plan.unboundStock), action, note: kind === 'no-demand' ? NO_DEMAND_NOTE : null, currency, orderQuantity: infeasible ? 0 : (plan.orderQuantity ?? 0),
    canSubmit: !infeasible && kind !== 'no-demand' && orders.length > 0,
    lines, orders, models: infeasible ? [] : list(plan.modelQuantities).map((m) => ({ modelId: m.modelId, model: names.model(m.modelId), quantity: m.quantity, zero: m.quantity === 0 })),
    spend: infeasible || !Number.isFinite(plan.spendMinor) ? null : money(plan.spendMinor, currency), spendMinor: infeasible ? null : (plan.spendMinor ?? null),
    coverage, unallocatedRisk: infeasible ? null : riskOf(plan.unallocatedStockRisk, names),
    unmetNeeds: infeasible ? [] : list(plan.unmetNeeds).map((n) => unmetOf(n, names)),
    binding: infeasible ? [] : constraints(plan.bindingConstraints, names, currency),
    conflicts: infeasible ? constraints(plan.conflicts, names, currency) : [], alternatives,
    versions: versionsOf(value, plan, presentation), limits: limitsOf(plan, presentation, names),
    differences: preview ? differencesOf(plan, value.activePlan, names, currency) : null,
    learned: learnedOf(value.learned, names, currency),
    submit: { planId: plan.planId, versions: plan.versions, changes: preview ? list(value.changes) : [] },
  };
}

const toInt = (v) => (v === '' || v === null || v === undefined ? null : Number(v));
const sameBounds = (a, b) => a.rows.length === b.rows.length && a.rows.every((r, i) => r.id === b.rows[i].id && Number(r.min) === Number(b.rows[i].min) && Number(r.max) === Number(b.rows[i].max));

/** Edited `limits` (string inputs allowed) -> route `changes`; with a `baseline` only edited groups go. Unreadable numbers become null. */
export function toChanges(draft, baseline = null) {
  return list(draft).flatMap((group) => {
    const before = list(baseline).find((g) => g.key === group.key);
    if (group.kind === 'budget') {
      const pounds = toInt(group.pounds);
      const minor = pounds === null ? null : Math.round(pounds * 100);
      return before && Math.round(Number(before.pounds) * 100) === minor ? [] : [{ key: group.key, value: minor }];
    }
    if (group.kind !== 'bounds') return [];
    if (before && sameBounds(group, before)) return [];
    const value = list(group.rows).map((r) => ({ [group.idField]: r.id, min: toInt(r.min), max: toInt(r.max) }))
      .sort((a, b) => (a[group.idField] < b[group.idField] ? -1 : a[group.idField] > b[group.idField] ? 1 : 0));
    return [{ key: group.key, value }];
  });
}

/** A replan-needed outcome from the adapter -> a labelled list of what changed since the plan was made. */
export function staleView(outcome) {
  const keys = [...new Set(list(outcome?.changedInputs))];
  const changed = [...keys.filter((k) => k !== 'plan'), ...keys.filter((k) => k === 'plan')].map((key) => ({ key, label: inputLabel(key) }));
  return { title: 'Replan needed', message: outcome?.message || 'Inputs changed since this plan was made. Replan before submitting.', changed,
    summary: changed.length ? `Changed since this plan: ${changed.map((c) => c.label.toLowerCase()).join(', ')}.` : 'Something changed since this plan was made.',
    current: outcome?.current ?? null, replanLabel: 'Replan with the latest inputs' };
}
