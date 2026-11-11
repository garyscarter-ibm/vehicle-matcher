import { defineGcspOffer } from './gcsp-offer.js';
import { FIXTURE_NAMES, HANDOFF_NAMES, offerFixture } from './fixtures.js';
import { createOfferHttpAdapter } from './http-adapter.js';
import { signedInPortal } from './portal-links.js';

const host = document.querySelector('gcsp-offer');
const requested = new URLSearchParams(globalThis.location?.search || '').get('fixture');
if (host && FIXTURE_NAMES.includes(requested)) {
  let shown = requested;
  const account = { status: 'ready', name: 'Paula Mason', scheme: 'Choices' };
  const readFixture = () => {
    const result = offerFixture(shown);
    if (requested === 'fuller-offer' && shown !== requested) result.value.card = offerFixture(requested).value.card;
    return result;
  };
  host.adapter = { read: requested === 'loading' ? ({ signal }) => new Promise((resolve, reject) => {
    signal.addEventListener('abort', () => reject(new Error('Preview closed')), { once: true });
  }) : async () => requested === 'error' ? { status: 'unavailable' } : readFixture(),
  // Preview only: accepting the offer swaps to its acknowledged selection. Nothing is sent.
  ...HANDOFF_NAMES.includes(requested) ? { decide: async ({ kind }) => { shown = kind === 'accept' ? 'selection-hr' : 'declined'; return { status: 'ok' }; } } : {},
  ...requested === 'fuller-offer' ? { readReasons: async () => ({ status: 'ok', value: { schemaVersion: 1, key: 'offer.declineReasons.v1', policyVersion: 'presentation-example',
    reasons: [{ code: 'body', label: 'Body style', attribute: 'body' }, { code: 'comfort', label: 'Comfort', attribute: 'comfort' }, { code: 'sportiness', label: 'Sportiness', attribute: 'sportiness' }] } }) } : {},
  account, signOut: false, ...signedInPortal(account, globalThis.location) };
} else if (host) host.adapter = createOfferHttpAdapter();
defineGcspOffer();
