import { FINISH_SHADES } from './finish-shades-data.js';
import { SWATCH_HEX } from '../../vehicle-matcher/modes/result-card.js';

const normalise = (value) => value.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLowerCase();

/** Broad decorative colour only. Exact names, not keyword or stitching inference. */
export function finishShade({ label, value, shade } = {}, mapping = FINISH_SHADES) {
  if (shade != null) {
    const supplied = typeof shade === 'string' ? normalise(shade) : '';
    return Object.hasOwn(SWATCH_HEX, supplied) ? supplied : null;
  }
  const kind = typeof label === 'string' ? normalise(label) : '';
  const table = ['paint', 'colour'].includes(kind) ? mapping.paint
    : ['upholstery', 'interior'].includes(kind) ? mapping.upholstery : null;
  if (!table || typeof value !== 'string') return null;
  const name = normalise(value);
  return Object.hasOwn(table, name) ? table[name] : null;
}
