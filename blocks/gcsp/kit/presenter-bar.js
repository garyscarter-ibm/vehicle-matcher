import { el, factList } from '../../vehicle-matcher/ui.js';

/** Disclosure and supplied readback only; the consumer owns authorization and actions. */
export function presenterBar({ label = 'Presenter controls', readback = [] } = {}) {
  const root = el('details', 'gcsp-presenter-bar vm');
  const summary = el('summary', '', label);
  const panel = el('div', 'gcsp-presenter-panel');
  const facts = el('div', 'gcsp-presenter-facts');
  const setReadback = (rows = []) => facts.replaceChildren(factList(rows));
  setReadback(readback);
  panel.append(facts); root.append(summary, panel);
  return { root, summary, panel, readback: facts, setReadback };
}
