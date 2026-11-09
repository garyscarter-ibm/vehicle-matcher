import './publish/register.js';
// Harness only: ?fixture= picks a dashboard fixture, ?plan= an order plan state and ?comparison= a route comparison state. The elements never read location.
import { el } from '../../vehicle-matcher/ui.js';
import { defineGcspGregDashboard } from './gcsp-greg.js';
import { FIXTURE_NAMES } from './fixtures.js';
import { FIXTURE_NAMES as PLAN_FIXTURES } from './plan/fixtures.js';
import { driveToState } from './plan/gallery.js';
import './plan/register.js';
import { FIXTURE_NAMES as COMPARISON_FIXTURES, EXPERIMENT_FIXTURE_NAMES } from './comparison/fixtures.js';
import './comparison/register.js';
import '../cases/register.js';

const params = new URLSearchParams(globalThis.location?.search || '');
const requested = params.get('fixture');
const plan = params.get('plan');
const comparison = params.get('comparison');
const host = document.querySelector('gcsp-greg-dashboard');
function addFixtureNotice() {
  const page = host?.querySelector('.gcsp-greg');
  if (!page || page.querySelector('.gcsp-fixture-notice')) return;
  const notice = el('div', 'gcsp-greg-bar gcsp-fixture-notice');
  notice.setAttribute('role', 'note');
  const link = el('a', '', 'Open Greg\u2019s live view in the presenter workspace');
  link.href = './gcsp-presenter.html';
  notice.append(el('p', 'gcsp-note', 'This is a fixture gallery. Every figure is made up, and panels marked as not built are not wired to the live demo.'), link);
  page.prepend(notice);
}
addFixtureNotice();
host?.addEventListener('gcsp:ready', (event) => {
  if (event.target !== host) return;
  addFixtureNotice();
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
  const comparisonRegion = host.regions?.routeComparison;
  if (comparisonRegion && (COMPARISON_FIXTURES.includes(comparison) || EXPERIMENT_FIXTURE_NAMES.includes(comparison))) {
    const panel = el('gcsp-greg-comparison');
    panel.setAttribute('fixture', comparison);
    comparisonRegion.removeAttribute('aria-labelledby');
    comparisonRegion.setAttribute('aria-label', 'Route comparison');
    comparisonRegion.replaceChildren(panel);
  }
});
if (host && FIXTURE_NAMES.includes(requested)) host.setAttribute('fixture', requested);
defineGcspGregDashboard();
