import { defineGcspHelp } from './gcsp-help.js';
import { routePortalEvents } from '../employee/portal-navigation.js';
import { fixtureAdapter, fixtureAccountAdapter, FIXTURE_NAMES } from './fixtures.js';
const host = document.querySelector('gcsp-help');
const requested = new URLSearchParams(globalThis.location?.search ?? '').get('fixture');
if (host) routePortalEvents(host);
if (host && FIXTURE_NAMES.includes(requested)) {
  host.adapter = fixtureAdapter(requested);
  host.accountAdapter = fixtureAccountAdapter;
}
defineGcspHelp();
