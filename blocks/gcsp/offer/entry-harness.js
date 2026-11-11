import { mountOfferEntry } from './entry.js';

const host = document.querySelector('gcsp-offer');
if (host) {
  const dispose = mountOfferEntry(host);
  // A page kept for Back/Forward stays mounted: its session lifecycle clears it now and reloads it on restore.
  globalThis.addEventListener('pagehide', (event) => { if (!event.persisted) dispose(); });
}
