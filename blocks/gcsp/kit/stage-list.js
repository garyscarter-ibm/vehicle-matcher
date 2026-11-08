import { el } from '../../vehicle-matcher/ui.js';

let sequence = 0;
export const STAGE_LABELS = Object.freeze({ complete: 'Done', waiting: 'Waiting', 'not-started': 'Not started', pending: 'Sending', failed: 'Not accepted' });

/** Supplied stage names and order are kept as given. The kit labels each state; it infers none. */
export function stageList({ heading = 'Progress', stages = [], level = 2, labels = STAGE_LABELS } = {}) {
  const root = el('section', 'gcsp-stage-list'); const title = el(`h${level}`, 'gcsp-stage-heading', heading);
  title.id = `gcsp-stage-list-${++sequence}`; root.setAttribute('aria-labelledby', title.id);
  const list = el('ol', 'gcsp-stage-items');
  for (const stage of stages) {
    const row = el('li', `gcsp-stage-item is-${stage.state}`);
    row.append(el('span', 'gcsp-stage-name', stage.name), el('span', 'gcsp-stage-state', labels[stage.state] ?? 'Unknown'));
    list.append(row);
  }
  root.append(title, list); return root;
}
