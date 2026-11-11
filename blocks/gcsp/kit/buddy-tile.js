import { el, button } from '../../vehicle-matcher/ui.js';
import { buddyState, buddyStatus } from './buddy-status.js';
import { activityTimeline } from './activity-timeline.js';

let sequence = 0;
const descriptions = { active: 'Watching for cars that match your preferences.', paused: 'New searches and holds have stopped.',
  unset: 'Choose your preferences, then engage Buddy.', finished: 'You accepted a car. Your search is finished.',
  inactive: 'Search permission is off. Engage Buddy in your preferences to search again.', unavailable: 'Search status is unavailable. Try again.' };

// Presentation only. The host supplies authoritative activity, commands and drawer actions.
export function buddyTile({ id = `gcsp-buddy-tile-${++sequence}`, onPause, onResume, onRetry, onHistory, onDetails, onOffer, onPreferences, orderHref } = {}) {
  const root = el('section', 'gcsp-buddy-tile'); const title = el('h2', 'gcsp-h2', 'Your buddy');
  title.id = `${id}-title`; root.setAttribute('aria-labelledby', title.id);
  let focusKey;
  const action = (label, key, onClick, disabled = false) => {
    const node = button({ label, variant: 'ghost', onClick, disabled: disabled || typeof onClick !== 'function' });
    node.dataset.focusKey = key; return node;
  };
  function update({ phase = 'loading', result, pending = false, events = [], offerTitle, deadline } = {}) {
    const active = root.ownerDocument.activeElement;
    if (root.contains(active)) focusKey = active.dataset.focusKey;
    let state = phase === 'ready' ? buddyState(result) : phase === 'loading' ? 'loading' : 'unavailable';
    if (state === 'inactive' && result?.value?.permission?.paused === true && result.value.permission.searchConsent && result.value.permission.holdConsent) state = 'paused';
    root.dataset.state = state; root.setAttribute('aria-busy', String(pending || state === 'loading'));
    const header = el('div', 'gcsp-buddy-tile-head'); header.append(title);
    const status = el('p', 'gcsp-buddy-tile-status'); status.id = id;
    if (state === 'loading') status.textContent = 'Loading Buddy activity.';
    else { const marker = buddyStatus({ state }); if (state === 'paused') marker.lastChild.textContent = 'Paused'; status.append(marker); }
    header.append(status); root.replaceChildren(header);
    if (state === 'loading') return;
    const value = result?.value; const held = value?.currentOffer?.state === 'active';
    const detail = state === 'active' && value?.sourceStatus === 'unavailable' ? 'Cars could not be checked. Open search details.'
      : state === 'active' && value?.sourceStatus === 'delayed' ? 'Waiting for stock data. Open search details.' : descriptions[state];
    root.append(el('p', 'gcsp-note', detail));
    const commands = el('div', 'gcsp-buddy-tile-actions');
    if (['active', 'paused'].includes(state)) commands.append(action(state === 'paused' ? 'Resume search' : 'Pause search', 'buddy-search-action', state === 'paused' ? onResume : onPause, pending));
    else if (state === 'unavailable') commands.append(action('Try again', 'buddy-retry', onRetry, pending));
    else if (state === 'unset' || state === 'inactive') commands.append(action('Review your preferences', 'buddy-preferences', onPreferences));
    else if (state === 'finished' && orderHref) {
      const track = button({ label: 'Track your order', href: orderHref, variant: 'ghost' }); track.dataset.focusKey = 'buddy-order'; commands.append(track);
    }
    if (held && state !== 'unavailable') {
      const offer = el('div', 'gcsp-buddy-tile-offer');
      offer.append(el('h3', 'gcsp-buddy-tile-offer-title', 'A car is held for you'),
        ...(offerTitle ? [el('p', '', offerTitle)] : []), ...(deadline ? [el('p', 'gcsp-note', deadline)] : []),
        ...(state === 'paused' ? [el('p', 'gcsp-note', 'Pausing keeps this offer open.')] : []), action('View held offer', 'buddy-offer', onOffer));
      root.append(offer);
    }
    if (commands.childElementCount) root.append(commands);
    if (state !== 'unavailable') {
      root.append(activityTimeline({ events: events.slice(0, 2), heading: 'Recent activity', emptyText: 'No activity is recorded yet.', level: 3 }));
      const links = el('div', 'gcsp-buddy-tile-links');
      links.append(action('Buddy history', 'buddy-history', onHistory), action('Search details', 'buddy-details', onDetails)); root.append(links);
      if (value?.stateChangesEvidence?.status === 'incomplete') root.append(el('p', 'gcsp-note', 'Some activity could not be verified.'));
    }
    if (focusKey && (!active?.isConnected || root.ownerDocument.activeElement === root.ownerDocument.body)) {
      const next = [...root.querySelectorAll('[data-focus-key]')].find((node) => node.dataset.focusKey === focusKey && !node.disabled);
      if (next) { next.focus(); focusKey = null; }
      else if (!pending) { title.tabIndex = -1; title.focus(); focusKey = null; }
    }
  }
  update(); return { root, update };
}
