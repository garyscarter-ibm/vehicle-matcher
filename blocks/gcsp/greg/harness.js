import './publish/register.js';
// Harness only: ?fixture= picks a dashboard fixture and ?plan= an order plan state. The elements never read location.
import { el } from '../../vehicle-matcher/ui.js';
import { defineGcspGregDashboard } from './gcsp-greg.js';
import { FIXTURE_NAMES } from './fixtures.js';
import { FIXTURE_NAMES as PLAN_FIXTURES } from './plan/fixtures.js';
import { driveToState } from './plan/gallery.js';
import './plan/register.js';
import '../cases/register.js';

const params = new URLSearchParams(globalThis.location?.search || '');
const requested = params.get('fixture');
const plan = params.get('plan');
const host = document.querySelector('gcsp-greg-dashboard');
host?.addEventListener('gcsp:ready', (event) => {
  if (event.target !== host) return;
  const region = host.regions?.caseQueue;
  if (region) {
    const queue = el('gcsp-case-queue');
    queue.setAttribute('embedded', '');
    region.removeAttribute('aria-labelledby');
    region.setAttribute('aria-label', 'Renewal cases');
    region.replaceChildren(queue);
  }
  const planRegion = host.regions?.prediction;
  if (planRegion && PLAN_FIXTURES.includes(plan)) {
    const panel = el('gcsp-greg-order-plan');
    panel.setAttribute('fixture', plan);
    planRegion.removeAttribute('aria-labelledby');
    planRegion.setAttribute('aria-label', 'Next order plan');
    planRegion.replaceChildren(panel);
    driveToState(panel, plan);
  }
});
if (host && FIXTURE_NAMES.includes(requested)) host.setAttribute('fixture', requested);
defineGcspGregDashboard();
