import { result } from '../repository/core.js';
import { EXPERIMENT_IDS, EXPERIMENT_KEYS, PROCESS_EXPERIMENT_ID } from './experiments.js';

export const MAX_BASIS_LENGTH = 500;
const plain = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const reason = (field, key, text) => ({ field, key, reason: text });
const NOT_CHOSEN = 'The seeds and shared settings are not chosen here. The policy values are used.';

// Shape checks only: range, unit, count and "same as today" stay with the worker's check against PolicyService.
function checkChange(id, change, problems) {
  const key = EXPERIMENT_KEYS[id];
  const sweep = id === 'hold-sweep';
  const field = sweep ? 'values' : 'value';
  if (!plain(change)) {
    problems.push(reason('change', null, `Give a change with ${sweep ? 'a list of values' : 'a value'} and a basis.`));
    return null;
  }
  for (const name of Object.keys(change)) {
    if (name !== 'basis' && name !== field) problems.push(reason(`change.${name}`, null, 'This field is not recognised for this experiment.'));
  }
  const value = change[field];
  if (value === undefined) problems.push(reason(`change.${field}`, key, sweep ? 'Give the hold lengths to try.' : 'Give the value to try.'));
  else if (sweep) {
    if (!Array.isArray(value) || value.length === 0 || !value.every(Number.isSafeInteger)) {
      problems.push(reason('change.values', key, 'Give a list of whole numbers of seconds.'));
    } else if (new Set(value).size !== value.length) problems.push(reason('change.values', key, 'Each hold length must be different.'));
  } else if (id === 'points') {
    if (!Number.isFinite(value)) problems.push(reason('change.value', key, 'Give a number.'));
  } else if (!Array.isArray(value) || value.length === 0 || !value.every((row) => plain(row))) {
    problems.push(reason('change.value', key, 'Give a list of model lines with weights.'));
  }
  const basis = change.basis;
  if (typeof basis !== 'string' || basis.trim() === '') problems.push(reason('change.basis', null, 'Say why this change is worth trying.'));
  else if (basis.length > MAX_BASIS_LENGTH) problems.push(reason('change.basis', null, `Keep this to ${MAX_BASIS_LENGTH} characters or fewer.`));
  return value === undefined ? null : { [field]: structuredClone(value), basis };
}

/**
 * Checks the shape of a browser or CLI experiment request and collects every problem, one reason per field.
 * Returns { status: 'ok', value: { experimentId, change? } } or an invalid outcome with reasons [{ field, key, reason }].
 */
export function parseExperimentRequest(body) {
  const problems = [];
  if (!plain(body)) return result('invalid', { code: 'invalid-experiment', reasons: [reason('body', null, 'Send a JSON object.')] });
  for (const name of Object.keys(body)) {
    if (name === 'experimentId' || name === 'change') continue;
    problems.push(reason(name, null, name === 'seeds' || name === 'overlay' ? NOT_CHOSEN : 'This field is not recognised.'));
  }
  const id = body.experimentId;
  const known = typeof id === 'string' && EXPERIMENT_IDS.includes(id);
  if (!known) problems.push(reason('experimentId', null, 'Choose one of the known comparison experiments.'));
  let change;
  if (known && id === PROCESS_EXPERIMENT_ID) {
    if (body.change !== undefined) problems.push(reason('change', null, 'The process comparison takes no change.'));
  } else if (known) {
    change = body.change === undefined
      ? (problems.push(reason('change', null, 'Give the change to try.')), null) : checkChange(id, body.change, problems);
  }
  if (problems.length) return result('invalid', { code: 'invalid-experiment', reasons: problems });
  return result('ok', { value: { experimentId: id, ...(change && { change }) } });
}
