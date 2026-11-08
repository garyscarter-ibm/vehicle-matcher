import { ok, result } from '../repository/core.js';
import { freezeVehicleData } from '../../vehicles/index.js';

// FUCQ-209: each employee's evaluation and quotes are their own row, so no receipt grows with cohort x pool.
export const ALLOCATION_EVALUATION_CONSUMER = 'buddy-allocation-evaluation';
export const allocationEvaluationEventId = (eventId, employeeId) => `${eventId}:${employeeId}`;
const invalid = (code) => result('invalid', { code });

// FUCQ-217: cars with an identical decision body share one stored variant; readers get full decisions back.
export function packEvaluation({ decisions, ...rest }) {
  const variants = []; const index = new Map();
  const cars = decisions.map(({ orderUuid, ...body }) => {
    const key = JSON.stringify(body);
    if (!index.has(key)) { index.set(key, variants.length); variants.push(body); }
    return [orderUuid, index.get(key)];
  });
  return { ...rest, variants, cars };
}
export function expandEvaluation(evaluation) {
  if (!Array.isArray(evaluation?.cars) || !Array.isArray(evaluation.variants)) return evaluation;
  const { variants, cars, ...rest } = evaluation; variants.forEach(freezeVehicleData);
  return { ...rest, decisions: cars.map(([orderUuid, variant]) => ({ orderUuid, ...variants[variant] })) };
}

/** This employee's slice of a completed allocation receipt: inline before FUCQ-209, its own row after; null if not evaluated. */
export async function readAllocationEvaluation(repository, context, receipt) {
  const value = receipt?.outcome?.value;
  if (Array.isArray(value?.evaluations)) {
    const mine = value.evaluations.filter((row) => row?.employeeId === context.employeeId);
    return mine.length > 1 ? invalid('allocation-evaluation-duplicate') : ok(mine[0] ?? null);
  }
  const refs = value?.evaluationRefs;
  if (refs?.consumerId !== ALLOCATION_EVALUATION_CONSUMER || !Array.isArray(refs.employeeIds)) return invalid('allocation-evaluation-refs-invalid');
  if (!refs.employeeIds.includes(context.employeeId)) return ok(null);
  const row = await repository.read(context, { table: 'event_receipts', key: { runId: context.runId,
    consumerId: ALLOCATION_EVALUATION_CONSUMER, eventId: allocationEvaluationEventId(receipt.eventId, context.employeeId) } });
  if (row.status !== 'ok') return row;
  const evaluation = row.value.outcome?.value?.evaluation;
  return evaluation?.employeeId === context.employeeId ? ok(expandEvaluation(evaluation)) : invalid('allocation-evaluation-row-invalid');
}
