import { el, button, statusScreen } from '../../vehicle-matcher/ui.js';

export const RUN_RESTARTED_TITLE = 'Demo restarted';
export const RUN_RESTARTED_MESSAGE = 'The demo was restarted. Reload the page to continue.';

// A restart refuses the old run or session; a lapsed access key reads 'access-required'. A reload recovers.
const RESTARTED = ['stale-run', 'unknown-session', 'access-required'];
export const isRunRestarted = (reply) => RESTARTED.includes(reply?.status);
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
