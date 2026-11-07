import { mountOfferEntry } from './entry.js';

const host = document.querySelector('gcsp-offer');
if (host) {
  const dispose = mountOfferEntry(host);
  globalThis.addEventListener('pagehide', dispose, { once: true });
}
