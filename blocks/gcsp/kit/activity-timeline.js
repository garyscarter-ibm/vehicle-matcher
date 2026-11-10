import { el } from '../../vehicle-matcher/ui.js';

let sequence = 0;
const format = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric',
  hour: '2-digit', minute: '2-digit', timeZone: 'UTC' });

/** UTC text for a valid ISO instant, shared by the timeline and its callers. */
export const demoTime = (instant) => format.format(new Date(instant));

/** Supplied event order is retained. No event, time or outcome is inferred by the kit. */
export function activityTimeline({ events = [], heading = 'Activity history', emptyText = 'No activity is recorded.', level = 2 } = {}) {
  const root = el('section', 'gcsp-activity-timeline');
  const title = el(`h${level}`, 'gcsp-timeline-heading', heading);
  title.id = `gcsp-timeline-${++sequence}`;
  root.setAttribute('aria-labelledby', title.id);
  root.append(title, el('p', 'gcsp-timeline-note', 'All dates are UTC.'));
  if (!events.length) { root.append(el('p', 'gcsp-timeline-empty', emptyText)); return root; }
  const list = el('ol', 'gcsp-timeline-list');
  for (const event of events) {
    const row = el('li', 'gcsp-timeline-event');
    const valid = typeof event.occurredAt === 'string' && Number.isFinite(Date.parse(event.occurredAt));
    const date = el(valid ? 'time' : 'span', 'gcsp-timeline-time', valid ? demoTime(event.occurredAt) : 'Time not available');
    if (valid) date.dateTime = event.occurredAt;
    const body = el('div', 'gcsp-timeline-detail');
    body.append(el('p', 'gcsp-timeline-label', event.label));
    if (event.detail) body.append(el('p', 'gcsp-timeline-description', event.detail));
    row.append(date, body); list.append(row);
  }
  root.append(list); return root;
}
