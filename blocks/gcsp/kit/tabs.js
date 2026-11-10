import { el } from '../../vehicle-matcher/ui.js';

let sequence = 0;

/** WAI-ARIA tabs, automatic activation. items: { id, label, panel (a node you own) }. Returns { root, list, select(id), selected() }. */
export function tabs({ label, items = [], selected, onSelect } = {}) {
  if (!label || !items.length) throw new TypeError('Tabs need an accessible label and at least one item.');
  const base = `gcsp-tabs-${++sequence}`;
  const root = el('div', 'gcsp-tabs');
  const list = el('div', 'gcsp-tab-list');
  list.setAttribute('role', 'tablist'); list.setAttribute('aria-label', label);
  const entries = items.map((item, index) => {
    const tab = el('button', 'gcsp-tab', item.label); tab.type = 'button'; tab.id = `${base}-tab-${index}`;
    tab.setAttribute('role', 'tab'); tab.setAttribute('aria-controls', `${base}-panel-${index}`);
    const panel = item.panel; panel.id = `${base}-panel-${index}`; panel.classList.add('gcsp-tab-panel');
    panel.setAttribute('role', 'tabpanel'); panel.setAttribute('aria-labelledby', tab.id); panel.tabIndex = 0;
    return { id: item.id, tab, panel };
  });
  let current = (entries.find((entry) => entry.id === selected) ?? entries[0]).id;
  function paint() {
    for (const entry of entries) {
      const on = entry.id === current;
      entry.tab.setAttribute('aria-selected', String(on)); entry.tab.tabIndex = on ? 0 : -1; entry.panel.hidden = !on;
    }
  }
  function select(id) {
    if (!entries.some((entry) => entry.id === id) || id === current) return;
    current = id; paint(); onSelect?.(id);
  }
  list.addEventListener('click', (event) => {
    const entry = entries.find((row) => row.tab === event.target.closest('.gcsp-tab')); if (entry) select(entry.id);
  });
  list.addEventListener('keydown', (event) => {
    const at = entries.findIndex((row) => row.tab === event.target);
    const to = { ArrowRight: at + 1, ArrowLeft: at - 1, Home: 0, End: entries.length - 1 }[event.key];
    if (at < 0 || to === undefined) return;
    event.preventDefault();
    const entry = entries[(to + entries.length) % entries.length]; select(entry.id); entry.tab.focus();
  });
  list.append(...entries.map((entry) => entry.tab)); root.append(list, ...entries.map((entry) => entry.panel)); paint();
  return { root, list, select, selected: () => current };
}
