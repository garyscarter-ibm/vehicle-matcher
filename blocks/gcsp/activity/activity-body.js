// Representative supplied projection only; saved commands and offer access remain host responsibilities.
import { el, screenIntro, button, statusScreen } from '../../vehicle-matcher/ui.js';
import { svgIcon } from '../shell/portal-shell.js';
import { activityTimeline } from '../kit/activity-timeline.js';
import { actionMenu } from '../kit/action-menu.js';
import { activityOffer } from './activity-offer.js';
import { activityCopy as copy, activityEvents } from './activity-copy.js';

export function activityBody({ result, onRetry, offerDisplay, level = 1 } = {}) {
  const root = el('div', 'vm gcsp-activity'); root.destroy = () => {};
  const header = el('div', 'gcsp-activity-header');
  header.append(screenIntro({ title: copy.title, level, className: 'gcsp-activity-intro' })); root.append(header);
  if (result?.status !== 'ok' || !result.value) {
    root.append(statusScreen({ title: 'Activity unavailable', message: copy.unavailable, role: 'alert',
      actions: [button({ label: 'Retry', onClick: onRetry, disabled: typeof onRetry !== 'function' })] }));
    return root;
  }
  const value = result.value;
  if (!value.permission) { root.append(statusScreen({ title: 'No confirmed search', message: 'Confirm a search brief to begin.' })); return root; }
  const paused = value.permission.paused === true;
  const inactive = paused || value.permission.canSearch !== true;
  const status = el('p', `gcsp-activity-status${inactive ? ' is-inactive' : ''}`); status.setAttribute('role', 'status');
  status.append(svgIcon(inactive ? ['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18', 'M9 8v8', 'M15 8v8']
    : ['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18', 'M8 12l3 3 5-6']), document.createTextNode(inactive ? 'Inactive' : 'Active'));
  const actions = actionMenu({ label: 'Search actions', items: [{ label: paused ? 'Resume Search' : 'Pause Search', disabled: true, reason: 'Preview only' }] });
  const state = el('div', 'gcsp-activity-state'); state.append(status, actions.root); header.append(state);
  root.destroy = actions.destroy;
  if (paused) root.append(el('p', 'gcsp-activity-consequence', copy.pausedDetail));
  // Explicit selected reference only. Identifier order never establishes the current offer.
  const selected = offerDisplay?.offerRef?.offerId;
  const offer = selected ? value.offers?.find((entry) => entry.offerRef?.offerId === selected) : null;
  root.append(activityOffer({ offer, display: offer ? offerDisplay : undefined, level: Math.min(level + 1, 6),
    emptyText: value.offers?.length ? 'Current offer unavailable' : 'No current offer' }));
  const feed = activityTimeline({ events: activityEvents(value.stateChanges), heading: 'Activity', level: Math.min(level + 1, 6) });
  const checks = el('div', 'gcsp-activity-check-status');
  checks.append(el('p', '', copy.lastCheckMissing), el('p', '', copy.checkMissing));
  feed.querySelector('.gcsp-timeline-note').after(checks); root.append(feed);
  if (value.stateChangesEvidence?.status === 'incomplete') feed.append(el('p', 'gcsp-activity-secondary', 'Some activity could not be verified.'));
  return root;
}
