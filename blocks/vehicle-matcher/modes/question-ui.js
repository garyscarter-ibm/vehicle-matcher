// Shared native question controls. Legacy answers mutate locally; explicit values belong to the caller.
import { SHOW_IF } from '../quiz-meta.js';
import { el, gbp } from '../ui.js';

/** The optional caller predicate owns visibility; otherwise retain the retail SHOW_IF contract. */
export function isVisible(q, answers, { predicate } = {}) {
  if (predicate) return Boolean(predicate(q, answers));
  if (!q.conditional) return true;
  return SHOW_IF[q.id] ? SHOW_IF[q.id](answers) : true;
}

export function visibleQuestions(questions, answers, options) {
  return questions.filter((q) => isVisible(q, answers, options));
}

/** Typed descriptors are explicit; legacy unit suffixes, GBP and plusAtMax stay compatible. */
export function formatSliderValue(value, q, { unit = q.unit, valueState = 'confirmed' } = {}) {
  if (!Number.isFinite(value) || valueState === 'unknown') return 'Not supplied';
  let base;
  if (unit && typeof unit === 'object') {
    if (q.format === 'gbp' && unit.kind !== 'purchase-money') return 'Unit not supplied';
    if (unit.kind === 'purchase-money' && unit.currency === 'GBP') base = gbp(value);
    else if (unit.kind === 'points-monthly') base = `${value.toLocaleString('en-GB')} points a month`;
    else if (unit.kind === 'percent') base = `${value.toLocaleString('en-GB')}%`;
    else return 'Unit not supplied';
  } else base = q.format === 'gbp' ? gbp(value) : `${value.toLocaleString('en-GB')}${unit || ''}`;
  const shown = q.plusAtMax && value >= q.max ? `${base}+` : base;
  return valueState === 'unconfirmed' ? `Not confirmed (${shown})` : shown;
}

export function formatRange([lo, hi], q, options) {
  return `${formatSliderValue(lo, q, options)} – ${formatSliderValue(hi, q, options)}`;
}

const callbackOwned = (options) => Object.hasOwn(options, 'value') || typeof options.onValueChange === 'function';

/** Dual native range by default; single:true supports independent preference and importance axes. */
export function renderRangeSlider(list, q, answers, options = {}) {
  const { onChange, onValueChange, single = false, disabled = false, ariaLabel } = options;
  const controlled = callbackOwned(options);
  const stored = controlled ? options.value : answers[q.id];
  const notify = (value) => {
    if (controlled) onValueChange?.(value);
    else { answers[q.id] = value; onChange?.(); }
  };
  const bounds = el('div', 'vm-slider-bounds');
  const boundFormat = { ...options, valueState: 'confirmed' };
  bounds.append(el('span', 'vm-slider-min', formatSliderValue(q.min, q, boundFormat)),
    el('span', 'vm-slider-max', formatSliderValue(q.max, q, boundFormat)));
  if (single) {
    const known = Number.isFinite(stored) && options.valueState !== 'unknown';
    const start = known ? stored : Number.isFinite(q.default) ? q.default : q.min;
    if (!controlled) answers[q.id] = start;
    const readout = el('output', 'vm-slider-value', formatSliderValue(known || !controlled ? start : null, q, options));
    const input = el('input', 'vm-slider-input vm-slider-single');
    input.type = 'range';
    input.min = String(q.min); input.max = String(q.max); input.step = String(q.step);
    input.value = String(start); input.disabled = disabled;
    input.setAttribute('aria-label', ariaLabel || q.label || q.id);
    input.setAttribute('aria-valuetext', readout.textContent);
    input.addEventListener('input', () => {
      if (input.disabled) return;
      const value = Number(input.value);
      const text = formatSliderValue(value, q, { ...options, valueState: 'confirmed' });
      readout.textContent = text;
      input.setAttribute('aria-valuetext', text);
      notify(value);
    });
    list.append(readout, input, bounds);
    return;
  }
  const start = Array.isArray(stored) && stored.length === 2
    ? [Number(stored[0]), Number(stored[1])]
    : (Array.isArray(q.default) ? [...q.default] : [q.min, q.max]);
  let [lo, hi] = [Math.min(...start), Math.max(...start)];
  // Legacy defaults commit on mount; callbacks only fire on later input.
  if (!controlled) answers[q.id] = [lo, hi];
  let confirmed = !controlled || (Array.isArray(stored) && stored.every(Number.isFinite) && options.valueState !== 'unknown');
  const readout = el('output', 'vm-slider-value', confirmed ? formatRange([lo, hi], q, options) : 'Not supplied');
  const noun = ariaLabel || q.thumbNoun || 'budget';
  const track = el('div', 'vm-range');
  const fill = el('div', 'vm-range-fill');
  const mkInput = (cls, label, value) => {
    const input = el('input', `vm-slider-input ${cls}`);
    input.type = 'range'; input.min = String(q.min); input.max = String(q.max); input.step = String(q.step);
    input.value = String(value); input.disabled = disabled;
    input.setAttribute('aria-label', label);
    input.setAttribute('aria-valuetext', confirmed ? formatSliderValue(value, q, options) : 'Not supplied');
    return input;
  };
  const minInput = mkInput('vm-range-min', `Minimum ${noun}`, lo);
  const maxInput = mkInput('vm-range-max', `Maximum ${noun}`, hi);
  const span = q.max - q.min || 1;
  const paintFill = () => {
    fill.style.left = `${((lo - q.min) / span) * 100}%`;
    fill.style.right = `${100 - ((hi - q.min) / span) * 100}%`;
  };
  const sync = () => {
    if (disabled) return;
    lo = Math.min(Number(minInput.value), hi - q.step);
    hi = Math.max(Number(maxInput.value), lo + q.step);
    lo = Math.max(q.min, lo);
    hi = Math.min(q.max, hi);
    minInput.value = String(lo); maxInput.value = String(hi);
    confirmed = true;
    const format = { ...options, valueState: 'confirmed' };
    readout.textContent = formatRange([lo, hi], q, format);
    minInput.setAttribute('aria-valuetext', formatSliderValue(lo, q, format));
    maxInput.setAttribute('aria-valuetext', formatSliderValue(hi, q, format));
    paintFill();
    notify([lo, hi]);
  };
  minInput.addEventListener('input', sync); maxInput.addEventListener('input', sync);
  paintFill();
  track.append(fill, minInput, maxInput);
  list.append(readout, track, bounds);
}

/** Native option buttons return the live selected Set; onPick follows the committed single selection. */
export function renderOptionList(q, answers, options = {}) {
  const { onChange, onPick, onValueChange, disabled = false, ariaLabel } = options;
  const controlled = callbackOwned(options);
  const stored = controlled ? options.value : answers[q.id];
  const selected = new Set(q.multi ? (stored || []) : (stored != null ? [stored] : []));
  const list = el('div', 'vm-options');
  list.setAttribute('role', q.multi ? 'group' : 'radiogroup');
  if (ariaLabel || q.label) list.setAttribute('aria-label', ariaLabel || q.label);
  const optionButtons = [];
  const notify = (next) => {
    if (controlled) onValueChange?.(next);
    else { answers[q.id] = next; onChange?.(); }
  };
  q.options.forEach((opt) => {
    const btn = el('button', 'vm-option');
    btn.type = 'button'; btn.disabled = disabled || Boolean(opt.disabled);
    btn.setAttribute('role', q.multi ? 'checkbox' : 'radio');
    btn.setAttribute('aria-checked', String(selected.has(opt.value)));
    if (selected.has(opt.value)) btn.classList.add('is-selected');
    if (opt.swatch) {
      const dot = el('span', 'vm-swatch'); dot.style.background = opt.swatch; btn.append(dot);
    }
    btn.append(el('span', 'vm-option-label', opt.label));
    if (opt.sub) btn.append(el('span', 'vm-option-sub', opt.sub));
    btn.addEventListener('click', () => {
      if (btn.disabled) return;
      if (q.multi) {
        if (selected.has(opt.value)) selected.delete(opt.value);
        else {
          if (opt.value === 'any') selected.clear();
          else selected.delete('any');
          if (q.max && selected.size >= q.max) return;
          selected.add(opt.value);
        }
      } else { selected.clear(); selected.add(opt.value); }
      const next = q.multi ? [...selected] : opt.value;
      optionButtons.forEach(({ button, value }) => {
        button.classList.toggle('is-selected', selected.has(value));
        button.setAttribute('aria-checked', String(selected.has(value)));
      });
      notify(next);
      if (!q.multi) onPick?.();
    });
    optionButtons.push({ button: btn, value: opt.value });
    list.append(btn);
  });
  return { list, selected };
}
