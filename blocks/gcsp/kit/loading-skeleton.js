import { el } from '../../vehicle-matcher/ui.js';

// Shapes per layout: each entry is a block class; 'card' is a media well beside text lines.
// 'feature' is Your cars: a full-width panel, the image filling its wide left column.
const LAYOUTS = Object.freeze({
  page: ['title', 'line', 'line-short', 'card', 'rows'],
  form: ['title', 'line', 'panel', 'panel'],
  timeline: ['title', 'card-text', 'rows'],
  card: ['title', 'card'],
  feature: ['title', 'feature', 'panel', 'rows'],
  console: ['title', 'line-short', 'actions', 'panel', 'rows'],
  section: ['rows'],
  'release-grid': ['tiles'],
  stats: ['stats'],
  bars: ['bars'],
});

function block(kind, { items, labels }) {
  if (kind === 'tiles') {
    const grid = el('div', 'gcsp-skeleton-release-grid');
    grid.append(...Array.from({ length: items ?? 100 }, () => el('span', 'gcsp-skeleton-shape gcsp-release-tile'))); return grid;
  }
  if (kind === 'stats') {
    const stats = el('div', 'gcsp-skeleton-stats');
    stats.append(...(labels ?? Array.from({ length: items ?? 5 }, () => '')).map((label) => {
      const stat = el('div', '');
      stat.append(label ? el('span', 'vm-fact-label', label) : el('span', 'gcsp-skeleton-shape gcsp-skeleton-line'), el('span', 'gcsp-skeleton-shape gcsp-skeleton-stat-value')); return stat;
    })); return stats;
  }
  if (kind === 'bars') {
    const bars = el('div', 'gcsp-count-bars-rows');
    bars.append(...Array.from({ length: items ?? 3 }, (_, at) => {
      const row = el('div', 'gcsp-count-bars-row');
      const bar = el('span', 'gcsp-skeleton-shape gcsp-skeleton-bar'); bar.style.width = `${100 - (at % 4) * 20}%`;
      row.append(el('span', 'gcsp-skeleton-shape gcsp-skeleton-line'), bar, el('span', 'gcsp-skeleton-shape')); return row;
    })); return bars;
  }
  if (kind === 'actions') {
    const row = el('div', 'gcsp-skeleton-actions');
    row.append(...[0, 1].map(() => el('span', 'gcsp-skeleton-shape gcsp-skeleton-button'))); return row;
  }
  if (kind === 'card' || kind === 'card-text' || kind === 'feature') {
    const card = el('div', kind === 'feature' ? 'gcsp-skeleton-card gcsp-skeleton-feature' : 'gcsp-skeleton-card');
    if (kind !== 'card-text') card.append(el('span', 'gcsp-skeleton-shape gcsp-skeleton-media'));
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
export function loadingSkeleton({ label = 'Loading', layout = 'page', role = 'status', items, labels } = {}) {
  const root = el('div', 'gcsp-skeleton'); root.dataset.layout = LAYOUTS[layout] ? layout : 'page';
  root.setAttribute('aria-busy', 'true');
  const shapes = el('div', 'gcsp-skeleton-shapes'); shapes.setAttribute('aria-hidden', 'true');
  shapes.append(...(LAYOUTS[layout] || LAYOUTS.page).map((kind) => block(kind, { items, labels })));
  const text = el('p', 'gcsp-vh', label); if (role) text.setAttribute('role', role);
  root.append(text, shapes);
  return root;
}
