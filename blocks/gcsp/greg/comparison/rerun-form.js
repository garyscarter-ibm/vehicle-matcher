// The hold-duration rerun form: shape checks before any request, then the server's reasons on the fields. The server owns range, count and today's value.
import { el, button } from '../../../vehicle-matcher/ui.js';
import { labelledField, errorSummary } from '../../kit/form-controls.js';
import { formatHold } from './comparison-copy.js';
import * as words from './experiment-copy.js';

let sequence = 0;
const SECONDS_PER_HOUR = 3600;
const toHours = (seconds) => String(Math.round((seconds / SECONDS_PER_HOUR) * 1e6) / 1e6);

/** Comma separated hours -> { seconds } or { error }. Whole positive seconds, no repeats. */
export function parseHolds(input) {
  const pieces = String(input ?? '').split(',').map((p) => p.trim()).filter(Boolean);
  if (!pieces.length) return { error: words.ERR_NONE };
  const seconds = [];
  for (const piece of pieces) {
    const exact = Number(piece) * SECONDS_PER_HOUR;
    if (!/^(\d+\.?\d*|\.\d+)$/.test(piece) || !(exact > 0) || !Number.isSafeInteger(Math.round(exact))) return { error: words.errNumber(piece) };
    if (Math.abs(exact - Math.round(exact)) > 1e-6) return { error: words.errWhole(piece) };
    seconds.push(Math.round(exact));
  }
  return new Set(seconds).size === seconds.length ? { seconds } : { error: words.ERR_DUPLICATE };
}

/** { hours, basis } as typed -> { values, basis, errors: [{ field: 'hours' | 'basis', message }] }. */
export function checkRerun({ hours, basis }) {
  const errors = []; const parsed = parseHolds(hours); const why = String(basis ?? '').trim();
  if (parsed.error) errors.push({ field: 'hours', message: parsed.error });
  if (!why) errors.push({ field: 'basis', message: words.ERR_BASIS_NONE });
  else if (why.length > words.BASIS_MAX) errors.push({ field: 'basis', message: words.ERR_BASIS_LONG });
  return { values: parsed.seconds ?? [], basis: why, errors };
}

const SERVER_FIELDS = { 'change.values': 'hours', 'change.basis': 'basis' };

/** createRerunForm({ run }) -> { root, setSource(holdView | null), setActive(bool) }. run({ experimentId, change }) answers an adapter state; started and conflict are the caller's. */
export function createRerunForm({ run }) {
  const id = `gcsp-comparison-form-${++sequence}`;
  const form = el('form', 'gcsp-comparison-form'); form.noValidate = true; form.setAttribute('aria-labelledby', `${id}-title`);
  const title = el('h3', 'gcsp-comparison-h3', words.FORM_TITLE); title.id = `${id}-title`;
  const hoursInput = el('input'); hoursInput.type = 'text';
  for (const [name, value] of [['inputmode', 'decimal'], ['autocomplete', 'off'], ['spellcheck', 'false']]) hoursInput.setAttribute(name, value);
  const basisInput = el('textarea'); basisInput.rows = 3; basisInput.maxLength = words.BASIS_MAX;
  const hours = labelledField({ id: `${id}-hours`, label: words.HOURS_LABEL, control: hoursInput, hint: words.boundsHint(null, formatHold) });
  const basis = labelledField({ id: `${id}-basis`, label: words.BASIS_LABEL, control: basisInput });
  const summary = errorSummary({ id: `${id}-errors`, title: words.SUMMARY_TITLE });
  const problem = el('p', 'gcsp-field-error'); problem.setAttribute('role', 'alert'); problem.hidden = true;
  const reason = el('p', 'gcsp-note'); reason.id = `${id}-reason`; reason.hidden = true;
  const submit = button({ label: words.RUN_LABEL, describedBy: reason.id }); submit.type = 'submit';
  const actions = el('div', 'gcsp-comparison-actions'); actions.append(submit, reason);
  form.append(title, summary.root, hours.root, basis.root, problem, actions);
  let draft = null; let starting = false; let active = false;

  function sync() {
    const why = active ? words.RUNNING_REASON : starting ? words.STARTING : '';
    submit.disabled = Boolean(why); reason.textContent = why; reason.hidden = !why;
  }
  function show(items) {
    hours.setError(''); basis.setError(''); problem.hidden = true;
    const rows = [];
    for (const { field, message, label } of items) {
      const target = field === 'hours' ? hours : field === 'basis' ? basis : null;
      target?.setError(message);
      rows.push({ id: field === 'basis' ? basisInput.id : hoursInput.id, message: label ? `${label}: ${message}` : message });
    }
    summary.update(rows); summary.focus();
  }
  const labelOf = { hours: words.HOURS_LABEL, basis: words.BASIS_LABEL };
  const fromServer = (reasons) => (reasons.length ? reasons : [{ field: null, reason: words.INVALID_FALLBACK }])
    .map((r) => { const field = SERVER_FIELDS[r.field] ?? null; return { field, message: r.reason, label: field ? labelOf[field] : '' }; });

  for (const [input, field] of [[hoursInput, hours], [basisInput, basis]]) {
    input.addEventListener('input', () => { draft = { hours: hoursInput.value, basis: basisInput.value }; field.setError(''); });
  }
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (submit.disabled) return;
    summary.update([]); problem.hidden = true;
    const check = checkRerun({ hours: hoursInput.value, basis: basisInput.value });
    if (check.errors.length) { show(check.errors.map((e) => ({ ...e, label: labelOf[e.field] }))); return; }
    draft = { hours: hoursInput.value, basis: basisInput.value }; hours.setError(''); basis.setError('');
    starting = true; sync();
    const reply = await run({ experimentId: 'hold-sweep', change: { values: check.values, basis: check.basis } });
    starting = false; sync();
    if (!reply) return;
    if (reply.status === 'invalid') show(fromServer(reply.reasons));
    else if (reply.status === 'refused') { problem.textContent = words.REFUSED_START; problem.hidden = false; }
    else if (reply.status === 'unavailable') { problem.textContent = reply.reason || words.START_UNAVAILABLE; problem.hidden = false; }
  });
  sync();
  return {
    root: form,
    setActive(value) { active = Boolean(value); sync(); },
    setSource(view) {
      hours.root.querySelector('.gcsp-field-hint').textContent = words.boundsHint(view?.bounds ?? null, formatHold);
      if (draft) return;
      hoursInput.value = view ? view.change.values.map(toHours).join(', ') : ''; basisInput.value = view?.change.basis ?? '';
    },
  };
}
