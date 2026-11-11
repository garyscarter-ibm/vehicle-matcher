import { el } from '../../vehicle-matcher/ui.js';

let sequence = 0;
const format = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric',
  hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' });

/** UK wall-clock text for a valid ISO instant (FUCQ-354), shared by the timeline and Paula's screens. */
export const demoTime = (instant) => format.format(new Date(instant));

/** Supplied order is kept; collapseRepeats draws adjacent identical rows once. Nothing is inferred.
 * formatTime(iso) words the time, note is the paragraph under the heading (falsy for none), event.action is an optional node. */
export function activityTimeline({ events = [], heading = 'Activity history', emptyText = 'No activity is recorded.', level = 2, collapseRepeats = false,
  formatTime = demoTime, note = null } = {}) {
  const root = el('section', 'gcsp-activity-timeline');
  const title = el(`h${level}`, 'gcsp-timeline-heading', heading);
  title.id = `gcsp-timeline-${++sequence}`;
  root.setAttribute('aria-labelledby', title.id);
  root.append(title);
  if (note) root.append(el('p', 'gcsp-timeline-note', note));
  if (!events.length) { root.append(el('p', 'gcsp-timeline-empty', emptyText)); return root; }
  const list = el('ol', 'gcsp-timeline-list');
  let last = null;
  for (const event of events) {
    const key = `${event.occurredAt}|${event.label}|${event.detail ?? ''}`;
    if (collapseRepeats && key === last) continue;
    last = key;
    const row = el('li', 'gcsp-timeline-event');
    const valid = typeof event.occurredAt === 'string' && Number.isFinite(Date.parse(event.occurredAt));
    const date = el(valid ? 'time' : 'span', 'gcsp-timeline-time', valid ? formatTime(event.occurredAt) : 'Time not available');
    if (valid) date.dateTime = event.occurredAt;
    const body = el('div', 'gcsp-timeline-detail');
    body.append(el('p', 'gcsp-timeline-label', event.label));
    if (event.detail) body.append(el('p', 'gcsp-timeline-description', event.detail));
    if (event.action) body.append(event.action);
    row.append(date, body); list.append(row);
  }
  root.append(list); return root;
}
