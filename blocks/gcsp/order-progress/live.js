import { createAccountHttpAdapter } from '../shell/account-runtime.js';
import { createOrderProgressHttpAdapter } from './order-progress-http.js';
import { createCaseHttpAdapter } from '../cases/http-adapter.js';
import { ORDER_PROGRESS_DESTINATION, defineGcspOrderProgress } from './gcsp-order-progress.js';

const host = globalThis.document?.querySelector('gcsp-order-progress[data-live]');
if (host) {
  defineGcspOrderProgress();
  host.helpAdapter = createCaseHttpAdapter();
  host.adapter = { ...createOrderProgressHttpAdapter({ fetch: globalThis.fetch, loadAccount: createAccountHttpAdapter({ states: ['ready', 'no-entitlement'] }).loadAccount }),
    navigation: [
      { key: 'brief', label: 'Your car brief', available: true, icon: ['M6 3h12v18H6z', 'M9 8h6', 'M9 12h6', 'M9 16h4'] },
      { key: 'activity', label: 'Buddy activity', available: true, icon: ['M4 5h16', 'M4 12h16', 'M4 19h16', 'M8 3v4', 'M8 10v4', 'M8 17v4'] },
      ORDER_PROGRESS_DESTINATION,
    ] };
  host.addEventListener('gcsp:navigate', (event) => {
    const page = { brief: '/gcsp-brief-live.html', activity: '/gcsp-activity-live.html' }[event.detail?.to];
    if (page) { event.preventDefault(); globalThis.location.assign(page); }
  });
  globalThis.addEventListener('pageshow', (event) => { if (event.persisted) host.refresh(); });
}
