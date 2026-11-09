// metricTile: one labelled figure for dense views. A privacy band shows "<N" or its own label, never a number.
import { el } from '../../vehicle-matcher/ui.js';

const LEVELS = ['headline', 'standard', 'compact'];

/** Value (string, number, { label, isBand, fewerThan } or { label, missing }) -> { label, isBand, fewerThan, missing }. */
export function readValue(value) {
  if (value === null || value === undefined || value === '') return { label: 'Not supplied', isBand: false, missing: true };
  if (typeof value === 'object') {
    const label = value.label === null || value.label === undefined || value.label === '' ? null : String(value.label);
    if (label === null) return { label: 'Not supplied', isBand: false, missing: true };
    const isBand = Boolean(value.isBand);
    return { label, isBand, fewerThan: isBand && Number.isFinite(value.fewerThan) ? value.fewerThan : null, missing: value.missing === true };
  }
  return { label: typeof value === 'number' ? value.toLocaleString('en-GB') : String(value), isBand: false, missing: false };
}

/** Fill a node. A band with `fewerThan` shows "<N" and is spoken as its label; without it, the label alone. */
export function fillValue(node, value) {
  const read = readValue(value);
  if (read.isBand) {
    node.classList.add('is-band');
    node.dataset.band = 'true';
    if (read.fewerThan === null) node.append(read.label);
    else {
      const shown = el('span', null, `<${read.fewerThan}`);
      shown.setAttribute('aria-hidden', 'true');
      node.append(shown, el('span', 'gcsp-vh', read.label));
    }
  } else node.append(read.label);
  if (read.missing) node.classList.add('is-missing');
  return node;
}

/** { label, count: { label, isBand }, note, level: 'headline' | 'standard' | 'compact' } -> a figure tile (div). */
export function metricTile({ label, count, note, level = 'standard' } = {}) {
  const tile = el('div', `gcsp-tile gcsp-tile-${LEVELS.includes(level) ? level : 'standard'}`);
  const figure = fillValue(el('p', 'gcsp-tile-figure'), count);
  if (figure.dataset.band) tile.dataset.band = 'true';
  tile.append(el('p', 'gcsp-tile-label', label), figure);
  if (note) tile.append(el('p', 'gcsp-tile-note', note));
  return tile;
}
