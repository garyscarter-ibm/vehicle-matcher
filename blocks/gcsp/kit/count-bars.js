// countBars: how many of each, as label, bar and count rows (the presenter mockup's chart style). The count text carries the meaning.
import { el } from '../../vehicle-matcher/ui.js';

let sequence = 0;
const whole = (value) => (Number.isFinite(value) && value > 0 ? Math.floor(value) : 0);

/** { label, rows: [{ label, count }], limit?, otherLabel?, level?, id? } -> a figure labelled by its heading.
 * Bars scale to the largest count; past `limit` rows the rest fold into one `otherLabel` row. */
export function countBars({ label, rows = [], limit = Infinity, otherLabel = 'Other', level = 3, id } = {}) {
  const figure = el('figure', 'gcsp-count-bars'); const title = el(`h${level}`, 'gcsp-count-bars-heading', label);
  title.id = id || `gcsp-count-bars-${++sequence}`; figure.setAttribute('aria-labelledby', title.id);
  let shown = rows.map((row) => ({ label: String(row?.label ?? ''), count: whole(row?.count) })).filter((row) => row.label && row.count);
  if (shown.length > limit) {
    const rest = shown.slice(limit - 1).reduce((sum, row) => sum + row.count, 0);
    shown = [...shown.slice(0, limit - 1), { label: otherLabel, count: rest }];
  }
  const most = Math.max(1, ...shown.map((row) => row.count));
  const list = el('ul', 'gcsp-count-bars-rows');
  list.append(...shown.map((row) => {
    const item = el('li', 'gcsp-count-bars-row'); const bar = el('span', 'gcsp-count-bars-bar'); const fill = el('span');
    bar.setAttribute('aria-hidden', 'true'); fill.style.setProperty('--gcsp-count-share', `${Math.round((row.count / most) * 10000) / 100}%`);
    bar.append(fill); const name = el('span', 'gcsp-count-bars-label', row.label); name.title = row.label;
    item.append(name, bar, el('span', 'gcsp-count-bars-n', String(row.count)));
    return item;
  }));
  if (!shown.length) list.append(el('li', 'gcsp-count-bars-empty', 'None'));
  figure.append(title, list); return figure;
}
