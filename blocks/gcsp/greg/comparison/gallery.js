// Synthetic states for the component gallery and the fixture harness. Never selected by the live dashboard.
import { el, screenIntro } from '../../../vehicle-matcher/ui.js';
import { mountGregComparison } from './panel.js';
import { comparisonFixtureAdapter } from './fixtures.js';

export function gregComparisonExample() {
  const section = el('section', 'vm-gallery-section gcsp');
  section.append(screenIntro({ kicker: 'GCSP kit', title: 'Greg route comparison: fixture', level: 2,
    lede: 'Synthetic states from fixtures. These panels do not call the comparison service.' }));
  for (const [name, title] of [['buddy-better', 'Buddy route better on some measures'], ['no-clear-difference', 'No clear difference'],
    ['today-better', "Today's release route better on some measures"], ['old-policy', 'Older policy version'], ['empty', 'No stored comparison yet']]) {
    const group = el('div', 'vm-gallery-gcsp-group'); const host = el('div', '');
    group.append(el('h3', 'vm-gallery-gcsp-title', title), host); section.append(group);
    mountGregComparison(host, { adapter: comparisonFixtureAdapter(name) });
  }
  const links = el('p', 'gcsp-note', 'Every state on the dashboard harness: ');
  for (const name of ['loading', 'buddy-better', 'no-clear-difference', 'today-better', 'old-policy', 'empty', 'unavailable', 'refused']) {
    const link = el('a', '', name); link.href = `./gcsp-greg.html?fixture=populated&comparison=${name}`; links.append(link, ' ');
  }
  section.append(links);
  return section;
}
