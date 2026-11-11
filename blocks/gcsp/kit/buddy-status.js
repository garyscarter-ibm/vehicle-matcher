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

const labels = { active: 'Active', paused: 'Paused', unset: 'Not set up', finished: 'Search finished', inactive: 'Inactive', unavailable: 'Status unavailable' };

/** Shared status dot/wording, optionally inside the outlined Buddy navigation link. */
export function buddyStatus({ state = 'unavailable', href, onClick } = {}) {
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
