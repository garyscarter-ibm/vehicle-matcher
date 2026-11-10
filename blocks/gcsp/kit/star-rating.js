import { el } from '../../vehicle-matcher/ui.js';
import { svgIcon } from '../shell/portal-shell.js';
import { helpTip } from './help-tip.js';
import { viewStatus } from './view-status.js';

export const RATING_WORDS = ['', 'Not for me', 'Ready for a change', 'It’s okay', 'I really like it', 'I love it'];
const STAR = ['m12 2.8 2.8 5.7 6.3.9-4.6 4.4 1.1 6.3-5.6-3-5.6 3 1.1-6.3L2.9 9.4l6.3-.9Z'];
const STATUSES = ['idle', 'pending', 'saved', 'failed'];
let sequence = 0;
const clean = (value) => (Number.isInteger(value) && value >= 1 && value <= 5 ? value : null);

/** Five-star rating, 1-5 or null; choosing the selected star clears it. The caller owns saving and reports it with update({ value, status }).
 * Returns { root, update({ value, status, disabled }), value(), focus(), destroy() }; sends no requests and stores nothing. */
export function starRating({ label, value = null, help, labels = RATING_WORDS, onChange, announce, overlay = false, name, disabled = false } = {}) {
  const id = ++sequence; const group = name ?? `gcsp-star-rating-${id}`;
  const root = el('fieldset', `gcsp-star-rating${overlay ? ' gcsp-star-rating-overlay' : ''}`); root.dataset.status = 'idle';
  root.append(el('legend', '', label));
  const row = el('div', 'gcsp-star-row'); root.append(row);
  let current = clean(value); let status = 'idle'; let spoken = ''; let spaceHeld = false;
  const own = announce ? null : viewStatus(); if (own) root.append(own.root);
  const say = (text) => { if (!text || text === spoken) return; spoken = text; if (own) own.announce(text); else announce(text); };

  const targets = []; const radios = [];
  for (let n = 1; n <= 5; n++) {
    const target = el('label', 'gcsp-star'); const radio = el('input');
    radio.type = 'radio'; radio.name = group; radio.value = String(n);
    radio.setAttribute('aria-label', `${n} ${n === 1 ? 'star' : 'stars'}: ${labels[n] ?? ''}`);
    target.append(radio, svgIcon(STAR)); row.append(target); targets.push(target); radios.push(radio);
  }
  const tip = help ? helpTip({ host: root, triggers: radios, text: help, id: `gcsp-star-rating-help-${id}`, placement: 'above-end', dismissOnActivate: true }) : null;

  function paint() {
    targets.forEach((target, at) => { target.classList.toggle('is-filled', at < (current ?? 0)); radios[at].checked = at + 1 === current; });
  }
  function choose(n) {
    tip?.dismiss();
    const next = current === n ? null : n;
    current = next; paint(); onChange?.(next);
  }
  function move(to) {
    tip?.dismiss(); radios[to - 1].focus();
    if (current !== to) { current = to; paint(); onChange?.(to); }
  }

  radios.forEach((radio, at) => {
    const n = at + 1;
    radio.addEventListener('click', (event) => {
      // A Space keydown already activated; the browser's keyup click (detail 0) must not toggle again.
      if (spaceHeld && event.detail === 0) { spaceHeld = false; paint(); return; }
      choose(n);
    });
    radio.addEventListener('keydown', (event) => {
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      const key = event.key; const space = key === ' ' || key === 'Spacebar';
      if (space || key === 'Enter') { event.preventDefault(); if (event.repeat) return; spaceHeld = space; choose(n); return; }
      const to = { ArrowRight: Math.min(5, n + 1), ArrowUp: Math.min(5, n + 1), ArrowLeft: Math.max(1, n - 1), ArrowDown: Math.max(1, n - 1), Home: 1, End: 5 }[key];
      if (to) { event.preventDefault(); spaceHeld = false; move(to); }
    });
    radio.addEventListener('keyup', (event) => {
      if (event.key !== ' ' && event.key !== 'Spacebar') return;
      event.preventDefault(); // The browser's keyup click runs before the next frame, which then clears the guard.
      const win = radio.ownerDocument.defaultView; if (win?.requestAnimationFrame) win.requestAnimationFrame(() => { spaceHeld = false; }); else spaceHeld = false;
    });
    radio.addEventListener('blur', () => { spaceHeld = false; });
    radio.addEventListener('pointerdown', () => { spaceHeld = false; });
    radio.addEventListener('change', () => paint());
  });

  function setDisabled(flag) { radios.forEach((radio) => { radio.disabled = flag; }); }
  function update(next = {}) {
    if ('value' in next) current = clean(next.value);
    if ('disabled' in next) setDisabled(Boolean(next.disabled));
    paint();
    if (next.status === undefined) return;
    const was = status; status = STATUSES.includes(next.status) ? next.status : 'idle';
    root.dataset.status = status;
    if (status === 'pending') root.setAttribute('aria-busy', 'true'); else root.removeAttribute('aria-busy');
    if (status === 'pending') { spoken = ''; own?.clear(); } else if (status === 'saved') say(current === null ? 'Rating cleared' : `Rating saved: ${current} of 5`);
    else if (status === 'failed') say('Rating not saved. Try again.');
    else if (was !== 'idle') spoken = '';
  }

  setDisabled(Boolean(disabled)); paint();
  return {
    root, update, value: () => current, tip,
    focus() { (radios[(current ?? 1) - 1]).focus(); },
    destroy() { tip?.destroy(); },
  };
}
