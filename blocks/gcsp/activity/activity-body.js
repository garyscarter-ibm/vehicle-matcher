// Representative supplied projection only; saved commands and offer access remain host responsibilities.
import { el, screenIntro, button, statusScreen } from '../../vehicle-matcher/ui.js';
import { svgIcon } from '../shell/portal-shell.js';
import { activityTimeline } from '../kit/activity-timeline.js';
import { actionMenu } from '../kit/action-menu.js';
import { activityOffer } from './activity-offer.js';
import { activityCopy as copy, activityEvents, searchLines, exclusionLines } from './activity-copy.js';

let noteIds = 0;
// Names the excluding essentials and offers two next steps; neither changes the brief.
function nextSteps(lines, onReviewBrief) {
  const box = el('div', 'gcsp-activity-why'); box.setAttribute('aria-live', 'polite');
  box.append(...lines.map((line) => el('p', '', line)));
  const actions = el('div', 'gcsp-activity-next'); const reviewable = typeof onReviewBrief === 'function';
  const review = button({ label: copy.reviewBrief, variant: 'ghost', onClick: reviewable ? () => onReviewBrief() : undefined, disabled: !reviewable });
  const keep = button({ label: copy.keepSearching, variant: 'ghost', onClick: () => {
    const note = el('p', 'gcsp-activity-secondary', copy.keepNote); note.setAttribute('role', 'status');
    keep.replaceWith(note); if (!reviewable) note.tabIndex = -1; (reviewable ? review : note).focus();
  } });
  if (!reviewable) {
    const reason = el('span', 'gcsp-vh', copy.previewOnly); reason.id = `gcsp-activity-preview-${noteIds += 1}`;
    review.setAttribute('aria-describedby', reason.id); actions.append(keep, review, reason);
  } else actions.append(keep, review);
  box.append(actions); return box;
}

export function activityBody({ result, onRetry, onPause, onResume, onReviewBrief, pending = false, offerDisplay, level = 1 } = {}) {
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
  // An accepted car ends the search, so it reads finished and offers no pause or resume.
  const finished = value.currentOffer?.state === 'accepted';
  const inactive = finished || paused || value.permission.canSearch !== true;
  const status = el('p', `gcsp-activity-status${inactive ? ' is-inactive' : ''}`); status.setAttribute('role', 'status');
  status.append(svgIcon(inactive && !finished ? ['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18', 'M9 8v8', 'M15 8v8']
    : ['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18', 'M8 12l3 3 5-6']), document.createTextNode(finished ? copy.finished : inactive ? 'Inactive' : 'Active'));
  const state = el('div', 'gcsp-activity-state'); state.append(status); header.append(state);
  if (!finished) {
    const command = paused ? onResume : onPause;
    const allowed = paused || value.permission.canSearch === true;
    const disabled = pending || !allowed || typeof command !== 'function';
    const reason = pending ? 'Updating search' : !allowed ? 'Search unavailable' : typeof command !== 'function' ? 'Preview only' : undefined;
    const actions = actionMenu({ label: 'Search actions', items: [{ label: paused ? 'Resume Search' : 'Pause Search', disabled, reason, onSelect: command }] });
    state.append(actions.root); root.destroy = actions.destroy;
  }
  // The server names the current offer; display data (imagery, title) applies only when it references that offer.
  const offer = value.currentOffer || null;
  if (paused) root.append(el('p', 'gcsp-activity-consequence', offer?.state === 'active' ? `${copy.pausedDetail} ${copy.pausedOffer}` : copy.pausedDetail));
  const display = offer && offerDisplay?.offerRef?.offerId === offer.offerRef?.offerId ? offerDisplay : undefined;
  root.append(activityOffer({ offer, display, level: Math.min(level + 1, 6) }));
  const feed = activityTimeline({ events: activityEvents(value.stateChanges), heading: 'Activity', level: Math.min(level + 1, 6) });
  const lines = searchLines(value, paused);
  if (lines.length) { const checks = el('div', 'gcsp-activity-check-status'); checks.append(...lines.map((line) => el('p', '', line)));
    feed.querySelector('.gcsp-timeline-note').after(checks); }
  const why = exclusionLines(value, paused);
  if (why.length) { const checks = feed.querySelector('.gcsp-activity-check-status');
    if (checks) checks.after(nextSteps(why, onReviewBrief)); else feed.append(nextSteps(why, onReviewBrief)); }
  root.append(feed);
  if (value.stateChangesEvidence?.status === 'incomplete') feed.append(el('p', 'gcsp-activity-secondary', 'Some activity could not be verified.'));
  return root;
}
