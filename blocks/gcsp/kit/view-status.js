import { el } from '../../vehicle-matcher/ui.js';

/** The one screen-reader status line per view, for results and outcomes only. `clear()` lets the same text announce again. */
export function viewStatus({ className = 'gcsp-vh' } = {}) {
  const root = el('p', className); root.setAttribute('role', 'status'); root.setAttribute('aria-atomic', 'true');
  let last = '';
  return {
    root,
    announce(text) { if (text && text !== last) { last = text; root.textContent = text; } },
    clear() { last = ''; root.textContent = ''; },
  };
}
