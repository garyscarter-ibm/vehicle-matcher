// Harness only: ?fixture= picks a named fixture. The element itself never reads location.
import { el } from '../../vehicle-matcher/ui.js';
import { defineGcspGregDashboard } from './gcsp-greg.js';
import { FIXTURE_NAMES } from './fixtures.js';
import '../cases/register.js';

const requested = new URLSearchParams(globalThis.location?.search || '').get('fixture');
const host = document.querySelector('gcsp-greg-dashboard');
host?.addEventListener('gcsp:ready', (event) => {
  if (event.target !== host) return;
  const region = host.regions?.caseQueue;
  if (!region) return;
  const queue = el('gcsp-case-queue');
  queue.setAttribute('embedded', '');
  region.removeAttribute('aria-labelledby');
  region.setAttribute('aria-label', 'Renewal cases');
  region.replaceChildren(queue);
});
if (host && FIXTURE_NAMES.includes(requested)) host.setAttribute('fixture', requested);
defineGcspGregDashboard();
