// metricTile: one labelled figure for dense views. A privacy band shows its own text, never a number.
import { el } from '../../vehicle-matcher/ui.js';

export const BAND_DESCRIPTION = ', a privacy band: the exact count is hidden';
const LEVELS = ['headline', 'standard', 'compact'];

/** Value (string, number or { label, isBand }) -> { label, isBand, missing }. */
export function readValue(value) {
  if (value === null || value === undefined || value === '') return { label: 'Not supplied', isBand: false, missing: true };
  if (typeof value === 'object') {
    const label = value.label === null || value.label === undefined || value.label === '' ? null : String(value.label);
    return label === null ? { label: 'Not supplied', isBand: false, missing: true } : { label, isBand: Boolean(value.isBand), missing: false };
  }
  return { label: typeof value === 'number' ? value.toLocaleString('en-GB') : String(value), isBand: false, missing: false };
}

/** Fill a node with a value. A band keeps its label and adds screen-reader text saying it is a privacy band. */
export function fillValue(node, value) {
  const read = readValue(value);
  node.append(read.label);
  if (read.isBand) {
    node.classList.add('is-band');
    node.dataset.band = 'true';
    node.append(el('span', 'gcsp-vh', BAND_DESCRIPTION));
  }
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
