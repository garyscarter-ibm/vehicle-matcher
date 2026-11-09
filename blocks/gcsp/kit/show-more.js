import { el, button } from '../../vehicle-matcher/ui.js';

/** Paging footer: a plain "Showing n of total" line and a real button. The caller owns the page size, focus, state and announcing. */
export function showMore({ nouns = ['car', 'cars'], label = 'Show more cars', onShowMore } = {}) {
  const root = el('div', 'gcsp-show-more'); const count = el('p', 'gcsp-show-more-count');
  const more = button({ label, variant: 'ghost', onClick: () => onShowMore?.() });
  root.append(count, more);
  function update({ shown, total }) {
    const n = (value) => value.toLocaleString('en-GB');
    count.textContent = `Showing ${n(shown)} of ${n(total)} ${total === 1 ? nouns[0] : nouns[1]}`;
    more.hidden = shown >= total;
  }
  update({ shown: 0, total: 0 });
  return { root, update, button: more };
}
