import { createAccountHttpAdapter } from '../shell/account-runtime.js';
import { createActivityHttpAdapter } from './activity-http.js';
import { createCaseHttpAdapter } from '../cases/http-adapter.js';
import { subscribePresenterActions } from '../presenter-controls/controls.js';
import { routePortalEvents } from '../employee/portal-navigation.js';
import { defineGcspActivity } from './gcsp-activity.js';

const host = globalThis.document?.querySelector('gcsp-activity[data-live]');
if (host) {
  defineGcspActivity();
  host.helpAdapter = createCaseHttpAdapter();
  host.adapter = { ...createActivityHttpAdapter({ fetch: globalThis.fetch, loadAccount: createAccountHttpAdapter().loadAccount }),
    subscribeClock: subscribePresenterActions(host) };
  routePortalEvents(host);
  globalThis.addEventListener('pageshow', (event) => { if (event.persisted) host.refresh(); });
}
