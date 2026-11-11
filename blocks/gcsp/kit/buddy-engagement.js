import { el } from '../../vehicle-matcher/ui.js';

const TEXT = Object.freeze({ engaged: 'Buddy engaged', disengaged: 'Buddy disengaged', unknown: 'Buddy status unavailable' });

/** Static lamp plus the state in words. Not a live region: the caller's one status line announces outcomes.
 * Returns { root, update(state) } with state 'engaged' | 'disengaged' | 'unknown' (anything else reads unknown). */
export function buddyEngagement({ id, state = 'unknown' } = {}) {
  if (!id) throw new TypeError('A unique id is required.');
  const root = el('p', 'gcsp-buddy-engagement'); root.id = id;
  const lamp = el('span', 'gcsp-buddy-lamp'); lamp.setAttribute('aria-hidden', 'true');
  const words = el('span', 'gcsp-buddy-engagement-text');
  root.append(lamp, words);
  function update(next = 'unknown') {
    const shown = Object.hasOwn(TEXT, next) ? next : 'unknown';
    root.dataset.state = shown; root.className = `gcsp-buddy-engagement is-${shown}`; words.textContent = TEXT[shown];
  }
  update(state);
  return { root, update };
}
