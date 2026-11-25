import { FINISH_SHADES } from './finish-shades-data';

export interface FinishLabelData { readonly label: string; readonly value?: string | null; readonly shade?: unknown }
export interface FinishShadeMapping {
  readonly paint: Readonly<Record<string, string | null>>;
  readonly upholstery: Readonly<Record<string, string | null>>;
}

// Frozen Node result-card.js palette and match-signal.js neutral: decorative colour families only.
export const SWATCH_HEX: Readonly<Record<string, string>> = Object.freeze({
  black: '#1d1d1f', grey: '#8e9094', silver: '#c8cacc', white: '#f4f4f2', blue: '#33567d',
  red: '#a03236', green: '#4a6b58', orange: '#c47a3a', yellow: '#d9b13b', brown: '#6b543f',
  beige: '#cfc3a8', bronze: '#9c7a5b', gold: '#b3945c', purple: '#5d4a72',
});
export const NEUTRAL_SWATCH = '#c8ccce';
const normalise = (value: string): string => value.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLowerCase();

/** Source exact names only: an explicit unsupported shade never falls back to a name. */
export function finishShade({ label, value, shade }: Partial<FinishLabelData> = {}, mapping: FinishShadeMapping = FINISH_SHADES): string | null {
  if (shade != null) {
    const supplied = typeof shade === 'string' ? normalise(shade) : '';
    return Object.hasOwn(SWATCH_HEX, supplied) ? supplied : null;
  }
  const kind = typeof label === 'string' ? normalise(label) : '';
  const table: Readonly<Record<string, string | null>> | null = ['paint', 'colour'].includes(kind) ? mapping.paint
    : ['upholstery', 'interior'].includes(kind) ? mapping.upholstery : null;
  if (!table || typeof value !== 'string') return null;
  const name = normalise(value);
  return Object.hasOwn(table, name) ? table[name] : null;
}
