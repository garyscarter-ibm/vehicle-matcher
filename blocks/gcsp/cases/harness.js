import { defineGcspHelp } from './gcsp-help.js';
import { fixtureAdapter, fixtureAccountAdapter, FIXTURE_NAMES } from './fixtures.js';
const host = document.querySelector('gcsp-help');
const requested = new URLSearchParams(globalThis.location?.search ?? '').get('fixture');
host?.addEventListener('gcsp:navigate', ({ detail }) => {
  if (detail?.to === 'cars') globalThis.location.assign(new URL('../../../gcsp-account.html', import.meta.url).href);
});
if (host && FIXTURE_NAMES.includes(requested)) {
  host.adapter = fixtureAdapter(requested);
  host.accountAdapter = fixtureAccountAdapter;
}
defineGcspHelp();
