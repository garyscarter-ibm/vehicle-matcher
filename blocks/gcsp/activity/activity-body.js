// Representative body only. It displays a supplied server outcome; it owns no commands or saved state.
import { el, screenIntro, button, statusScreen, factList } from '../../vehicle-matcher/ui.js';
import { activityTimeline } from '../kit/activity-timeline.js';
import { activityCopy as copy, activityEvents } from './activity-copy.js';

let sequence = 0;
export function activityBody({ result, onRetry, level = 1 } = {}) {
  const root = el('div', 'vm gcsp-activity');
  root.append(screenIntro({ title: copy.title, lede: copy.lede, level, className: 'gcsp-activity-intro' }));
  if (result?.status !== 'ok' || !result.value) {
    root.append(statusScreen({ title: 'Activity is unavailable', message: copy.unavailable, role: 'alert',
      actions: [button({ label: 'Retry', onClick: onRetry, disabled: typeof onRetry !== 'function' })] }));
    return root;
  }
  const value = result.value;
  if (!value.permission) {
    root.append(statusScreen({ title: 'No confirmed search brief', message: 'Confirm your brief and search permission before the buddy can look for a car.' }));
    return root;
  }
  const paused = value.permission.paused === true;
  const state = el('section', 'gcsp-activity-state');
  const stateTitle = el(`h${Math.min(level + 1, 6)}`, 'gcsp-activity-state-title', paused ? copy.paused : copy.active);
  stateTitle.id = `gcsp-activity-state-${++sequence}`;
  state.setAttribute('aria-labelledby', stateTitle.id);
  const description = el('div', 'gcsp-activity-state-description');
  description.append(stateTitle, el('p', 'gcsp-activity-state-copy', paused ? copy.pausedDetail : copy.activeDetail));
  const action = el('div', 'gcsp-activity-action');
  const reason = el('p', 'gcsp-activity-preview-note', copy.preview); reason.id = `gcsp-activity-preview-${sequence}`;
  action.append(button({ label: paused ? 'Resume search' : 'Pause search', disabled: true, describedBy: reason.id }), reason);
  state.append(description, action); root.append(state);

  const summaries = el('div', 'gcsp-activity-summaries');
  const checks = el('section', 'gcsp-activity-checks');
  checks.append(el(`h${Math.min(level + 1, 6)}`, 'gcsp-activity-section-title', 'Search checks'),
    el('p', 'gcsp-activity-copy', copy.checkMissing),
    factList([{ label: 'Last successful check', value: null, missingLabel: 'Not available' },
      { label: 'Search brief', value: `Version ${value.briefVersion}` }], { className: 'gcsp-activity-facts' }));
  const offer = el('section', 'gcsp-activity-offer');
  offer.append(el(`h${Math.min(level + 1, 6)}`, 'gcsp-activity-section-title', 'Your offer'),
    el('p', 'gcsp-activity-copy', value.offers?.length ? copy.offerMissing : copy.offerEmpty));
  if (!paused) offer.append(el('p', 'gcsp-activity-secondary', value.permission.holdConsent
    ? 'Your permission includes holding a car when one is offered.' : 'You have not given permission to hold a car.'));
  summaries.append(offer, checks); root.append(summaries,
    activityTimeline({ events: activityEvents(value.stateChanges), level: Math.min(level + 1, 6) }));
  if (value.stateChangesEvidence?.status === 'incomplete') root.append(el('p', 'gcsp-activity-secondary', 'Some activity could not be verified and is not shown.'));
  return root;
}
