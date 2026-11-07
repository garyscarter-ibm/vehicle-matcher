import { el } from '../../vehicle-matcher/ui.js';
import { demoTime } from './activity-timeline.js';

let sequence = 0;
const STATE_TEXT = Object.freeze({ done: 'Done', current: 'Current step', upcoming: 'Not started', declined: 'Declined', blocked: 'Not updated' });

/** Ordered stages with state, owner and next step in text. Supplied order and wording are kept; nothing is inferred. */
export function stageTracker({ heading = 'Progress', stages = [], level = 2 } = {}) {
  const root = el('section', 'gcsp-stage-tracker');
  const title = el(`h${level}`, 'gcsp-stage-heading', heading);
  title.id = `gcsp-stage-tracker-${++sequence}`;
  root.setAttribute('aria-labelledby', title.id);
  root.append(title);
  const list = el('ol', 'gcsp-stage-list');
  for (const stage of stages) {
    const state = Object.hasOwn(STATE_TEXT, stage.state) ? stage.state : 'upcoming';
    const row = el('li', `gcsp-stage is-${state}`);
    if (state === 'current' || state === 'blocked') row.setAttribute('aria-current', 'step');
    const head = el('p', 'gcsp-stage-head');
    head.append(el('span', 'gcsp-stage-label', stage.label), ' ', el('span', 'gcsp-stage-state', STATE_TEXT[state]));
    row.append(head);
    if (typeof stage.at === 'string' && Number.isFinite(Date.parse(stage.at))) {
      const time = el('time', 'gcsp-stage-time', demoTime(stage.at));
      time.dateTime = stage.at;
      row.append(time);
    }
    if (stage.owner) row.append(el('p', 'gcsp-stage-owner', stage.owner));
    if (stage.next) row.append(el('p', 'gcsp-stage-next', `Next: ${stage.next}`));
    if (stage.note) row.append(el('p', 'gcsp-stage-note', stage.note));
    list.append(row);
  }
  root.append(list);
  return root;
}
