import { el, button } from '../../vehicle-matcher/ui.js';

// Presentation only: the activity read remains the authority on search permission.
export function buddyState(result) {
  const value = result?.status === 'ok' ? result.value : null;
  if (!value || !Object.hasOwn(value, 'permission')) return 'unavailable';
  if (value.permission === null) return 'unset';
  const permission = value.permission;
  if (typeof permission?.paused !== 'boolean' || typeof permission?.canSearch !== 'boolean') return 'unavailable';
  if (value.currentOffer?.state === 'accepted') return 'finished';
  if (permission.paused) return 'paused';
  return permission.canSearch ? 'active' : 'inactive';
}

const labels = { engaged: 'Buddy engaged', disengaged: 'Buddy disengaged', unknown: 'Buddy status unavailable', active: 'Active', paused: 'Paused', unset: 'Not set up', finished: 'Search finished', inactive: 'Inactive', unavailable: 'Status unavailable' };

const ENGAGEMENT = ['engaged', 'disengaged', 'unknown'];

/** Shared status dot/wording, optionally inside the outlined Buddy navigation link.
 * `prominent: true, id` (FUCQ-370) is the Account lamp: a static `<p>` (no live region) with a repaint method `update(state)` on the element. */
export function buddyStatus({ state = 'unavailable', href, onClick, prominent = false, id } = {}) {
  if (prominent) return prominentStatus(id, state);
  const key = Object.hasOwn(labels, state) ? state : 'unavailable';
  const status = el('span', `gcsp-buddy-status is-${key}`);
  const dot = el('span', 'gcsp-buddy-dot'); dot.setAttribute('aria-hidden', 'true');
  status.append(dot, document.createTextNode(labels[key]));
  if (!href) return status;
  const link = button({ href, variant: 'ghost', onClick });
  link.classList.add('gcsp-buddy-link'); link.dataset.focusKey = 'buddy-status';
  link.append(el('span', 'gcsp-buddy-name', 'Buddy'));
  if (key === 'unset') link.append(el('span', 'gcsp-buddy-setup', 'Set up your buddy'));
  else link.append(status);
  const chevron = el('span', 'gcsp-buddy-chevron', '›'); chevron.setAttribute('aria-hidden', 'true');
  link.append(chevron); return link;
}

function prominentStatus(id, state) {
  if (!id) throw new TypeError('A unique id is required.');
  const root = el('p', 'gcsp-buddy-status is-prominent'); root.id = id;
  const lamp = el('span', 'gcsp-buddy-lamp'); lamp.setAttribute('aria-hidden', 'true');
  const words = el('span', 'gcsp-buddy-status-text');
  root.append(lamp, words);
  root.update = (next = 'unknown') => {
    const shown = ENGAGEMENT.includes(next) ? next : 'unknown';
    root.dataset.state = shown; root.className = `gcsp-buddy-status is-prominent is-${shown}`; words.textContent = labels[shown];
  };
  root.update(state); return root;
}
