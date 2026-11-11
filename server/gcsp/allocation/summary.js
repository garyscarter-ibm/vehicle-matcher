import { ok } from '../repository/index.js';

// Clock receipts need counts, not the per-employee decisions or pinned claim quotes.
export const allocationCounts = (value) => ({ events: 1,
  offers: value.assignments?.length ?? 0,
  evaluated: value.evaluationRefs?.employeeIds?.length ?? value.evaluations?.length ?? 0 });

export const allocationLimitations = (value) => value.excluded?.length
  ? [{ code: 'renewal-deadline-unknown', employees: new Set(value.excluded.map((row) => row.employeeId)).size }] : undefined;

export function summarizeAllocation(outcome) {
  if (outcome?.status !== 'ok') return outcome;
  const limitations = allocationLimitations(outcome.value);
  return ok({ runId: outcome.value.runId, summary: allocationCounts(outcome.value), ...(limitations ? { limitations } : {}) });
}

// Project older handler/tick results too, without changing their durable replay evidence.
export function compactAllocationOutcome(handlerId, outcome) {
  if (handlerId !== 'buddy-allocation' || outcome?.status !== 'ok' || !Array.isArray(outcome.value?.allocations)) return outcome;
  const { allocations, ...value } = outcome.value;
  const summary = { events: 0, offers: 0, evaluated: 0 };
  for (const allocation of allocations) {
    const counts = allocationCounts(allocation);
    for (const key of Object.keys(summary)) summary[key] += counts[key];
  }
  return { ...outcome, value: { ...value, summary } };
}

export const compactAllocationOutcomes = (outcomes) => outcomes.map((row) => ({ ...row,
  outcome: compactAllocationOutcome(row.handlerId, row.outcome) }));
