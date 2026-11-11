import { el } from '../../vehicle-matcher/ui.js';

const whole = (n, low, high) => Math.min(high, Math.max(low, Math.round(Number.isFinite(Number(n)) ? Number(n) : low)));

/** Read-only input-completeness meter: "n / max" plus equal segments. Never a confidence or fit score.
 * Returns { root, update({ value, maximum, pending, failed }) }; `pending` mutes the figure and adds "(saving)" to its accessible name, or "(not saved)" when `failed`. */
export function understandingMeter({ id, label = 'Buddy understanding', value = 0, maximum = 11, pending = false, failed = false } = {}) {
  if (!id) throw new TypeError('A unique id is required.');
  const root = el('div', 'gcsp-understanding'); root.id = id; root.dataset.kind = 'input-completeness';
  const name = el('span', 'gcsp-understanding-label', label); const figure = el('strong', 'gcsp-understanding-value');
  const meter = el('span', 'gcsp-understanding-meter'); meter.setAttribute('aria-hidden', 'true');
  root.append(name, figure, meter);
  let shownMaximum = 0;
  function update(next = {}) {
    const top = whole(next.maximum ?? maximum, 1, 99); const now = whole(next.value ?? value, 0, top); const wait = Boolean(next.pending ?? pending); const bad = wait && Boolean(next.failed ?? failed);
    if (top !== shownMaximum) { shownMaximum = top; meter.replaceChildren(...Array.from({ length: top }, () => el('i'))); }
    [...meter.children].forEach((segment, at) => segment.classList.toggle('is-filled', at < now));
    figure.textContent = `${now} / ${top}`;
    figure.setAttribute('aria-label', `${label} ${now} out of ${top}${wait ? (bad ? ' (not saved)' : ' (saving)') : ''}`);
    root.classList.toggle('is-pending', wait); root.dataset.value = String(now);
  }
  update({ value, maximum, pending, failed });
  return { root, update };
}
