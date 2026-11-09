// rangeBar: a mean with its range across seeds, on one shared scale. The value text carries the meaning; the track is decorative.
import { el } from '../../vehicle-matcher/ui.js';

let sequence = 0;
const finite = (value) => Number.isFinite(value);

// The supplied scale, else the smallest row min to the largest row max. A flat or empty scale widens, so nothing divides by zero.
function scaleOf(rows, scale) {
  const values = (scale ? [scale.min, scale.max] : rows.flatMap((row) => [row.min, row.max])).filter(finite);
  if (!values.length) return { min: 0, max: 1 };
  const min = Math.min(...values); const max = Math.max(...values);
  return min === max ? { min: min - 1, max: max + 1 } : { min, max };
}

// A place on the scale as a percentage, clamped to 0..100 and rounded to 2 dp for the CSS custom properties.
const percentOf = (value, { min, max }) => `${Math.round(Math.min(100, Math.max(0, ((value - min) / (max - min)) * 100)) * 100) / 100}%`;

function rangeRow(row, bounds, format) {
  const item = el('li', 'gcsp-range-bar-row'); const track = el('span', 'gcsp-range-bar-track'); const value = el('span', 'gcsp-range-bar-value');
  track.setAttribute('aria-hidden', 'true');
  if (!finite(row.mean)) { item.classList.add('is-missing'); value.textContent = 'Not observed'; }
  else {
    const ranged = finite(row.min) && finite(row.max);
    if (ranged) {
      const span = el('span', 'gcsp-range-bar-span');
      span.style.setProperty('--gcsp-range-start', percentOf(row.min, bounds)); span.style.setProperty('--gcsp-range-end', percentOf(row.max, bounds));
      track.append(span);
    }
    const mean = el('span', 'gcsp-range-bar-mean'); mean.style.setProperty('--gcsp-range-mean', percentOf(row.mean, bounds));
    track.append(mean);
    value.textContent = ranged && row.min !== row.max ? `${format(row.mean)} (${format(row.min)} to ${format(row.max)})` : String(format(row.mean));
  }
  item.append(el('span', 'gcsp-range-bar-label', row.label), track, value);
  return item;
}

/** { label, rows: [{ label, mean, min, max }], scale?, format?, level?, id? } -> a figure labelled by its heading. */
export function rangeBar({ label, rows = [], scale, format = String, level = 3, id } = {}) {
  const figure = el('figure', 'gcsp-range-bar'); const title = el(`h${level}`, 'gcsp-range-bar-heading', label);
  title.id = id || `gcsp-range-bar-${++sequence}`; figure.setAttribute('aria-labelledby', title.id);
  const bounds = scaleOf(rows, scale); const list = el('ul', 'gcsp-range-bar-rows');
  list.append(...rows.map((row) => rangeRow(row, bounds, format)));
  figure.append(title, list); return figure;
}
