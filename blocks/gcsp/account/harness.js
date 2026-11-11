// Read-only named snapshots are visual fixtures. Saved journeys always use the real HTTP adapter.
import { defineGcspAccount, mountAccount } from './gcsp-account.js';
import { accountFixture, FIXTURE_NAMES } from './fixtures.js';
import { mountManualJourney } from '../manual-setup/journey.js';
import { createOrderProgressHttpAdapter } from '../order-progress/order-progress-http.js';
import { createCaseHttpAdapter } from '../cases/http-adapter.js';
import { subscribePresenterActions } from '../kit/presenter-actions.js';
import { activityFixtures } from '../activity/activity-fixtures.js';
import { createActivityHttpAdapter } from '../activity/activity-http.js';
import { createNotificationSource } from '../activity/notification-source.js';
import { createBriefTransport } from '../brief/brief-transport.js';
import { mountAccountPreferences } from '../brief/account-preferences.js';
import { PREFERENCE_FIXTURE_STATES, previewPreferenceTransport, drivePreferenceState } from '../brief/account-preferences-fixtures.js';

const query = new URLSearchParams(globalThis.location?.search ?? '');
const requested = query.get('fixture'); const prefs = query.get('prefs'); const rating = Number.parseInt(query.get('rating') ?? '', 10);
// The saved record is always the live transport; ?prefs= swaps in an in-memory one for a named visual state.
const unavailableReason = { 'no-current-car': 'no-current-car', 'current-car-unidentified': 'current-car-unidentified' }[requested];
const previewBuddy = query.get('buddy') ?? (['inactive', 'setup', 'paused', 'paused-offer'].includes(query.get('activity')) ? 'disengaged'
  : ['unavailable', 'loading'].includes(query.get('activity')) ? 'unknown' : 'engaged');
const previewPreferences = (state) => (region, { signal, describeCar, buddyControls }) => {
  const mounted = mountAccountPreferences(region, { transport: previewPreferenceTransport(state, { rating, sameAgainReason: unavailableReason, buddy: previewBuddy }), signal, describeCar, buddyControls });
  mounted.ready.then(() => drivePreferenceState(mounted.controller, state));
  return mounted;
};
const host = document.querySelector('gcsp-account');
if (host && FIXTURE_NAMES.includes(requested)) {
  host.adapter = {
    readOnly: true,
    readAccount: async () => accountFixture(requested),
    readDraft: async () => ({ status: 'not-found' }),
    // ?offer=pending|declined|expired shows the newest offer in that state.
    ...(query.get('offer') ? { readOffers: async () => ({ status: 'ok', value: { offers: [{ offerId: 'offer-fixture', runId: 'run-fixture', state: query.get('offer') }] } }) } : {}),
    discardDraft: async () => ({ status: 'unavailable', code: 'read-only-visual-fixture' }),
    startJourney: async () => ({ status: 'unavailable', code: 'read-only-visual-fixture' }),
  };
  const buddyFixture = query.get('activity') ?? 'never-checked';
  const previewActivity = structuredClone(activityFixtures.snapshots[buddyFixture] ?? activityFixtures.snapshots['never-checked']);
  if (buddyFixture === 'setup') Object.assign(previewActivity.value, { permission: null, briefVersion: null, stateChanges: [], state: 'no-brief' });
  if (buddyFixture === 'inactive') Object.assign(previewActivity.value.permission, { paused: false, searchConsent: false, holdConsent: false, canSearch: false, canHold: false });
  if (buddyFixture === 'finished') {
    Object.assign(previewActivity, structuredClone(activityFixtures.snapshots.offer));
    previewActivity.value.currentOffer.state = 'accepted'; previewActivity.value.offers[0].state = 'accepted';
  }
  const activityAdapter = { readActivity: async ({ signal } = {}) => buddyFixture === 'loading'
    ? new Promise((resolve) => signal?.addEventListener('abort', () => resolve({ status: 'unavailable' }), { once: true })) : structuredClone(previewActivity),
    readOfferDisplay: async () => structuredClone(activityFixtures.offerExample) };
  if (PREFERENCE_FIXTURE_STATES.includes(prefs)) mountAccount(host, { adapter: host.adapter, activityAdapter, brand: host.getAttribute('brand') ?? 'bmw', preferences: previewPreferences(prefs) });
  else defineGcspAccount();
} else if (host) {
  mountManualJourney(host, { activityAdapter: createActivityHttpAdapter(), orderAdapter: createOrderProgressHttpAdapter(), helpAdapter: createCaseHttpAdapter(),
    subscribeClock: subscribePresenterActions(host),
    preferences: (region, { signal, describeCar, buddyControls }) => mountAccountPreferences(region, { transport: createBriefTransport({ signal }), signal, describeCar, buddyControls }),
    notifications: createNotificationSource({ adapter: createActivityHttpAdapter(), subscribe: subscribePresenterActions(host) }),
    onSupport: () => globalThis.location.assign(new URL('../../../gcsp-help.html', import.meta.url).href) });
}
