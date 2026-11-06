import { inputDigest } from '../../repository/core.js';
import { CONTRACT_VERSION, SOLVER_LIMITS, resolveInput, compare, integer } from './input.js';

const day = 86400000;
const constraint = (id, detail) => ({ id, detail });
const limit = (field, actual, maximum) => ({ field, actual, maximum });
const deadlineFor = (entitlement) => entitlement.requiredBy ?? entitlement.renewalAt;

function lotsFor(input, vector) {
  const horizon = Date.parse(input.forecast.horizonEnd);
  return [
    ...input.stock.map((s) => ({ id: `stock:${s.stockId}`, derivativeId: s.derivativeId, quantity: 1, availableAt: s.availableAt,
      heldForEntitlementId: s.heldForEntitlementId, permittedEntitlementIds: s.permittedEntitlementIds ?? null, source: 'stock', stockId: s.stockId })),
    ...input.inbound.map((s) => ({ id: `supply:${s.supplyId}`, derivativeId: s.derivativeId, quantity: s.quantity - s.releasedQuantity,
      availableAt: s.expectedAt, heldForEntitlementId: null, source: 'confirmed-inbound' })),
    ...input.catalog.map((d, i) => ({ id: `order:${d.derivativeId}`, derivativeId: d.derivativeId, quantity: vector[i],
      availableAt: new Date(Date.parse(input.asOf) + d.leadTimeDays * day).toISOString(), heldForEntitlementId: null, source: 'new-order' })),
  ].filter((s) => s.quantity > 0 && Date.parse(s.availableAt) <= horizon)
    .sort((a, b) => compare(a.availableAt, b.availableAt) || compare(a.id, b.id));
}

// Capacitated bipartite matching: each augmentation may move a flexible entitlement
// to a substitute. Neither array order nor independent derivative demand counts decide coverage.
function allocate(input, lots, effort) {
  const entitlements = input.forecast.entitlements;
  const owners = lots.map(() => []);
  const assignment = new Map();
  const choices = entitlements.map((e) => lots.flatMap((s, i) => e.acceptableDerivativeIds.includes(s.derivativeId)
    && Date.parse(input.asOf) <= Date.parse(deadlineFor(e))
    && Date.parse(s.availableAt) <= Date.parse(deadlineFor(e))
    && !(s.source === 'stock' && e.excludedStockIds?.includes(s.stockId))
    && (s.heldForEntitlementId === null || s.heldForEntitlementId === e.entitlementId)
    && (s.permittedEntitlementIds == null || s.permittedEntitlementIds.includes(e.entitlementId)) ? [i] : []));
  const augment = (employee, seen) => {
    for (const lot of choices[employee]) {
      effort.steps += 1;
      if (effort.steps > SOLVER_LIMITS.matchingSteps) throw new RangeError('matching-effort');
      if (seen.has(lot)) continue;
      seen.add(lot);
      if (owners[lot].length < lots[lot].quantity) {
        owners[lot].push(employee); assignment.set(employee, lot); return true;
      }
      for (let at = 0; at < owners[lot].length; at += 1) {
        const previous = owners[lot][at];
        if (augment(previous, seen)) {
          owners[lot][at] = employee; assignment.set(employee, lot); return true;
        }
      }
    }
    return false;
  };
  entitlements.forEach((e, i) => augment(i, new Set()));
  return entitlements.flatMap((e, i) => assignment.has(i) ? [{ entitlementId: e.entitlementId,
    derivativeId: lots[assignment.get(i)].derivativeId, sourceId: lots[assignment.get(i)].id,
    source: lots[assignment.get(i)].source, availableAt: lots[assignment.get(i)].availableAt, renewalAt: e.renewalAt,
    ...(e.requiredBy === undefined ? {} : { requiredBy: e.requiredBy }) }] : []);
}

function hardConstraints(input, vector) {
  const { constraints: p, catalog } = input;
  const conflicts = [];
  for (const [i, d] of catalog.entries()) {
    const bound = p.derivativeBounds.find((b) => b.derivativeId === d.derivativeId);
    if (vector[i] < bound.min) conflicts.push(constraint(`derivative:${d.derivativeId}:min`, `Minimum ${bound.min}.`));
    if (vector[i] > bound.max) conflicts.push(constraint(`derivative:${d.derivativeId}:max`, `Maximum ${bound.max}.`));
    if (vector[i] > 0 && Date.parse(input.asOf) + d.leadTimeDays * day > Date.parse(input.forecast.horizonEnd)) conflicts.push(constraint(`lead-time:${d.derivativeId}`, 'New orders arrive after the planning horizon.'));
  }
  for (const b of p.modelBounds) {
    const quantity = catalog.reduce((n, d, i) => n + (d.modelId === b.modelId ? vector[i] : 0), 0);
    if (quantity < b.min) conflicts.push(constraint(`model:${b.modelId}:min`, `Minimum ${b.min}.`));
    if (quantity > b.max) conflicts.push(constraint(`model:${b.modelId}:max`, `Maximum ${b.max}.`));
  }
  const spend = catalog.reduce((n, d, i) => n + d.unitCostMinor * vector[i], 0);
  if (spend > p.budgetMinor) conflicts.push(constraint('budget', `Spend ${spend} exceeds ${p.budgetMinor} ${p.currency} minor units.`));
  return conflicts;
}

function evaluate(input, vector, effort) {
  const quantities = input.catalog.map((d, i) => ({ derivativeId: d.derivativeId, modelId: d.modelId, quantity: vector[i] }));
  const conflicts = hardConstraints(input, vector);
  if (conflicts.length) return { status: 'infeasible', quantities, conflicts };
  const lots = lotsFor(input, vector);
  const allocations = allocate(input, lots, effort);
  const spendMinor = input.catalog.reduce((n, d, i) => n + d.unitCostMinor * vector[i], 0);
  const totalSupply = lots.reduce((n, s) => n + s.quantity, 0);
  const unused = totalSupply - allocations.length;
  const w = input.constraints.objectiveWeights;
  const terms = { coverage: allocations.length * w.coverage, unallocatedStock: 0 - unused * w.unallocatedStock, cost: 0 - spendMinor * w.costMinor };
  return { status: 'feasible', quantities,
    modelQuantities: input.constraints.modelBounds.map((b) => ({ modelId: b.modelId,
      quantity: quantities.filter((d) => d.modelId === b.modelId).reduce((n, d) => n + d.quantity, 0) })),
    allocations, expectedAcceptableCoverage: { covered: allocations.length, total: input.forecast.entitlements.length,
      fraction: input.forecast.entitlements.length ? allocations.length / input.forecast.entitlements.length : null,
      basis: 'deterministic-acceptable-matching-before-renewal' },
    unallocatedStockRisk: { quantity: unused, totalSupply, basis: 'unmatched-supply-within-horizon', bySource: lots.map((s) => ({ sourceId: s.id,
      quantity: s.quantity - allocations.filter((a) => a.sourceId === s.id).length })).filter((s) => s.quantity > 0) },
    spendMinor, currency: input.constraints.currency, orderQuantity: vector.reduce((n, q) => n + q, 0),
    objective: { value: terms.coverage + terms.unallocatedStock + terms.cost, weights: structuredClone(w), terms,
      tradeOff: 'Maximise weighted acceptable coverage, less unmatched supply and order cost; budget and quantity bounds remain hard.' } };
}

const rank = (a, b) => b.objective.value - a.objective.value || a.spendMinor - b.spendMinor || a.orderQuantity - b.orderQuantity
  || compare(a.quantities.map((d) => d.quantity).join(','), b.quantities.map((d) => d.quantity).join(','));

function bindings(input, plan) {
  const result = [];
  if (plan.spendMinor === input.constraints.budgetMinor) result.push(constraint('budget', 'Order spend meets the budget.'));
  for (const d of plan.quantities) {
    const b = input.constraints.derivativeBounds.find((r) => r.derivativeId === d.derivativeId);
    for (const edge of ['min', 'max']) if (d.quantity === b[edge]) result.push(constraint(`derivative:${d.derivativeId}:${edge}`, `Quantity meets ${edge}imum ${b[edge]}.`));
    const catalog = input.catalog.find((r) => r.derivativeId === d.derivativeId);
    if (Date.parse(input.asOf) + catalog.leadTimeDays * day > Date.parse(input.forecast.horizonEnd)) result.push(constraint(`lead-time:${d.derivativeId}`, 'No new quantity reaches this horizon.'));
  }
  for (const m of plan.modelQuantities) {
    const b = input.constraints.modelBounds.find((r) => r.modelId === m.modelId);
    for (const edge of ['min', 'max']) if (m.quantity === b[edge]) result.push(constraint(`model:${m.modelId}:${edge}`, `Quantity meets ${edge}imum ${b[edge]}.`));
  }
  return result;
}

function explain(input, plan) {
  if (plan.status !== 'feasible') return plan;
  const bindingConstraints = bindings(input, plan);
  const lots = lotsFor(input, plan.quantities.map((d) => d.quantity));
  const vector = plan.quantities.map((d) => d.quantity);
  const unmetNeeds = input.forecast.entitlements.filter((e) => !plan.allocations.some((a) => a.entitlementId === e.entitlementId)).map((e) => {
    const acceptable = lots.filter((s) => e.acceptableDerivativeIds.includes(s.derivativeId));
    const timely = acceptable.filter((s) => Date.parse(s.availableAt) <= Date.parse(deadlineFor(e)));
    const visible = timely.filter((s) => s.permittedEntitlementIds == null || s.permittedEntitlementIds.includes(e.entitlementId));
    const heldPermitted = visible.filter((s) => s.heldForEntitlementId === null || s.heldForEntitlementId === e.entitlementId);
    const accessible = heldPermitted.filter((s) => !(s.source === 'stock' && e.excludedStockIds?.includes(s.stockId)));
    const gates = [...e.gates];
    if (Date.parse(deadlineFor(e)) < Date.parse(input.asOf)) gates.push(deadlineFor(e) === e.renewalAt ? 'renewal-already-passed' : 'required-by-already-passed');
    if (!e.acceptableDerivativeIds.length) gates.push('no-permitted-acceptable-choice');
    else if (timely.length && !visible.length) gates.push('stock-not-visible');
    else if (visible.length && !heldPermitted.length) gates.push('held-for-another-entitlement');
    else if (heldPermitted.length && !accessible.length) gates.push('declined-unchanged');
    else if (acceptable.length && !timely.length) gates.push(deadlineFor(e) === e.renewalAt ? 'arrival-after-renewal' : 'arrival-after-required-by');
    const blockedOrders = []; let additionalOrderFeasible = false;
    for (const [i, d] of input.catalog.entries()) {
      if (!e.acceptableDerivativeIds.includes(d.derivativeId)) continue;
      if (Date.parse(input.asOf) + d.leadTimeDays * day > Date.parse(deadlineFor(e))) {
        blockedOrders.push(`${deadlineFor(e) === e.renewalAt ? 'lead-time-before-renewal' : 'lead-time-before-required-by'}:${d.derivativeId}`); continue;
      }
      const next = [...vector]; next[i] += 1;
      const obstacles = hardConstraints(input, next);
      if (!obstacles.length) additionalOrderFeasible = true;
      for (const obstacle of obstacles) {
        blockedOrders.push(obstacle.id);
        if (!bindingConstraints.some((b) => b.id === obstacle.id)) bindingConstraints.push({ ...obstacle,
          detail: `An additional acceptable vehicle is blocked: ${obstacle.detail}` });
      }
    }
    if (e.acceptableDerivativeIds.length) gates.push(additionalOrderFeasible ? 'objective-tradeoff' : 'acceptable-supply-scarcity');
    return { entitlementId: e.entitlementId, renewalAt: e.renewalAt, gates: [...new Set(gates)].sort(compare),
      constraintIds: [...new Set(blockedOrders)].sort(compare) };
  });
  return { ...plan, bindingConstraints, unmetNeeds };
}

function draftVector(input) {
  const rows = input.currentDraft?.quantities;
  if (!Array.isArray(rows) || rows.some((r) => !r || !integer(r.quantity) || !input.catalog.some((d) => d.derivativeId === r.derivativeId))
    || new Set(rows.map((r) => r.derivativeId)).size !== rows.length) return null;
  return input.catalog.map((d) => rows.find((r) => r.derivativeId === d.derivativeId)?.quantity ?? 0);
}

export function planOrder(raw) {
  const resolved = resolveInput(raw);
  if (resolved.reasons) return { status: 'invalid', code: 'invalid-order-plan-input', reasons: resolved.reasons, contractVersion: CONTRACT_VERSION };
  const input = resolved.value;
  const base = { contractVersion: CONTRACT_VERSION, planId: `order-plan-${inputDigest(input)}`, runId: input.runId, asOf: input.asOf,
    versions: input.versions, limitations: [...input.forecast.limitations,
      'Acceptable matching is deterministic feasibility, not calibrated acceptance or employee selection.'],
    solver: { method: 'bounded-exhaustive-integer-search-with-capacity-matching', limits: SOLVER_LIMITS } };
  const unsupported = (limits) => ({ ...base, status: 'unsupported', code: 'solver-limit', limits, quantities: [], solver: { ...base.solver, complete: false } });
  const dimensions = [['derivatives', input.catalog.length], ['entitlements', input.forecast.entitlements.length], ['supplyLots', input.stock.length + input.inbound.length + input.catalog.length]];
  const exceeded = dimensions.filter(([k, n]) => n > SOLVER_LIMITS[k]).map(([k, n]) => limit(k, n, SOLVER_LIMITS[k]));
  if (exceeded.length) return unsupported(exceeded);
  const ranges = input.catalog.map((d) => input.constraints.derivativeBounds.find((b) => b.derivativeId === d.derivativeId));
  const preliminary = ranges.flatMap((b) => b.min > b.max ? [constraint(`derivative:${b.derivativeId}:min`, `Minimum ${b.min} exceeds maximum ${b.max}.`), constraint(`derivative:${b.derivativeId}:max`, 'Conflicts with minimum.')] : []);
  for (const b of input.constraints.modelBounds) if (b.min > b.max) preliminary.push(constraint(`model:${b.modelId}:min`, 'Minimum exceeds maximum.'), constraint(`model:${b.modelId}:max`, 'Conflicts with minimum.'));
  const infeasible = (conflicts, visited = 0) => ({ ...base, status: 'infeasible', quantities: [], conflicts,
    conflictAnalysis: 'explanatory-non-minimal-constraint-set', alternatives: [], solver: { ...base.solver, complete: true, visited } });
  if (preliminary.length) return infeasible(preliminary);
  const combinations = ranges.reduce((n, b) => n * (b.max - b.min + 1), 1);
  if (combinations > SOLVER_LIMITS.candidatePlans) return unsupported([limit('candidatePlans', combinations, SOLVER_LIMITS.candidatePlans)]);
  const effort = { steps: 0 }; let visited = 0; let feasibleCount = 0;
  const top = []; const conflicts = new Map(); const vector = [];
  try {
    const visit = (at) => {
      if (at < ranges.length) {
        for (let q = ranges[at].min; q <= ranges[at].max; q += 1) { vector[at] = q; visit(at + 1); }
        return;
      }
      visited += 1;
      const candidate = evaluate(input, vector, effort);
      if (candidate.status !== 'feasible') { candidate.conflicts.forEach((c) => conflicts.set(c.id, c)); return; }
      feasibleCount += 1;
      top.push(candidate); top.sort(rank); if (top.length > 2) top.pop();
    };
    visit(0);
    if (!top.length) return infeasible([...conflicts.values()].sort((a, b) => compare(a.id, b.id)), visited);
    const best = explain(input, top[0]);
    const baseline = explain(input, evaluate(input, input.catalog.map(() => 0), effort));
    const alternatives = [{ kind: 'zero-new-orders-baseline', ...baseline,
      identicalToRecommendation: best.quantities.every((d) => d.quantity === 0) }];
    if (top[1]) alternatives.push({ kind: 'next-best-distinct-feasible', ...explain(input, top[1]) });
    let currentDraftComparison = null;
    if (Object.hasOwn(input, 'currentDraft')) {
      const draft = draftVector(input);
      if (!draft) return { ...base, status: 'invalid', code: 'invalid-current-draft', quantities: [], reasons: [{ field: 'currentDraft', reason: 'Supply unique known derivatives and nonnegative integer quantities.' }] };
      const result = explain(input, evaluate(input, draft, effort));
      currentDraftComparison = { ...result, coverageDelta: result.status === 'feasible' ? best.expectedAcceptableCoverage.covered - result.expectedAcceptableCoverage.covered : null,
        spendDeltaMinor: result.status === 'feasible' ? best.spendMinor - result.spendMinor : null };
    }
    return { ...base, ...best, alternatives, currentDraftComparison,
      solver: { ...base.solver, complete: true, optimalWithinDeclaredModel: true, visited, feasibleCount, matchingSteps: effort.steps } };
  } catch (error) {
    if (!(error instanceof RangeError && error.message === 'matching-effort')) throw error;
    return unsupported([limit('matchingSteps', effort.steps, SOLVER_LIMITS.matchingSteps)]);
  }
}
