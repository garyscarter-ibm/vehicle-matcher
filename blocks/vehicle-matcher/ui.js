/*
 * Shared UI primitives for the vehicle-matcher block.
 *
 * Deliberately tiny and brand-/mode-agnostic: the lowest-level helpers that
 * every interface "mode" (see modes/) needs, with no dependency on the quiz,
 * the engine client, or any brand copy. Anything a second mode would obviously
 * reuse lives here; anything still coupled to the questions flow stays in
 * modes/questionnaire.js until a second mode actually needs it.
 */

/** Create an element with an optional class and text — the workhorse the whole
 * block builds its DOM with. */
export function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** Small cardinals as words, for prose where a numeral would read oddly ("the
 * three cars" beats "the 3 cars"). Anything larger falls back to the numeral,
 * which is fine — it only reads awkwardly at small counts. */
export const CARDINALS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
export const cardinal = (n) => CARDINALS[n] ?? String(n);

/** Money, GBP, no pence. */
export const gbp = (n) => `£${n.toLocaleString('en-GB')}`;

/** Explicit display terms keep purchase money separate from monthly scheme points. */
export function formatTerm(term = {}) {
  const known = Number.isFinite(term.value);
  if (term.kind === 'purchase-money' && term.currency === 'GBP') {
    return known ? gbp(term.value) : 'Purchase price not supplied';
  }
  if (term.kind === 'points-monthly') {
    const cost = known ? `${term.value.toLocaleString('en-GB')} points a month` : 'Monthly points cost not supplied';
    const allowance = Number.isFinite(term.allowance)
      ? `${term.allowance.toLocaleString('en-GB')} points a month allowance` : 'monthly points allowance not supplied';
    return `${cost} · ${allowance}`;
  }
  return 'Terms not supplied';
}

/** Screen heading block: optional kicker, title (h<level>) and lede, in the retail vm-kicker/vm-title/vm-lede styles. */
export function screenIntro({ kicker, title, lede, level = 2, className } = {}) {
  const wrap = el('div', className);
  if (kicker) wrap.append(el('p', 'vm-kicker', kicker));
  wrap.append(el(`h${level}`, 'vm-title', title));
  if (lede) wrap.append(el('p', 'vm-lede', lede));
  return wrap;
}

/** Primary or ghost button: a <button type="button">, or an <a> when href is given and not disabled. */
export function button({ label, variant = 'primary', onClick, href, disabled = false, describedBy } = {}) {
  const asLink = Boolean(href) && !disabled;
  const node = el(asLink ? 'a' : 'button', `vm-btn vm-btn-${variant === 'ghost' ? 'ghost' : 'primary'}`, label);
  if (asLink) {
    node.href = href;
  } else {
    node.type = 'button';
    node.disabled = Boolean(disabled);
  }
  if (describedBy) node.setAttribute('aria-describedby', describedBy);
  if (onClick) node.addEventListener('click', onClick);
  return node;
}

/** Error, empty or no-match screen shell: kicker, h2 title, message and action nodes. */
export function statusScreen({ kicker, title, message, actions = [], role = 'status' } = {}) {
  const screen = el('div', 'vm-screen vm-status');
  screen.setAttribute('role', role);
  if (kicker) screen.append(el('p', 'vm-kicker', kicker));
  screen.append(el('h2', 'vm-title', title));
  if (message) screen.append(el('p', 'vm-lede', message));
  screen.append(...actions);
  return screen;
}

/** Label/value facts as a <dl>. Rows: { label, value, unit, missingLabel }; a null or undefined value reads "Not supplied". */
export function factList(rows = [], { className } = {}) {
  const list = el('dl', `vm-facts${className ? ` ${className}` : ''}`);
  for (const row of rows) {
    const item = el('div', 'vm-fact');
    const missing = row.value === null || row.value === undefined || row.value === '';
    const shown = typeof row.value === 'number' ? row.value.toLocaleString('en-GB') : row.value;
    item.append(
      el('dt', 'vm-fact-label', row.label),
      el('dd', `vm-fact-value${missing ? ' is-missing' : ''}`, missing ? (row.missingLabel || 'Not supplied') : `${shown}${row.unit ? ` ${row.unit}` : ''}`),
    );
    list.append(item);
  }
  return list;
}
