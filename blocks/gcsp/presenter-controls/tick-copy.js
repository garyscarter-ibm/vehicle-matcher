// Plain-language wording for the last tick. Ids and raw JSON never reach the screen.
const STATE = { completed: 'Tick completed', pending: 'Tick still running' };
const STEP = { 'stock-release': 'Stock release', 'manual-claim-expiry': 'Manual claim expiry', 'buddy-expiry': 'Buddy expiry',
  'buddy-pending-operations': 'Buddy pending operations', 'lifecycle-appointments': 'Appointments', 'lifecycle-approvals': 'Approvals',
  'lifecycle-documents': 'Documents', 'lifecycle-return-appointments': 'Return appointments', 'renewal-risk-cases': 'Renewal risk cases',
  'selection-order-reconciliation': 'Selection order reconciliation', 'captured-outbox': 'Outbox dispatch',
  'buddy-allocation': 'Buddy allocation' };
const STAGE = { 'release-pull': 'Stock release', 'manual-expiry': 'Manual claim expiry', 'buddy-expiry': 'Buddy expiry',
  'buddy-allocation': 'Buddy allocation', 'pending-reconciliation': 'Reconciliation', 'outbox-dispatch': 'Outbox dispatch' };
const RESULT = { ok: 'Done', forbidden: 'Refused', refused: 'Refused', unavailable: 'Unavailable', conflict: 'Conflict', pending: 'Waiting for a result' };
const NONE = 'Waiting for a result'; const OTHER = 'Not confirmed';
const SUMMARY_ORDER = ['Done', 'Refused', 'Unavailable', 'Conflict', NONE, OTHER];
const SUMMARY_WORD = { Done: 'done', Refused: 'refused', Unavailable: 'unavailable', Conflict: 'in conflict', [NONE]: 'waiting for a result', [OTHER]: 'not confirmed' };
const own = (map, key) => typeof key === 'string' && Object.hasOwn(map, key) ? map[key] : undefined;
const text = (value) => typeof value === 'string' && value.trim().length > 0;

// `row` is the reported outcome row ({ handlerId, outcome }), or undefined when none was reported.
const resultWord = (row) => (row ? own(RESULT, row.outcome?.status) ?? OTHER : NONE);
export const findOutcome = (tick, descriptor) => (Array.isArray(tick?.outcomes) ? tick.outcomes : []).find((row) => row?.handlerId === descriptor.handlerId);
const descriptors = (tick) => (Array.isArray(tick?.handlerOrder) ? tick.handlerOrder : []).filter((row) => row && typeof row === 'object');

// FUCQ-240: buddy allocation reports how many employees it left out for want of a renewal date; shown from the supplied count only.
function leftOut(descriptor, row) {
  const found = descriptor?.handlerId === 'buddy-allocation' && Array.isArray(row?.outcome?.value?.limitations)
    ? row.outcome.value.limitations.find((limit) => limit?.code === 'renewal-deadline-unknown') : null;
  const n = found?.employees;
  if (!Number.isSafeInteger(n) || n < 1) return '';
  return ` ${n === 1 ? '1 employee is' : `${n} employees are`} left out: no renewal date to set their place in the queue.`;
}

export function stepLine(descriptor, row) {
  const said = [row?.outcome?.reason, row?.outcome?.message].find(text)?.trim();
  return `${own(STEP, descriptor?.handlerId) ?? 'Another step'}: ${resultWord(row)}.${said ? ` ${said}` : ''}${leftOut(descriptor, row)}`;
}

export function tickSummary(tick) {
  const head = own(STATE, tick?.state) ?? 'Tick result not confirmed';
  const rows = descriptors(tick);
  if (!rows.length) return `${head}. No steps reported.`;
  const counts = new Map();
  for (const row of rows) { const word = resultWord(findOutcome(tick, row)); counts.set(word, (counts.get(word) || 0) + 1); }
  const parts = SUMMARY_ORDER.filter((word) => counts.has(word)).map((word) => `${counts.get(word)} ${SUMMARY_WORD[word]}`);
  return `${head}. ${rows.length} ${rows.length === 1 ? 'step' : 'steps'}: ${parts.join(', ')}.`;
}

export function missingStagesLine(stages) {
  if (!Array.isArray(stages) || !stages.length) return null;
  const named = [...new Set(stages.map((id) => own(STAGE, id)).filter(Boolean))];
  const other = stages.filter((id) => own(STAGE, id) === undefined).length;
  const parts = [...named, ...(other ? [other === 1 ? 'another stage' : `${other} other stages`] : [])];
  return `Not run this tick: ${parts.join(', ')}.`;
}
