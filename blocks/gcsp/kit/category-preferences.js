import { el, button } from '../../vehicle-matcher/ui.js';
import { renderOptionList, renderRangeSlider } from '../../vehicle-matcher/modes/question-ui.js';
import { svgIcon } from '../shell/portal-shell.js';
import { checkboxField } from './form-controls.js';
import { helpTip } from './help-tip.js';
import { understandingMeter } from './understanding-meter.js';

const ICONS = {
  body: ['M3 14l2-5h14l2 5', 'M3 14h18v4H3z', 'M6 18v2', 'M18 18v2'],
  fuel: ['M5 21V4h9v17', 'M7 7h5v5H7z', 'M3 21h13', 'M14 8h3l3 3v6a2 2 0 0 1-4 0v-4'],
  sportiness: ['M4 18a9 9 0 1 1 16 0', 'M12 13l5-5', 'M7 16h10'],
  comfort: ['M7 3v9h10v8', 'M7 12l-2 7h14', 'M9 5h4v5', 'M4 21h16'],
  economy: ['M20 4C9 2 3 9 5 16c8 5 16-2 15-12Z', 'M5 20l10-10'],
  size: ['M4 5h16v14H4z', 'M7 12h10', 'M10 9l-3 3 3 3', 'M14 9l3 3-3 3'],
  info: ['M12 16v-4', 'M12 8h.01', 'M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0'],
  bin: ['M3 6h18', 'M9 6V3h6v3', 'M5 6l1 15h12l1-15', 'M10 10v7', 'M14 10v7'],
};
const SAME_AGAIN_REASONS = { 'no-current-car': 'Add your current car to use this.', 'current-car-unidentified': 'Your current car details are incomplete.' };
const sameTipText = (description) => `Select this option if you just love everything about your current car, and your next best car would be another ${description ?? ''}`.trimEnd();
const choicesOf = (category) => category.options ?? category.stops ?? [];

/** Turns the server's `context.accountPreferences` into the ordered category list the component takes. */
export function preferenceCategories({ order = [], categories = {} } = {}) {
  return order.filter((key) => categories[key]).map((key) => ({ key, ...categories[key] }));
}

function nearestStop(stops, value) {
  const wanted = Number(value);
  return stops.reduce((best, stop) => (Math.abs(stop.value - wanted) < Math.abs(best.value - wanted) ? stop : best), stops[0]);
}

function chosenLabels(category, entry) {
  if (entry?.state !== 'considered') return [];
  if (category.kind === 'stops') return [nearestStop(category.stops, entry.value).label];
  const picked = new Set(Array.isArray(entry.value) ? entry.value : [entry.value]);
  return category.options.filter((option) => picked.has(option.value)).map((option) => option.label);
}

/** Compact category tiles with one open panel. A pure presenter: the caller owns state and handles every intent.
 * Optional `understanding: { label?, maximum }` and `sameAgain: { description, onToggle(on) }` fill the head and mode slots;
 * `action: { onClick, describedBy }` mounts the footer's primary button, labelled and disabled by state `action: { label, disabled }`. */
export function categoryPreferences({ id, categories = [], state: initial = {}, minimum = 3, understanding: meterOptions, sameAgain: sameOptions, action: actionOptions, onOpen, onChange, onRemove, onConfirmRemove, onKeep, onClose, onStatusAction } = {}) {
  if (!id || !categories.length) throw new TypeError('A unique id and the category list are required.');
  const doc = document;
  const root = el('section', 'gcsp-prefs'); root.setAttribute('aria-labelledby', `${id}-title`);
  const title = el('h2', 'gcsp-h2', 'Your preferences'); title.id = `${id}-title`; title.tabIndex = -1;
  const head = el('div', 'gcsp-prefs-head'); const intro = el('div');
  intro.append(title, el('p', 'gcsp-note', `Choose at least ${minimum} categories. Tell your buddy what matters.`));
  const understanding = el('div', 'gcsp-prefs-understanding'); understanding.dataset.slot = 'understanding';
  let meter = null;
  if (meterOptions) { meter = understandingMeter({ id: `${id}-understanding`, label: meterOptions.label, maximum: meterOptions.maximum }); understanding.append(meter.root); }
  head.append(intro, understanding);
  const mode = el('div', 'gcsp-prefs-mode'); mode.dataset.slot = 'mode';
  let same = null;
  if (sameOptions) {
    const field = checkboxField({ id: `${id}-same-again`, label: 'Same again, please!', switch: true, onChange: (on) => { same.tip.hide(); sameOptions.onToggle?.(on); } });
    field.root.classList.add('gcsp-same-switch');
    const info = button({ label: '', variant: 'ghost' }); info.classList.add('gcsp-prefs-info');
    info.setAttribute('aria-label', 'About Same again, please!'); info.append(svgIcon(ICONS.info));
    field.root.replaceChildren(field.root.querySelector('label'), info, field.input);
    const tip = helpTip({ host: field.root, triggers: [info], id: `${id}-same-again-help`, placement: 'below-start', dismissOnActivate: false,
      text: sameTipText(sameOptions.description) });
    const note = el('p', 'gcsp-note gcsp-prefs-same-note'); note.id = `${id}-same-again-note`; note.hidden = true;
    field.input.setAttribute('aria-describedby', tip.root.id);
    mode.append(field.root, note); same = { field, note, tip, info };
  }
  const tiles = el('div', 'gcsp-prefs-tiles'); const panelId = `${id}-panel`;
  const nodes = new Map();
  for (const category of categories) {
    const tile = el('div', 'gcsp-prefs-tile'); const open = el('button', 'gcsp-prefs-open'); open.type = 'button';
    open.id = `${id}-tile-${category.key}`; open.setAttribute('aria-controls', panelId);
    const top = el('span', 'gcsp-prefs-top');
    if (ICONS[category.key]) top.append(svgIcon(ICONS[category.key]));
    top.append(el('span', '', category.label));
    const value = el('span', 'gcsp-prefs-value'); open.append(top, value);
    open.addEventListener('click', () => onOpen?.(category.key));
    const remove = el('button', 'gcsp-prefs-remove'); remove.type = 'button'; remove.append(svgIcon(ICONS.bin));
    remove.setAttribute('aria-label', `Remove ${category.label} preference`);
    remove.addEventListener('click', () => onRemove?.(category.key));
    tile.append(open, remove); tiles.append(tile); nodes.set(category.key, { tile, open, value, remove });
  }
  const removal = el('div', 'gcsp-prefs-removal'); removal.setAttribute('role', 'group'); removal.hidden = true;
  const panel = el('div', 'gcsp-prefs-panel'); panel.id = panelId; panel.hidden = true;
  const foot = el('div', 'gcsp-prefs-foot'); const line = el('div', 'gcsp-prefs-statusline');
  const status = el('p', 'gcsp-prefs-status'); status.id = `${id}-status`; status.setAttribute('role', 'status');
  const action = el('div', 'gcsp-prefs-action'); action.dataset.slot = 'action';
  let actionButton = null;
  if (actionOptions) { actionButton = button({ label: '', variant: 'primary', onClick: () => actionOptions.onClick?.(), describedBy: actionOptions.describedBy }); action.append(actionButton); }
  line.append(status); foot.append(line, action);
  root.append(head, mode, tiles, removal, panel, foot);

  let state = { categories: {}, open: null, pendingRemoval: null, disabled: false, status: { kind: 'idle', text: '' } };
  let shownOpen = null; let shownRemoval = null; let parts = null; let shownStatus = ''; let mounted = false; let statusButton = null;
  const find = (key) => categories.find((category) => category.key === key);
  const entryOf = (key) => state.categories?.[key] ?? { state: 'unset' };
  const refocusAllowed = () => !doc.activeElement || doc.activeElement === doc.body || root.contains(doc.activeElement);

  function buildPanel(category) {
    const heading = el('div', 'gcsp-prefs-heading'); const question = el('h3', '', category.question); question.id = `${id}-question`;
    const done = button({ label: 'Done', variant: 'ghost', onClick: () => { onClose?.(); nodes.get(category.key)?.open.focus(); } });
    heading.append(question, done);
    let choices; let handle; let stopLabels = null; let slider = null;
    if (category.kind === 'stops') {
      const values = category.stops.map((stop) => stop.value); const gaps = values.slice(1).map((v, i) => v - values[i]);
      slider = el('div', 'gcsp-prefs-slider'); choices = slider;
      const middle = category.openDefault ?? values[Math.floor(values.length / 2)];
      const input = () => slider.querySelector('input');
      const spoken = (position) => { input().setAttribute('aria-valuetext', nearestStop(category.stops, position).label); };
      handle = renderRangeSlider(slider, { id: category.key, min: Math.min(...values), max: Math.max(...values), step: Math.min(...gaps), default: middle }, null, {
        single: true, value: middle, ariaLabel: category.question,
        onValueChange: (position) => { spoken(position); onChange?.(category.key, { value: position }); },
      });
      slider.querySelector('.vm-slider-value').hidden = true; slider.querySelector('.vm-slider-bounds').hidden = true;
      stopLabels = el('div', 'gcsp-prefs-stops'); stopLabels.setAttribute('aria-hidden', 'true');
      for (const stop of category.stops) stopLabels.append(el('span', '', stop.label));
      slider.append(stopLabels); spoken(middle);
      handle = { ...handle, spoken, middle };
    } else {
      const order = category.options.map((option) => option.value);
      const list = renderOptionList({ id: category.key, label: category.label, multi: true, options: category.options }, null, {
        value: [], ariaLabel: category.question,
        onValueChange: (next) => onChange?.(category.key, { value: order.filter((value) => next.includes(value)) }),
      });
      choices = list.list; choices.classList.add('gcsp-prefs-options'); handle = list;
    }
    const hint = el('p', 'gcsp-note gcsp-prefs-hint', 'Choose a preference first.'); hint.id = `${id}-hint`;
    const importance = checkboxField({ id: `${id}-important`, label: 'This is really important', switch: true, disabled: true, describedBy: hint.id,
      onChange: (on) => onChange?.(category.key, { importance: on ? 'high' : 'medium' }) });
    const row = el('div', 'gcsp-prefs-importance'); row.append(importance.root, hint);
    panel.replaceChildren(heading, choices, row);
    parts = { category, handle, stopLabels, importance, hint, done };
  }

  function patchPanel() {
    const { category, handle, stopLabels, importance, hint, done } = parts;
    const entry = entryOf(category.key); const considered = entry.state === 'considered'; const high = considered && entry.importance === 'high';
    const disabled = Boolean(state.disabled);
    if (category.kind === 'stops') {
      const position = considered ? Number(entry.value) : handle.middle;
      handle.update({ value: position, disabled }); handle.spoken(position);
      [...stopLabels.children].forEach((label, at) => label.classList.toggle('is-current', considered && category.stops[at].value === nearestStop(category.stops, position).value));
    } else handle.update({ value: considered ? (Array.isArray(entry.value) ? entry.value : [entry.value]) : [], disabled });
    importance.input.checked = high; importance.input.disabled = !considered || disabled;
    if (considered) importance.input.removeAttribute('aria-describedby'); else importance.input.setAttribute('aria-describedby', hint.id);
    importance.root.classList.toggle('is-important', high); hint.hidden = considered;
    panel.classList.toggle('is-important', high); done.disabled = disabled;
  }

  function buildRemoval(key) {
    const category = find(key); const prompt = el('p', '', `Remove your ${category.label.toLowerCase()} preference?`); prompt.id = `${id}-remove-title`;
    removal.setAttribute('aria-labelledby', prompt.id);
    const actions = el('div', 'gcsp-actions');
    const keep = button({ label: 'Keep it', variant: 'ghost', onClick: () => { onKeep?.(key); nodes.get(key)?.remove.focus(); } });
    const confirm = button({ label: 'Remove preference', variant: 'ghost', onClick: () => onConfirmRemove?.(key) });
    actions.append(keep, confirm); removal.replaceChildren(prompt, actions); return keep;
  }

  function patchStatus() {
    const next = state.status ?? { kind: 'idle', text: '' }; const kind = next.kind ?? 'idle';
    status.className = `gcsp-prefs-status is-${kind}`;
    if (shownStatus !== `${kind}|${next.text ?? ''}`) { shownStatus = `${kind}|${next.text ?? ''}`; status.textContent = next.text ?? ''; }
    if (!next.actionLabel) { statusButton?.remove(); statusButton = null; return; }
    if (!statusButton) { statusButton = button({ label: next.actionLabel, variant: 'ghost', onClick: () => { const now = state.status; if (now.onAction) now.onAction(); else onStatusAction?.(now.kind); } }); line.append(statusButton); }
    statusButton.textContent = next.actionLabel;
  }

  function patchSame(sameOn, disabled) {
    const view = state.sameAgain ?? {}; const available = view.available !== false; const reason = available ? '' : (SAME_AGAIN_REASONS[view.reason] ?? SAME_AGAIN_REASONS['no-current-car']);
    same.field.input.checked = sameOn; same.field.input.disabled = disabled || !available;
    same.note.hidden = available; same.note.textContent = reason;
    // No identified car, no target to describe: hide the help and let the visible reason describe the switch.
    same.info.hidden = !available; if (!available) same.tip.hide(); same.field.input.setAttribute('aria-describedby', available ? same.tip.root.id : same.note.id);
  }

  function update(next) {
    state = { ...state, ...next };
    const disabled = Boolean(state.disabled); const sameOn = Boolean(same && state.sameAgain?.on && state.sameAgain.available !== false);
    const open = sameOn ? null : state.open; const pendingRemoval = sameOn ? null : state.pendingRemoval;
    root.classList.toggle('is-disabled', disabled); root.classList.toggle('is-same-again', sameOn);
    meter?.update({ value: state.understanding?.value ?? 0, maximum: state.understanding?.maximum ?? meterOptions.maximum, pending: Boolean(state.understanding?.pending), failed: Boolean(state.understanding?.failed) });
    if (same) patchSame(sameOn, disabled);
    for (const category of categories) {
      const view = nodes.get(category.key); const entry = entryOf(category.key); const considered = entry.state === 'considered';
      const high = considered && entry.importance === 'high' && !sameOn; const text = chosenLabels(category, entry).join(', ');
      view.tile.classList.toggle('is-considered', considered); view.tile.classList.toggle('is-important', high);
      view.tile.classList.toggle('is-open', open === category.key);
      view.value.textContent = considered ? text : 'Choose';
      view.open.setAttribute('aria-expanded', String(open === category.key));
      view.open.setAttribute('aria-label', considered ? `${category.label}, considered: ${text}${high ? ', really important' : ''}${sameOn ? ', kept while Same again is on' : ''}` : `${category.label}, choose a preference`);
      view.open.disabled = disabled || sameOn; view.remove.disabled = disabled || sameOn; view.remove.hidden = !considered;
    }
    if (open !== shownOpen) {
      shownOpen = open; parts = null;
      if (shownOpen && find(shownOpen)) buildPanel(find(shownOpen)); else panel.replaceChildren();
      panel.hidden = !parts;
    }
    if (parts) patchPanel();
    if (pendingRemoval !== shownRemoval) {
      shownRemoval = pendingRemoval; removal.hidden = !shownRemoval || !find(shownRemoval);
      if (!removal.hidden) { const keep = buildRemoval(shownRemoval); if (mounted && refocusAllowed()) keep.focus(); } else removal.replaceChildren();
    }
    for (const control of removal.querySelectorAll('button')) control.disabled = disabled;
    if (actionButton) { actionButton.textContent = state.action?.label ?? ''; actionButton.disabled = disabled || Boolean(state.action?.disabled); }
    patchStatus();
  }

  update(initial); mounted = true;
  return {
    root, update,
    focusCategory: (key) => nodes.get(key)?.open.focus(),
    focusStatus() { status.tabIndex = -1; status.focus(); },
    get actionButton() { return actionButton; },
    setSameAgainDescription(description) { same?.tip.setText(sameTipText(description)); },
    destroy() { same?.tip.destroy(); root.remove(); parts = null; nodes.clear(); },
  };
}
