// Synthetic states for the component gallery and the fixture harness. Never selected by the live dashboard.
import { el, screenIntro } from '../../../vehicle-matcher/ui.js';
import { mountGregComparison } from './panel.js';
import { comparisonFixtureAdapter, experimentFixtureAdapter, EXPERIMENT_FIXTURE_NAMES } from './fixtures.js';

// Pick an experiment once the panel has drawn its picker (a few short tries).
function choose(host, id, tries = 20) {
  const option = host.querySelector(`[data-value="${id}"]`);
  if (option) option.click(); else if (tries > 0) setTimeout(() => choose(host, id, tries - 1), 50);
}
// A job that is already running when the panel mounts, so the gallery shows the strip without a click.
function primed(name) {
  const adapter = experimentFixtureAdapter(name);
  adapter.start({ experimentId: 'hold-sweep', change: { values: [3600, 10800], basis: 'Does a longer hold help?' } });
  return adapter;
}
const EXPERIMENT_STATES = [['experiments-ready', 'Hold duration stored result and rerun form', 'hold-sweep'], ['experiments-empty', 'No stored result, with the rerun form', 'hold-sweep'],
  ['experiments-old-policy', 'Hold duration result from an older policy', 'hold-sweep'], ['job-running', 'A hold comparison running, previous result kept', null], ['job-fails', 'A hold comparison that fails, previous result kept', null]];

export function gregComparisonExample() {
  const section = el('section', 'vm-gallery-section gcsp');
  section.append(screenIntro({ kicker: 'GCSP kit', title: 'Greg route comparison: fixture', level: 2,
    lede: 'Synthetic states from fixtures. These panels do not call the comparison service.' }));
  for (const [name, title] of [['buddy-better', 'Buddy route better on some measures'], ['no-clear-difference', 'No clear difference'],
    ['today-better', "Today's release route better on some measures"], ['old-policy', 'Older policy version'], ['empty', 'No comparison has been run for this demo yet']]) {
    const group = el('div', 'vm-gallery-gcsp-group'); const host = el('div', '');
    group.append(el('h3', 'vm-gallery-gcsp-title', title), host); section.append(group);
    mountGregComparison(host, { adapter: comparisonFixtureAdapter(name) });
  }
  for (const [name, title, pick] of EXPERIMENT_STATES) {
    const group = el('div', 'vm-gallery-gcsp-group'); const host = el('div', '');
    group.append(el('h3', 'vm-gallery-gcsp-title', title), host); section.append(group);
    mountGregComparison(host, { adapter: name === 'job-fails' ? primed(name) : experimentFixtureAdapter(name) });
    if (pick) choose(host, pick);
  }
  const links = el('p', 'gcsp-note', 'Every state on the dashboard harness: ');
  for (const name of ['loading', 'buddy-better', 'no-clear-difference', 'today-better', 'old-policy', 'empty', 'unavailable', 'refused', ...EXPERIMENT_FIXTURE_NAMES]) {
    const link = el('a', '', name); link.href = `./gcsp-greg.html?fixture=populated&comparison=${name}`; links.append(link, ' ');
  }
  section.append(links);
  return section;
}
