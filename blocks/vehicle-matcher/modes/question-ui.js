/*
 * The question widgets, shared by every mode that asks the buyer something.
 *
 * Lifted out of modes/questionnaire.js when a second mode (podium) needed to ask
 * the same questions inside a different frame. They could not simply be called
 * from there: each widget reached into the questionnaire's own `ctx` to write
 * the answer, and the slider called that mode's debounced preview refresh BY
 * NAME, so reusing a slider meant importing the questionnaire's whole preview
 * strip with it.
 *
 * So the coupling is inverted. A widget is handed the answers object it writes
 * into and a callback to fire once it has written, and knows nothing else about
 * the screen it is mounted in — which is what lets one mode refresh a strip on
 * every commit while another does nothing at all.
 *
 * What a question IS still lives behind the API and in ../quiz-meta.js; this is
 * only how one is drawn.
 */

import { SHOW_IF } from '../quiz-meta.js';
import { el, gbp } from '../ui.js';

/** Is question `q` shown given the current answers? Uses SHOW_IF by id. */
export function isVisible(q, answers) {
  if (!q.conditional) return true;
  const predicate = SHOW_IF[q.id];
  return predicate ? predicate(answers) : true;
}

export function visibleQuestions(questions, answers) {
  return questions.filter((q) => isVisible(q, answers));
}

/**
 * Format a slider value for its readout, per the question's `format` hint:
 *   'gbp' → "£62,000", 'int' → "12,000" (with an optional `unit` suffix).
 * At the ceiling of a `plusAtMax` slider, append "+" ("£150,000+", "25,000+").
 */
export function formatSliderValue(value, q) {
  const base = q.format === 'gbp' ? gbp(value) : `${value.toLocaleString('en-GB')}${q.unit || ''}`;
  return q.plusAtMax && value >= q.max ? `${base}+` : base;
}

/** Readout for a dual-thumb range slider, e.g. "£40,000 – £75,000". */
export function formatRange([lo, hi], q) {
  return `${formatSliderValue(lo, q)} – ${formatSliderValue(hi, q)}`;
}

/**
 * A dual-thumb range slider (budget): two native range inputs overlaid on one
 * track, writing a [min, max] pair to answers[q.id]. The thumbs can't cross
 * (kept `minGap` or one step apart). Appends readout + track + bounds to `list`.
 *
 * `onChange` fires after every commit, including the one below that happens
 * before the user has touched anything: the starting value is persisted
 * immediately so the caller's Next button is enabled without a drag, and a mode
 * that previews its answers wants that first value as much as any later one.
 */
export function renderRangeSlider(list, q, answers, { onChange } = {}) {
  const stored = answers[q.id];
  const start = Array.isArray(stored) && stored.length === 2
    ? [Number(stored[0]), Number(stored[1])]
    : (Array.isArray(q.default) ? [...q.default] : [q.min, q.max]);
  let [lo, hi] = [Math.min(...start), Math.max(...start)];
  // Persist immediately so Next is enabled even without a drag.
  answers[q.id] = [lo, hi];

  const readout = el('output', 'vm-slider-value', formatRange([lo, hi], q));

  // What the two thumbs are called to a screen reader. "budget" is only right
  // for the question this was written for; `q.thumbNoun` lets a caller reusing
  // the same widget on another axis (the hard-filter mode's age range) name them
  // honestly. The budget question sets nothing and reads exactly as before.
  const noun = q.thumbNoun || 'budget';

  const track = el('div', 'vm-range');
  const fill = el('div', 'vm-range-fill');
  const mkInput = (cls, label, value) => {
    const input = el('input', `vm-slider-input ${cls}`);
    input.type = 'range';
    input.min = String(q.min);
    input.max = String(q.max);
    input.step = String(q.step);
    input.value = String(value);
    input.setAttribute('aria-label', label);
    input.setAttribute('aria-valuetext', formatSliderValue(value, q));
    return input;
  };
  const minInput = mkInput('vm-range-min', `Minimum ${noun}`, lo);
  const maxInput = mkInput('vm-range-max', `Maximum ${noun}`, hi);

  const span = q.max - q.min || 1;
  // Native thumbs travel thumb/2 in from each end, so the fill runs between their centres when a
  // brand sets --vm-thumb-half (RRMC); at 0 this is the plain percentage, as before.
  const at = (v) => `calc(var(--vm-thumb-half, 0px) + (100% - 2 * var(--vm-thumb-half, 0px)) * ${(v - q.min) / span})`;
  const paintFill = () => {
    fill.style.left = at(lo);
    fill.style.right = `calc(100% - ${at(hi)})`;
  };
  // The closest the two values may come: the question's `minGap` (RRMC's budget: £20k), else one
  // step. RRMC's handles sit either side of their values in CSS, so even that close they don't overlap.
  const gap = Math.max(q.step, Number(q.minGap) || 0);
  const sync = () => {
    // Clamp so the thumbs never cross.
    lo = Math.min(Number(minInput.value), hi - gap);
    hi = Math.max(Number(maxInput.value), lo + gap);
    lo = Math.max(q.min, lo);
    hi = Math.min(q.max, hi);
    minInput.value = String(lo);
    maxInput.value = String(hi);
    answers[q.id] = [lo, hi];
    const text = formatRange([lo, hi], q);
    readout.textContent = text;
    minInput.setAttribute('aria-valuetext', formatSliderValue(lo, q));
    maxInput.setAttribute('aria-valuetext', formatSliderValue(hi, q));
    paintFill();
    onChange?.();
  };
  minInput.addEventListener('input', sync);
  maxInput.addEventListener('input', sync);

  paintFill();
  track.append(fill, minInput, maxInput);

  const bounds = el('div', 'vm-slider-bounds');
  bounds.append(
    el('span', 'vm-slider-min', formatSliderValue(q.min, q)),
    el('span', 'vm-slider-max', formatSliderValue(q.max, q)),
  );

  list.append(readout, track, bounds);
}

// Matches the drawer's CSS roll (vehicle-matcher.css .vm-budget-drawer).
const DRAWER_MS = 450;

/**
 * RRMC's budget folded into "Is there an ideal price range?": Yes rolls the range slider down
 * beneath the options, anything else rolls it back up and drops the budget. Call `sync()`
 * after every change to the gate's answer; `onChange` fires on slider moves.
 */
export function renderBudgetDrawer(budgetQ, answers, { onChange } = {}) {
  const drawer = el('div', 'vm-budget-drawer');
  const inner = el('div', 'vm-budget-drawer-inner');
  drawer.append(inner);
  let clearing = 0;
  const sync = () => {
    const open = answers.budgetGate === 'yes';
    drawer.classList.toggle('is-open', open);
    inner.inert = !open;
    if (open) {
      clearTimeout(clearing);
      if (!inner.firstChild) {
        const box = el('div', 'vm-options vm-slider');
        renderRangeSlider(box, budgetQ, answers, { onChange });
        // The range in words, beneath the track; screen readers already hear it from the handles.
        const value = el('span', 'vm-budget-range-value');
        const range = el('div', 'vm-budget-range');
        range.setAttribute('aria-hidden', 'true');
        range.append(el('span', 'vm-budget-range-label', 'Current Range:'), value);
        const paint = () => {
          const [lo, hi] = answers[budgetQ.id] || [];
          value.textContent = `${formatSliderValue(lo, budgetQ)} - ${formatSliderValue(hi, budgetQ)}`;
        };
        paint();
        box.addEventListener('input', paint);
        inner.append(box, range);
      }
      return;
    }
    delete answers[budgetQ.id];
    // Emptied once the roll-up has played, so the slider doesn't vanish mid-animation.
    if (inner.firstChild) clearing = setTimeout(() => inner.replaceChildren(), DRAWER_MS);
  };
  sync();
  return { drawer, sync };
}

/**
 * The option buttons for a multi- or single-select question, as a role-carrying
 * `.vm-options` list the caller mounts wherever it likes.
 *
 * The live `selected` Set comes back with it, because the commit affordance is
 * the caller's: the questionnaire greys its own Next button while nothing is
 * picked, and a mode with no Next button needs neither the Set nor a callback
 * about it. Handing back the same Set the buttons mutate keeps the two in step
 * without this knowing what the caller does with it.
 *
 * `onChange` fires after ANY answer mutation. `onPick` fires only after a
 * single-select tap, and after `onChange`, because a mode that auto-advances on
 * a tap must still have committed the answer before it moves.
 *
 * @returns {{ list: HTMLElement, selected: Set }}
 */
export function renderOptionList(q, answers, { onChange, onPick } = {}) {
  const selected = new Set(
    q.multi ? (answers[q.id] || []) : (answers[q.id] != null ? [answers[q.id]] : []),
  );
  const list = el('div', 'vm-options');
  // A slider is a single labelled input (its own role), not a radio/checkbox
  // group — only an option list is a group.
  list.setAttribute('role', q.multi ? 'group' : 'radiogroup');
  const optionButtons = [];

  q.options.forEach((opt) => {
    const btn = el('button', 'vm-option');
    btn.type = 'button';
    btn.dataset.value = opt.value;
    btn.setAttribute('role', q.multi ? 'checkbox' : 'radio');
    btn.setAttribute('aria-checked', String(selected.has(opt.value)));
    if (selected.has(opt.value)) btn.classList.add('is-selected');
    // A colour dot, for the one axis where the option IS a colour. Same
    // .vm-swatch the cards use (SWATCH_HEX in ./result-card.js), so "the green
    // one" reads the same in the filter as it does on the card it filtered to.
    // Presentational only — the label still carries the name, so an option with
    // no hex simply has no dot.
    if (opt.swatch) {
      const dot = el('span', 'vm-swatch');
      dot.style.background = opt.swatch;
      btn.append(dot);
    }
    btn.append(el('span', 'vm-option-label', opt.label));
    if (opt.sub) btn.append(el('span', 'vm-option-sub', opt.sub));
    btn.addEventListener('click', () => {
      if (q.multi) {
        if (selected.has(opt.value)) selected.delete(opt.value);
        else {
          if (opt.value === 'any') selected.clear();
          else selected.delete('any');
          if (q.max && selected.size >= q.max) return;
          selected.add(opt.value);
        }
        answers[q.id] = [...selected];
        optionButtons.forEach(({ button, value }) => {
          button.classList.toggle('is-selected', selected.has(value));
          button.setAttribute('aria-checked', String(selected.has(value)));
        });
        onChange?.();
      } else {
        answers[q.id] = opt.value;
        // Reflect the pick in the UI. The questionnaire auto-advances on a
        // single-select tap so the un-highlighted button is never seen, but a
        // mode that keeps every question on screen (podium) needs the selected
        // state painted here. Single-select, so exactly one button is on.
        selected.clear();
        selected.add(opt.value);
        optionButtons.forEach(({ button, value }) => {
          button.classList.toggle('is-selected', value === opt.value);
          button.setAttribute('aria-checked', String(value === opt.value));
        });
        onChange?.();
        onPick?.();
      }
    });
    optionButtons.push({ button: btn, value: opt.value });
    list.append(btn);
  });

  return { list, selected };
}
