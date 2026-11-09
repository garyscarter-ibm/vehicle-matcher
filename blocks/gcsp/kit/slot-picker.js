import { el, button } from '../../vehicle-matcher/ui.js';
import { demoTime } from './activity-timeline.js';

let sequence = 0;
const day = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const clock = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'UTC' });
const dayText = (date) => { const p = Object.fromEntries(day.formatToParts(date).map((part) => [part.type, part.value])); return `${p.weekday} ${p.day} ${p.month} ${p.year}`; };

/** Offered times grouped by demo-time (UTC) day: each day a named list of compact time buttons. Supplied order is kept; the caller owns the request. */
export function slotPicker({ slots = [], actionLabel = 'Request', onPick, disabled = false, className = '' } = {}) {
  const root = el('ul', `gcsp-slot-picker${className ? ` ${className}` : ''}`); const days = new Map();
  for (const slot of slots) {
    const date = new Date(slot?.start);
    if (!Number.isFinite(date.getTime())) continue;
    const key = dayText(date); const rows = days.get(key) ?? []; rows.push({ slot, date }); days.set(key, rows);
  }
  for (const [text, rows] of days) {
    const item = el('li', 'gcsp-slot-day'); const title = el('p', 'gcsp-slot-day-heading', text); title.id = `gcsp-slot-day-${++sequence}`;
    const times = el('ul', 'gcsp-slot-times'); times.setAttribute('aria-labelledby', title.id);
    for (const { slot, date } of rows) {
      const cell = el('li', 'gcsp-slot-time'); const name = `${actionLabel} ${demoTime(slot.start)}`;
      if (typeof onPick === 'function') {
        const pick = button({ label: clock.format(date), variant: 'ghost', disabled, onClick: () => onPick(slot) });
        pick.setAttribute('aria-label', name); pick.dataset.focusKey = name; cell.append(pick);
      } else cell.append(el('span', '', clock.format(date)));
      times.append(cell);
    }
    item.append(title, times); root.append(item);
  }
  return root;
}
