import { defineGcspOffer } from './gcsp-offer.js';
import { FIXTURE_NAMES, HANDOFF_NAMES, offerFixture } from './fixtures.js';
import { createOfferHttpAdapter } from './http-adapter.js';

const host = document.querySelector('gcsp-offer');
const requested = new URLSearchParams(globalThis.location?.search || '').get('fixture');
if (host && FIXTURE_NAMES.includes(requested)) {
  let shown = requested;
  host.adapter = { read: requested === 'loading' ? ({ signal }) => new Promise((resolve, reject) => {
    signal.addEventListener('abort', () => reject(new Error('Preview closed')), { once: true });
  }) : async () => requested === 'error' ? { status: 'unavailable' } : offerFixture(shown),
  // Preview only: accepting the offer swaps to its acknowledged selection. Nothing is sent.
  ...HANDOFF_NAMES.includes(requested) ? { decide: async ({ kind }) => { if (kind === 'accept') shown = 'selection-hr'; return { status: 'ok' }; } } : {},
  account: { status: 'ready', name: 'Paula Mason', scheme: 'Choices' } };
} else if (host) host.adapter = createOfferHttpAdapter();
defineGcspOffer();
