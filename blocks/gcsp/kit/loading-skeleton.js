import { el } from '../../vehicle-matcher/ui.js';

// Shapes per layout: each entry is a block class; 'card' is a media well beside text lines.
const LAYOUTS = Object.freeze({
  page: ['title', 'line', 'line-short', 'card', 'rows'],
  form: ['title', 'line', 'panel', 'panel'],
  timeline: ['title', 'card-text', 'rows'],
  card: ['title', 'card'],
  console: ['title', 'line-short', 'actions', 'panel', 'rows'],
  section: ['rows'],
});

function block(kind) {
  if (kind === 'actions') {
    const row = el('div', 'gcsp-skeleton-actions');
    row.append(...[0, 1].map(() => el('span', 'gcsp-skeleton-shape gcsp-skeleton-button'))); return row;
  }
  if (kind === 'card' || kind === 'card-text') {
    const card = el('div', 'gcsp-skeleton-card');
    if (kind === 'card') card.append(el('span', 'gcsp-skeleton-shape gcsp-skeleton-media'));
    const text = el('div', 'gcsp-skeleton-text');
    text.append(...['line-short', 'heading', 'line', 'line', 'button'].map((k) => el('span', `gcsp-skeleton-shape gcsp-skeleton-${k}`)));
    card.append(text); return card;
  }
  if (kind === 'rows' || kind === 'panel') {
    const group = el('div', `gcsp-skeleton-${kind}`);
    group.append(...Array.from({ length: kind === 'rows' ? 3 : 4 }, (_, i) => el('span', `gcsp-skeleton-shape gcsp-skeleton-${i ? 'line' : 'heading'}`)));
    return group;
  }
  return el('span', `gcsp-skeleton-shape gcsp-skeleton-${kind}`);
}

/** Page-shaped placeholder while a view loads. The visible blocks are hidden from assistive tech; `label` is the one status line. */
export function loadingSkeleton({ label = 'Loading', layout = 'page', role = 'status' } = {}) {
  const root = el('div', 'gcsp-skeleton'); root.dataset.layout = LAYOUTS[layout] ? layout : 'page';
  root.setAttribute('aria-busy', 'true');
  const shapes = el('div', 'gcsp-skeleton-shapes'); shapes.setAttribute('aria-hidden', 'true');
  shapes.append(...(LAYOUTS[layout] || LAYOUTS.page).map(block));
  const text = el('p', 'gcsp-vh', label); if (role) text.setAttribute('role', role);
  root.append(text, shapes);
  return root;
}
