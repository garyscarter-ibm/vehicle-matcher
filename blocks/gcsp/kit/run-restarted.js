import { el, button, statusScreen } from '../../vehicle-matcher/ui.js';

export const RUN_RESTARTED_TITLE = 'Restarted';
export const RUN_RESTARTED_MESSAGE = 'This page was restarted. Reload to continue.';
export const ACCESS_LAPSED_TITLE = 'Access needed';
export const ACCESS_LAPSED_MESSAGE = 'Your access has lapsed. Enter the access key again, then open this offer from your account.';

// A restart refuses the old run or session; a lapsed access key reads 'access-required'. A reload recovers.
const RESTARTED = ['stale-run', 'unknown-session', 'access-required'];
export const isRunRestarted = (reply) => RESTARTED.includes(reply?.status);
// A lapsed access key is the server's bare 401 (no string status); an adapter maps it to { status: 'access-required' }.
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

/** For the offer link, which the access gate leaves open, so a reload cannot reach the access form. */
export function accessLapsedScreen({ next = '/gcsp-account.html' } = {}) {
  return statusScreen({ title: ACCESS_LAPSED_TITLE, message: ACCESS_LAPSED_MESSAGE, role: 'alert',
    actions: [button({ label: 'Enter the access key', href: `/gcsp/access?next=${encodeURIComponent(next)}` })] });
}
