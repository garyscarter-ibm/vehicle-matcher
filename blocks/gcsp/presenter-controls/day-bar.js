// The console's day bar (presenter mockup): the scheme week Mon to Sun, with past days done, today marked and weekends dimmed.
import { el } from '../../vehicle-matcher/ui.js';
import { londonParts } from '../kit/friendly-time.js';

const NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** Pure: the 7 days of now's London week as { label, done, today, weekend, beforeStart }, or [] when now is not an instant. */
export function weekDays(nowIso, startIso) {
  const now = londonParts(nowIso); if (!now) return [];
  const start = londonParts(startIso);
  const today = Date.UTC(now.year, now.month - 1, now.day); const monday = today - ((now.weekday + 6) % 7) * 86400000;
  const first = start ? Date.UTC(start.year, start.month - 1, start.day) : -Infinity;
  return NAMES.map((name, at) => {
    const day = monday + at * 86400000;
    return { label: `${name} ${new Date(day).getUTCDate()}`, done: day < today && day >= first, today: day === today, weekend: at > 4, beforeStart: day < first };
  });
}

/** Returns { root, update({ now, start }) }; root is an ordered list labelled "Scheme week", hidden until a valid now. */
export function dayBar() {
  const root = el('ol', 'gcsp-console-week'); root.setAttribute('aria-label', 'Scheme week'); root.hidden = true;
  function update({ now, start } = {}) {
    const days = weekDays(now, start); root.hidden = !days.length;
    root.replaceChildren(...days.map((day) => {
      const item = el('li', '', day.label);
      item.classList.toggle('is-done', day.done); item.classList.toggle('is-today', day.today);
      item.classList.toggle('is-weekend', day.weekend); item.classList.toggle('is-before', day.beforeStart);
      if (day.today) item.setAttribute('aria-current', 'date');
      return item;
    }));
  }
  return { root, update };
}
