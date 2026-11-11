// Read-only named snapshots are visual fixtures. Saved journeys always use the real HTTP adapter.
import { defineGcspAccount, mountAccount } from './gcsp-account.js';
import { accountFixture, FIXTURE_NAMES } from './fixtures.js';
import { mountManualJourney } from '../manual-setup/journey.js';
import { createOrderProgressHttpAdapter } from '../order-progress/order-progress-http.js';
import { createCaseHttpAdapter } from '../cases/http-adapter.js';
import { subscribePresenterActions } from '../kit/presenter-actions.js';
import { createActivityHttpAdapter } from '../activity/activity-http.js';
import { createNotificationSource } from '../activity/notification-source.js';
import { createBriefTransport } from '../brief/brief-transport.js';
import { mountAccountPreferences } from '../brief/account-preferences.js';
import { PREFERENCE_FIXTURE_STATES, previewPreferenceTransport, drivePreferenceState } from '../brief/account-preferences-fixtures.js';

const query = new URLSearchParams(globalThis.location?.search ?? '');
const requested = query.get('fixture'); const prefs = query.get('prefs'); const rating = Number.parseInt(query.get('rating') ?? '', 10);
// The saved record is always the live transport; ?prefs= swaps in an in-memory one for a named visual state.
const unavailableReason = { 'no-current-car': 'no-current-car', 'current-car-unidentified': 'current-car-unidentified' }[requested];
const previewPreferences = (state) => (region, { signal, describeCar }) => {
  const mounted = mountAccountPreferences(region, { transport: previewPreferenceTransport(state, { rating, sameAgainReason: unavailableReason, buddy: query.get('buddy') }), signal, describeCar });
  mounted.ready.then(() => drivePreferenceState(mounted.controller, state));
  return mounted;
};
const host = document.querySelector('gcsp-account');
if (host && FIXTURE_NAMES.includes(requested)) {
  host.adapter = {
    readOnly: true,
    readAccount: async () => accountFixture(requested),
    readDraft: async () => ({ status: 'not-found' }),
    // FUCQ-370's engaged/disengaged previews read as the matching activity permission, so both Buddy readouts agree.
    readActivity: async () => ({ status: 'ok', value: { permission: ['active', 'engaged'].includes(query.get('buddy'))
      ? { paused: false, canSearch: true } : query.get('buddy') === 'paused' ? { paused: true, canSearch: false }
        : query.get('buddy') === 'disengaged' || (prefs && !query.get('buddy')) ? { paused: false, canSearch: false } : null } }),
    // ?offer=pending|declined|expired shows the newest offer in that state.
    ...(query.get('offer') ? { readOffers: async () => ({ status: 'ok', value: { offers: [{ offerId: 'offer-fixture', runId: 'run-fixture', state: query.get('offer') }] } }) } : {}),
    discardDraft: async () => ({ status: 'unavailable', code: 'read-only-visual-fixture' }),
    startJourney: async () => ({ status: 'unavailable', code: 'read-only-visual-fixture' }),
  };
  if (PREFERENCE_FIXTURE_STATES.includes(prefs)) mountAccount(host, { adapter: host.adapter, brand: host.getAttribute('brand') ?? 'bmw', preferences: previewPreferences(prefs) });
  else defineGcspAccount();
} else if (host) {
  mountManualJourney(host, { orderAdapter: createOrderProgressHttpAdapter(), helpAdapter: createCaseHttpAdapter(),
    subscribeClock: subscribePresenterActions(host),
    preferences: (region, { signal, describeCar }) => mountAccountPreferences(region, { transport: createBriefTransport({ signal }), signal, describeCar }),
    notifications: createNotificationSource({ adapter: createActivityHttpAdapter(), subscribe: subscribePresenterActions(host) }),
    onSupport: () => globalThis.location.assign(new URL('../../../gcsp-help.html', import.meta.url).href) });
}
