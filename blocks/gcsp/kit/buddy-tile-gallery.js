import { el } from '../../vehicle-matcher/ui.js';
import { buddyTile } from './buddy-tile.js';
import { activityFixtures } from '../activity/activity-fixtures.js';
import { activityEvents, respondBy } from '../activity/activity-copy.js';

// Read-only component states; the live account owns adapters and drawer commands.
export function buddyTileExamples() {
  const root = el('section', 'vm-gallery-section gcsp'); root.id = 'gcsp-buddy-tile';
  root.append(el('h2', 'vm-gallery-title', 'GCSP Buddy tile'));
  const grid = el('div', 'vm vm-gallery-gcsp-whole');
  for (const name of ['active', 'paused', 'unset', 'held', 'unavailable', 'finished', 'inactive', 'loading']) {
    const result = structuredClone(activityFixtures.snapshots[name === 'paused' ? 'paused' : name === 'held' || name === 'finished' ? 'offer' : 'never-checked']);
    if (name === 'unset') Object.assign(result.value, { permission: null, stateChanges: [] });
    if (name === 'inactive') Object.assign(result.value.permission, { searchConsent: false, holdConsent: false, canSearch: false, canHold: false });
    if (name === 'finished') result.value.currentOffer.state = 'accepted';
    const tile = buddyTile({ id: `gallery-buddy-tile-${name}`, orderHref: '/gcsp-order-progress-live.html' });
    tile.update({ phase: name === 'loading' ? 'loading' : name === 'unavailable' ? 'unavailable' : 'ready', result,
      events: activityEvents(result.value.stateChanges).reverse(),
      ...(name === 'held' ? { offerTitle: activityFixtures.offerExample.title, deadline: respondBy(result.value.currentOffer) } : {}) });
    const example = el('div', 'vm-gallery-gcsp-group'); example.dataset.buddyTileExample = name;
    example.append(el('h3', 'vm-gallery-gcsp-title', name), tile.root); grid.append(example);
  }
  root.append(grid); return root;
}
