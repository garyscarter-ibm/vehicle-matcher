import { el, button } from '../../vehicle-matcher/ui.js';

export const buddyEngaged = (permission) => permission?.searchConsent === true && permission.holdConsent === true && permission.paused === false;

// Presentation only: the activity read remains the authority on search permission.
export function buddyState(result) {
  const value = result?.status === 'ok' ? result.value : null;
  if (!value || !Object.hasOwn(value, 'permission')) return 'unavailable';
  if (value.permission === null) return 'unset';
  const permission = value.permission;
  if (['searchConsent', 'holdConsent', 'paused', 'canSearch'].some((key) => typeof permission?.[key] !== 'boolean')) return 'unavailable';
  if (value.currentOffer?.state === 'accepted') return 'finished';
  return buddyEngaged(permission) ? 'active' : 'inactive';
}

const labels = { engaged: 'Buddy engaged', disengaged: 'Buddy disengaged', unknown: 'Buddy status unavailable', active: 'Buddy engaged', paused: 'Buddy disengaged', unset: 'Not set up', finished: 'Search finished', inactive: 'Buddy disengaged', unavailable: 'Status unavailable' };

const ENGAGEMENT = ['engaged', 'disengaged', 'unknown'];

// Shared Buddy wording; the prominent Account lamp repaints in place without a live region.
export function buddyStatus({ state = 'unavailable', href, onClick, prominent = false, id } = {}) {
  if (prominent) return prominentStatus(id, state);
  const key = Object.hasOwn(labels, state) ? state : 'unavailable';
  const status = el('span', `gcsp-buddy-status is-${key}`);
  const dot = el('span', 'gcsp-buddy-dot'); dot.setAttribute('aria-hidden', 'true');
  status.append(dot, document.createTextNode(labels[key]));
  if (!href) return status;
  const link = button({ href, variant: 'ghost', onClick });
  link.classList.add('gcsp-buddy-link'); link.dataset.focusKey = 'buddy-status';
  if (!labels[key].startsWith('Buddy ')) link.append(el('span', 'gcsp-buddy-name', 'Buddy'));
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
