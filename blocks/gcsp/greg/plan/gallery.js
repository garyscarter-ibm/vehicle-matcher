// Synthetic states for the component gallery and the fixture harness. Never selected by the live dashboard.
import { el, screenIntro } from '../../../vehicle-matcher/ui.js';
import { mountGregOrderPlan } from './panel.js';
import { planFixtureAdapter } from './fixtures.js';

const DRIVEN = ['preview', 'infeasible', 'stale'];

/** Once the fixture plan has loaded, edit one bound and preview (or press Request for stale) to reach the named state. */
export function driveToState(host, name) {
  const page = host.querySelector('.gcsp-plan');
  if (!page || !DRIVEN.includes(name)) return;
  const act = () => {
    if (name === 'stale') { [...host.querySelectorAll('button')].find((b) => b.textContent.startsWith('Request '))?.click(); return; }
    const max = host.querySelectorAll('.gcsp-plan-limit input[type="number"]')[1];
    if (max) { max.value = String(Math.max(0, Number(max.value) - 1)); max.dispatchEvent(new max.ownerDocument.defaultView.Event('input', { bubbles: true })); }
    [...host.querySelectorAll('button')].find((b) => b.textContent === 'Preview with these limits')?.click();
  };
  const wait = (tries) => {
    if (page.dataset.state === 'ready') act(); else if (tries > 0) setTimeout(() => wait(tries - 1), 25);
  };
  wait(80);
}

export function gregOrderPlanExample() {
  const section = el('section', 'vm-gallery-section gcsp');
  section.append(screenIntro({ kicker: 'GCSP kit', title: 'Greg order plan: fixture', level: 2,
    lede: 'Synthetic states from fixtures. These panels do not call the order plan service.' }));
  for (const [name, title] of [['ready', 'Plan ready, with a long derivative name'], ['preview', 'Preview after a changed bound'],
    ['infeasible', 'Infeasible preview'], ['stale', 'Replan needed']]) {
    const group = el('div', 'vm-gallery-gcsp-group'); const host = el('div', '');
    group.append(el('h3', 'vm-gallery-gcsp-title', title), host); section.append(group);
    mountGregOrderPlan(host, { adapter: planFixtureAdapter(name), commandId: () => `gallery-${name}` });
    driveToState(host, name);
  }
  const links = el('p', 'gcsp-note', 'Every state on the dashboard harness: ');
  for (const name of ['loading', 'ready', 'no-demand', 'preview', 'infeasible', 'stale', 'submitted', 'replanned', 'unavailable', 'refused']) {
    const link = el('a', '', name); link.href = `./gcsp-greg.html?fixture=populated&plan=${name}`; links.append(link, ' ');
  }
  section.append(links);
  return section;
}
