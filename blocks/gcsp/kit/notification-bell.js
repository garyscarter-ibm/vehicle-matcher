// GCSP kit: notificationBell, a header disclosure with a count badge and a rows panel. Presentational: hosts supply the model.
import { el, button } from '../../vehicle-matcher/ui.js';
import { viewStatus } from './view-status.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const BELL = ['M6 9a6 6 0 0 1 12 0c0 6 2.5 8 2.5 8h-17S6 15 6 9', 'M10.3 20.5a2 2 0 0 0 3.4 0'];
let uid = 0;

export const UNAVAILABLE_TEXT = 'Notifications are unavailable right now.';
export const EMPTY_TEXT = 'No notifications yet.';
export const bellLabel = (waiting) => (waiting > 0 ? `Notifications, ${waiting} car offer${waiting === 1 ? '' : 's'} waiting` : 'Notifications, none waiting');

function icon() {
  const svg = document.createElementNS(SVG_NS, 'svg');
  for (const [key, value] of Object.entries({ viewBox: '0 0 24 24', class: 'gcsp-icon', 'aria-hidden': 'true', focusable: 'false', fill: 'none',
    stroke: 'currentColor', 'stroke-width': '1.6', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' })) svg.setAttribute(key, value);
  for (const d of BELL) { const path = document.createElementNS(SVG_NS, 'path'); path.setAttribute('d', d); svg.append(path); }
  return svg;
}

function rowNode(row) {
  const li = el('li', `gcsp-bell-row${row.waiting ? ' is-waiting' : ''}${row.kind === 'offer' ? '' : ' is-plain'}`);
  if (row.image?.src) { const img = el('img', 'gcsp-bell-thumb'); img.src = row.image.src; img.alt = ''; li.append(img); }
  const copy = el('div', 'gcsp-bell-copy'); const head = el('p', 'gcsp-bell-head');
  if (row.waiting) { const dot = el('span', 'gcsp-bell-dot'); dot.setAttribute('aria-hidden', 'true'); head.append(dot); }
  head.append(el('strong', '', row.title)); copy.append(head);
  if (row.car) copy.append(el('p', '', row.car));
  if (row.detail) copy.append(el('p', 'gcsp-bell-muted', row.detail));
  if (row.action?.href) {
    const action = row.action.variant === 'button' ? button({ label: row.action.label, href: row.action.href }) : el('a', 'gcsp-bell-link', row.action.label);
    if (row.action.variant === 'button') action.classList.add('gcsp-bell-action'); else action.href = row.action.href;
    copy.append(action);
  }
  li.append(copy);
  return li;
}

/**
 * Bell button, badge, rows panel and a short note under the bell. Model: { status: 'ok' | 'unavailable' | 'loading', waiting, rows, allHref, note }.
 * A row is { key, kind, waiting, title, car, detail, image: { src }, action: { label, href, variant } }; a note is { id, title, text }.
 * pinned (gallery only) keeps it open against Escape and outside clicks.
 * Returns { root, button, update(model), open(), close(restoreFocus = true), destroy() }.
 */
export function notificationBell({ id = `gcsp-bell-${++uid}`, onNavigate, onOpen, noteMs = 6000, pinned = false,
  schedule = globalThis.setTimeout, cancel = globalThis.clearTimeout } = {}) {
  const root = el('div', 'gcsp-bell');
  const trigger = el('button', 'gcsp-bell-btn'); trigger.type = 'button';
  const panelId = `${id}-panel`; const titleId = `${id}-title`;
  trigger.setAttribute('aria-expanded', 'false'); trigger.setAttribute('aria-controls', panelId);
  const badge = el('span', 'gcsp-bell-badge'); badge.setAttribute('aria-hidden', 'true'); badge.hidden = true;
  trigger.append(icon(), badge);
  const note = el('div', 'gcsp-bell-note'); note.setAttribute('aria-hidden', 'true'); note.hidden = true;
  const panel = el('div', 'gcsp-bell-panel'); panel.id = panelId; panel.hidden = true;
  const title = el('h2', 'gcsp-bell-title', 'Notifications'); title.id = titleId; panel.setAttribute('aria-labelledby', titleId);
  const body = el('div', 'gcsp-bell-body'); const foot = el('a', 'gcsp-bell-foot', 'See all buddy activity');
  panel.append(title, body, foot);
  const status = viewStatus();
  root.append(trigger, note, panel, status.root);

  let isOpen = false; let lastSig = null; let lastNote = null; let noteTimer = null; let destroyed = false;
  const hideNote = () => { if (noteTimer != null) cancel(noteTimer); noteTimer = null; note.hidden = true; note.replaceChildren(); };
  function showNote(next) {
    if (!next || next.id === lastNote) return;
    lastNote = next.id; status.announce(`${next.title}. ${next.text}`);
    if (isOpen) return;
    hideNote(); note.append(el('strong', '', next.title), el('span', '', next.text)); note.hidden = false;
    noteTimer = schedule(hideNote, noteMs);
  }
  function render(model) {
    const hadFocus = panel.contains(root.ownerDocument.activeElement);
    if (model.status !== 'ok') body.replaceChildren(el('p', 'gcsp-bell-empty', UNAVAILABLE_TEXT));
    else if (!model.rows.length) body.replaceChildren(el('p', 'gcsp-bell-empty', EMPTY_TEXT));
    else { const list = el('ul', 'gcsp-bell-rows'); list.append(...model.rows.map(rowNode)); body.replaceChildren(list); }
    foot.hidden = model.status !== 'ok' || !model.allHref;
    if (model.allHref) foot.href = model.allHref;
    if (hadFocus && !panel.contains(root.ownerDocument.activeElement)) trigger.focus();
  }
  function update(input) {
    if (destroyed) return;
    const model = { status: 'unavailable', waiting: 0, rows: [], allHref: null, note: null, ...input };
    model.rows = Array.isArray(model.rows) ? model.rows : []; model.waiting = model.status === 'ok' && model.waiting > 0 ? 1 : 0;
    trigger.setAttribute('aria-label', bellLabel(model.waiting));
    badge.hidden = !model.waiting; badge.textContent = model.waiting ? String(model.waiting) : '';
    root.dataset.status = model.status;
    const sig = JSON.stringify([model.status, model.rows, model.allHref]);
    if (sig !== lastSig) { lastSig = sig; render(model); }
    showNote(model.note);
  }
  const onKey = (event) => { if (event.key === 'Escape') close(); };
  const onOutside = (event) => {
    if (root.contains(event.target)) return;
    const active = root.ownerDocument.activeElement; const stranded = !active || active === root.ownerDocument.body || root.contains(active);
    close(false); if (stranded) trigger.focus();
  };
  function open() {
    if (isOpen || destroyed) return;
    isOpen = true; hideNote(); onOpen?.();
    panel.hidden = false; trigger.setAttribute('aria-expanded', 'true'); trigger.classList.add('is-open');
    if (!pinned) { root.ownerDocument.addEventListener('keydown', onKey); root.ownerDocument.addEventListener('click', onOutside, true); }
  }
  function close(restoreFocus = true) {
    if (!isOpen) return;
    isOpen = false; panel.hidden = true; trigger.setAttribute('aria-expanded', 'false'); trigger.classList.remove('is-open');
    root.ownerDocument.removeEventListener('keydown', onKey); root.ownerDocument.removeEventListener('click', onOutside, true);
    if (restoreFocus) trigger.focus();
  }
  const onToggle = () => (isOpen ? close() : open());
  const onPanelClick = (event) => {
    const link = event.target.closest?.('a[href]'); if (!link) return;
    close(false);
    if (onNavigate && !(event.metaKey || event.ctrlKey || event.shiftKey || event.button)) { event.preventDefault(); onNavigate(link.getAttribute('href')); }
  };
  trigger.addEventListener('click', onToggle); panel.addEventListener('click', onPanelClick);
  update({});

  return { root, button: trigger, update, open, close,
    destroy() {
      if (destroyed) return;
      close(false); hideNote(); destroyed = true;
      trigger.removeEventListener('click', onToggle); panel.removeEventListener('click', onPanelClick); root.remove();
    } };
}
