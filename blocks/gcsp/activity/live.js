import { createAccountHttpAdapter } from '../shell/account-runtime.js';
import { createActivityHttpAdapter } from './activity-http.js';
import { createCaseHttpAdapter } from '../cases/http-adapter.js';
import { ACTIVITY_DESTINATION, defineGcspActivity } from './gcsp-activity.js';

const host = globalThis.document?.querySelector('gcsp-activity[data-live]');
if (host) {
  defineGcspActivity();
  host.helpAdapter = createCaseHttpAdapter();
  host.adapter = { ...createActivityHttpAdapter({ fetch: globalThis.fetch, loadAccount: createAccountHttpAdapter().loadAccount }),
    navigation: [
      { key: 'brief', label: 'Your car brief', available: true, icon: ['M6 3h12v18H6z', 'M9 8h6', 'M9 12h6', 'M9 16h4'] },
      ACTIVITY_DESTINATION,
    ] };
  host.addEventListener('gcsp:navigate', (event) => {
    if (event.detail?.to === 'brief') {
      event.preventDefault(); globalThis.location.assign('/gcsp-brief-live.html');
    }
  });
  globalThis.addEventListener('pageshow', (event) => { if (event.persisted) host.refresh(); });
}
