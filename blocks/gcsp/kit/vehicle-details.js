import { el, button, factList } from '../../vehicle-matcher/ui.js';
import { sideDrawer } from './side-drawer.js';
import { tabs } from './tabs.js';

/** One shared entry into the supplied specification and complete equipment list. */
export function vehicleDetails({ name, finishes = [], facts, decision, equipment = [] } = {}) {
  const root = el('div', 'gcsp-vehicle-details-control');
  const content = el('div', 'gcsp-vehicle-drawer-content'); content.hidden = true;
  const specification = el('div', 'gcsp-vehicle-specification');
  const suppliedFinishes = finishes.filter((finish) => finish.value != null && finish.value !== '');
  if (suppliedFinishes.length) specification.append(factList(suppliedFinishes));
  specification.append(...[facts, decision].filter(Boolean));
  const equipmentPanel = el('div', 'gcsp-vehicle-equipment');
  if (equipment.length) {
    const list = el('ul'); list.append(...equipment.map((label) => el('li', null, label))); equipmentPanel.append(list);
  } else equipmentPanel.append(el('p', 'gcsp-note', 'Equipment not supplied.'));
  const sections = tabs({ label: 'Car details', items: [
    { id: 'specification', label: 'Specification', panel: specification },
    { id: 'equipment', label: `Selected equipment${equipment.length ? ` (${equipment.length})` : ''}`, panel: equipmentPanel },
  ] });
  content.append(el('h3', 'gcsp-h2', name), sections.root);
  let drawer; let disposed = false;
  const entry = button({ label: 'View car details', variant: 'ghost', onClick: () => {
    if (drawer || disposed) return;
    content.hidden = false; entry.setAttribute('aria-expanded', 'true');
    drawer = sideDrawer({ host: root, context: 'Your offer', title: 'Car details', body: [content], opener: entry,
      onClose: () => { drawer = null; content.hidden = true; root.append(content); entry.setAttribute('aria-expanded', 'false'); } });
  } });
  entry.classList.add('gcsp-vehicle-details-entry'); entry.setAttribute('aria-haspopup', 'dialog'); entry.setAttribute('aria-expanded', 'false');
  const copy = el('span'); copy.append(el('strong', null, 'View car details'),
    el('span', 'gcsp-vehicle-details-hint', `Full specification · ${equipment.length ? `${equipment.length} selected equipment ${equipment.length === 1 ? 'item' : 'items'}` : 'Equipment not supplied'}`));
  const arrow = el('span', 'gcsp-vehicle-details-arrow', '→'); arrow.setAttribute('aria-hidden', 'true');
  entry.replaceChildren(copy, arrow); root.append(entry, content);
  return { root, destroy() { disposed = true; drawer?.close(false); } };
}
