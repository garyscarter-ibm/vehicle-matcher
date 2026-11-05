import { defineGcspOffer } from './gcsp-offer.js';
import { FIXTURE_NAMES, offerFixture } from './fixtures.js';

const host = document.querySelector('gcsp-offer');
const requested = new URLSearchParams(globalThis.location?.search || '').get('fixture');
if (host && FIXTURE_NAMES.includes(requested)) {
  host.adapter = { read: requested === 'loading' ? ({ signal }) => new Promise((resolve, reject) => {
    signal.addEventListener('abort', () => reject(new Error('Preview closed')), { once: true });
  }) : async () => requested === 'error' ? { status: 'unavailable' } : offerFixture(requested),
  notice: 'Synthetic presentation example. This page does not read a real offer or record a decision.',
  account: { status: 'ready', name: 'Synthetic presentation example', scheme: 'Choices' } };
}
defineGcspOffer();
