// Representative supplied projection only; saved commands and offer access remain host responsibilities.
import { el, screenIntro, button, statusScreen } from '../../vehicle-matcher/ui.js';
import { svgIcon } from '../shell/portal-shell.js';
import { activityTimeline } from '../kit/activity-timeline.js';
import { buddyEngaged, buddyState, buddyStatus } from '../kit/buddy-status.js';
import { activityOffer } from './activity-offer.js';
import { activityCopy as copy, activityEvents, searchLines, exclusionLines } from './activity-copy.js';

let noteIds = 0;
// Names the excluding essentials and offers two next steps; neither changes the brief.
function nextSteps(lines, onReviewBrief, announce) {
  const box = el('div', 'gcsp-activity-why');
  box.append(...lines.map((line) => el('p', '', line)));
  const actions = el('div', 'gcsp-activity-next'); const reviewable = typeof onReviewBrief === 'function';
  const review = button({ label: copy.reviewBrief, variant: 'ghost', onClick: reviewable ? () => onReviewBrief() : undefined, disabled: !reviewable });
  const keep = button({ label: copy.keepSearching, variant: 'ghost', onClick: () => {
    const note = el('p', 'gcsp-activity-secondary', copy.keepNote); if (announce) announce(copy.keepNote); else note.setAttribute('role', 'status');
    keep.replaceWith(note); if (!reviewable) note.tabIndex = -1; (reviewable ? review : note).focus();
  } });
  if (!reviewable) {
    const reason = el('span', 'gcsp-vh', copy.previewOnly); reason.id = `gcsp-activity-preview-${noteIds += 1}`;
    review.setAttribute('aria-describedby', reason.id); actions.append(keep, review, reason);
  } else actions.append(keep, review);
  box.append(actions); return box;
}

export function activityBody({ result, onRetry, onPause, onResume, onEngage, onDisengage, onReviewBrief, pending = false, offerDisplay, level = 1, announce } = {}) {
  // A host that passes announce owns the view's one live region, so nothing here is live.
  const hosted = typeof announce === 'function';
  const root = el('div', 'vm gcsp-activity'); root.destroy = () => {};
  const header = el('div', 'gcsp-activity-header');
  header.append(screenIntro({ title: copy.title, level, className: 'gcsp-activity-intro' })); root.append(header);
  if (buddyState(result) === 'unavailable') {
    if (hosted) announce(copy.unavailable);
    root.append(statusScreen({ title: 'Activity unavailable', message: copy.unavailable, role: hosted ? null : 'alert',
      actions: [button({ label: 'Retry', onClick: onRetry, disabled: typeof onRetry !== 'function' })] }));
    return root;
  }
  const value = result.value;
  const statusKey = buddyState(result);
  const state = el('div', 'gcsp-activity-state');
  const badge = buddyStatus({ state: statusKey }); badge.classList.add('gcsp-activity-status');
  state.append(badge); header.append(state);
  if (!value.permission) {
    const setup = button({ label: 'Set up your buddy', variant: 'ghost', onClick: onReviewBrief, disabled: typeof onReviewBrief !== 'function' });
    setup.classList.add('gcsp-buddy-action'); state.append(setup);
    root.append(statusScreen({ title: 'Set up your buddy', message: 'Choose your preferences to get started.', role: hosted ? null : 'status' })); return root;
  }
  const paused = !buddyEngaged(value.permission);
  // An accepted car ends the search and closes the Buddy controls.
  const finished = value.currentOffer?.state === 'accepted';
  if (!finished) {
    const command = paused ? (onEngage ?? onResume) : (onDisengage ?? onPause);
    const disabled = pending || typeof command !== 'function';
    const reason = pending ? 'Updating Buddy' : typeof command !== 'function' ? 'Preview only' : undefined;
    const action = button({ label: paused ? 'Engage Buddy' : 'Disengage Buddy', variant: 'ghost', disabled, onClick: command });
    action.classList.add('gcsp-buddy-action', 'gcsp-activity-search-action'); action.dataset.focusKey = 'buddy-search-action';
    action.prepend(svgIcon(paused ? ['m8 5 11 7-11 7Z'] : ['M8 5v14', 'M16 5v14']));
    if (reason) {
      const note = el('span', 'gcsp-vh', reason); note.id = `gcsp-search-action-${noteIds += 1}`;
      action.setAttribute('aria-describedby', note.id); state.append(note);
    }
    state.append(action);
  }
  // The server names the current offer; display data (imagery, title) applies only when it references that offer.
  const offer = value.currentOffer || null;
  if (paused) root.append(el('p', 'gcsp-activity-consequence', offer?.state === 'active' ? `${copy.pausedDetail} ${copy.pausedOffer}` : copy.pausedDetail));
  const display = offer && offerDisplay?.offerRef?.offerId === offer.offerRef?.offerId ? offerDisplay : undefined;
  const found = offer?.state === 'active';
  const news = activityOffer({ offer, display, level: Math.min(level + 1, 6) });
  const feed = activityTimeline({ events: activityEvents(value.stateChanges), heading: 'Activity', collapseRepeats: true, level: Math.min(level + 1, 6) });
  // One status block leads the page (the news first when a car is waiting); the timeline follows.
  const status = el('div', 'gcsp-activity-check-status');
  status.append(...searchLines(value, paused).map((line) => el('p', '', line)));
  const why = exclusionLines(value, paused);
  const steps = why.length ? nextSteps(why, onReviewBrief, hosted ? announce : undefined) : null;
  const lead = [status.childElementCount ? status : null, steps].filter(Boolean);
  root.append(...(found ? [news, ...lead] : [...lead, news]).filter(Boolean), feed);
  if (value.stateChangesEvidence?.status === 'incomplete') feed.append(el('p', 'gcsp-activity-secondary', 'Some activity could not be verified.'));
  return root;
}
