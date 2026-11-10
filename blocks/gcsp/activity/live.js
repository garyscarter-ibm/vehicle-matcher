import { createAccountHttpAdapter } from '../shell/account-runtime.js';
import { createActivityHttpAdapter } from './activity-http.js';
import { createCaseHttpAdapter } from '../cases/http-adapter.js';
import { subscribePresenterActions } from '../kit/presenter-actions.js';
import { routePortalEvents } from '../employee/portal-navigation.js';
import { createNotificationSource } from './notification-source.js';
import { defineGcspActivity } from './gcsp-activity.js';

const host = globalThis.document?.querySelector('gcsp-activity[data-live]');
if (host) {
  defineGcspActivity();
  host.helpAdapter = createCaseHttpAdapter();
  const activity = createActivityHttpAdapter({ fetch: globalThis.fetch, loadAccount: createAccountHttpAdapter().loadAccount });
  host.adapter = { ...activity, subscribeClock: subscribePresenterActions(host),
    notifications: createNotificationSource({ adapter: activity, subscribe: subscribePresenterActions(host) }) };
  routePortalEvents(host);
  globalThis.addEventListener('pageshow', (event) => { if (event.persisted) host.refresh(); });
}
