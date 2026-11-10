import { el, button, statusScreen } from '../../vehicle-matcher/ui.js';

export const RUN_RESTARTED_TITLE = 'Restarted';
export const RUN_RESTARTED_MESSAGE = 'This page was restarted. Reload to continue.';
export const ACCESS_LAPSED_TITLE = 'Session ended';
export const ACCESS_LAPSED_MESSAGE = 'Your session has ended. Open your account to continue.';

// A restart refuses the old run or session; a bare 401 reads 'access-required'. A reload recovers.
const RESTARTED = ['stale-run', 'unknown-session', 'access-required'];
export const isRunRestarted = (reply) => RESTARTED.includes(reply?.status);
// A bare 401 (no string status); an adapter maps it to { status: 'access-required' }.
export const isAccessLapsed = (httpStatus, body) => httpStatus === 401 && typeof body?.status !== 'string';
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

/** For the offer link, where a reload would not restore the session: one link back to the account. */
export function accessLapsedScreen({ next = '/gcsp-account.html' } = {}) {
  return statusScreen({ title: ACCESS_LAPSED_TITLE, message: ACCESS_LAPSED_MESSAGE, role: 'alert',
    actions: [button({ label: 'Open your account', href: next })] });
}
