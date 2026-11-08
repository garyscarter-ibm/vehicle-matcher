import { el, button, statusScreen } from '../../vehicle-matcher/ui.js';

export const RUN_RESTARTED_TITLE = 'Demo restarted';
export const RUN_RESTARTED_MESSAGE = 'The demo was restarted. Reload the page to continue.';

// A restarted demo refuses the old session with status 'stale-run'; a reload starts a fresh one.
export const isRunRestarted = (reply) => reply?.status === 'stale-run';
// An empty href resolves to this page without its fragment, so the click is a full reload.
const defaultReload = () => { const link = el('a'); link.setAttribute('href', ''); link.click(); };

/** Page-level screen: title, message and one Reload button. */
export function runRestartedScreen({ reload = defaultReload } = {}) {
  return statusScreen({ title: RUN_RESTARTED_TITLE, message: RUN_RESTARTED_MESSAGE, role: 'alert',
    actions: [button({ label: 'Reload', onClick: () => reload() })] });
}

/** Compact panel form. Returns { root, reload } so the caller can move focus to the Reload button. */
export function runRestartedNotice({ reload = defaultReload } = {}) {
  const root = el('div', 'gcsp-run-restarted'); root.setAttribute('role', 'alert');
  const reloadButton = button({ label: 'Reload', onClick: () => reload() });
  root.append(el('p', 'gcsp-note', RUN_RESTARTED_MESSAGE), reloadButton);
  return { root, reload: reloadButton };
}
