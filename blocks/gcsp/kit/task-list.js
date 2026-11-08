import { el, button } from '../../vehicle-matcher/ui.js';
import { demoTime } from './activity-timeline.js';

let sequence = 0;
const TONES = ['todo', 'in-progress', 'overdue', 'failed', 'done'];
const FLAGS = Object.freeze({ overdue: 'Overdue', failed: 'Failed' });

function taskRow(item) {
  const tone = TONES.includes(item.tone) ? item.tone : 'todo';
  const row = el('li', `gcsp-task is-${tone}`);
  row.append(el('p', 'gcsp-task-label', item.label));
  if (FLAGS[tone]) {
    const flag = el('p', 'gcsp-task-flag');
    flag.append(el('strong', '', FLAGS[tone]));
    if (tone === 'failed' && item.reason) flag.append(document.createTextNode(`: ${item.reason}`));
    row.append(flag);
  }
  const due = typeof item.due === 'string' && Number.isFinite(Date.parse(item.due)) ? `Due ${demoTime(item.due)}` : null;
  const parts = [item.owner, tone === 'failed' ? null : item.status, due].filter(Boolean);
  if (parts.length) row.append(el('p', 'gcsp-task-meta', `${parts.join('. ')}.`));
  if (item.detail) row.append(el('p', 'gcsp-task-detail', item.detail));
  if (item.action) {
    const action = item.action;
    const reasonId = action.reason ? `gcsp-task-reason-${++sequence}` : undefined;
    const control = button({ label: action.label, variant: 'primary', onClick: () => action.onSelect?.(item.id),
      disabled: Boolean(action.disabled) || typeof action.onSelect !== 'function', describedBy: reasonId });
    row.append(control);
    if (reasonId) { const reason = el('p', 'gcsp-task-reason', action.reason); reason.id = reasonId; row.append(reason); }
  }
  return row;
}

/** Owned items grouped by who acts, with due times in demo time and an optional action. No requests; the caller owns effects. */
export function taskList({ heading = 'Tasks', groups = [], emptyText = 'No tasks.', level = 2 } = {}) {
  const root = el('section', 'gcsp-task-list');
  const title = el(`h${level}`, 'gcsp-task-heading', heading);
  title.id = `gcsp-task-list-${++sequence}`;
  root.setAttribute('aria-labelledby', title.id);
  root.append(title);
  const filled = groups.filter((group) => group.items?.length);
  if (!filled.length) { root.append(el('p', 'gcsp-task-empty', emptyText)); return root; }
  for (const group of filled) {
    const wrap = el('div', 'gcsp-task-group');
    if (group.heading) wrap.append(el(`h${Math.min(level + 1, 6)}`, 'gcsp-task-group-heading', group.heading));
    const list = el('ul', 'gcsp-task-items');
    for (const item of group.items) list.append(taskRow(item));
    wrap.append(list); root.append(wrap);
  }
  return root;
}
