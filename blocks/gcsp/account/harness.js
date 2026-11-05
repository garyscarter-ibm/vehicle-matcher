// Read-only named snapshots are visual fixtures. Saved journeys always use the real HTTP adapter.
import { defineGcspAccount } from './gcsp-account.js';
import { accountFixture, FIXTURE_NAMES } from './fixtures.js';
import { mountManualJourney } from '../manual-setup/journey.js';

const requested = new URLSearchParams(globalThis.location?.search ?? '').get('fixture');
const host = document.querySelector('gcsp-account');
if (host && FIXTURE_NAMES.includes(requested)) {
  host.adapter = {
    readAccount: async () => accountFixture(requested),
    readDraft: async () => ({ status: 'not-found' }),
    startJourney: async () => ({ status: 'unavailable', code: 'read-only-visual-fixture' }),
  };
  defineGcspAccount();
} else if (host) {
  mountManualJourney(host);
}
