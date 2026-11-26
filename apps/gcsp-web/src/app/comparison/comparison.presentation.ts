import { FactRow } from '../kit/fact-list.component';
import { RangeBarRow } from '../kit/range-bar.component';
import { ComparisonDifference } from './comparison.types';

const finite = (value: number | null): value is number => typeof value === 'number' && Number.isFinite(value);
const words = (value: string) => { const text = value.replace(/([a-z0-9])([A-Z])/g, (_match, left: string, right: string) => `${left} ${right.toLowerCase()}`).replace(/[-_]/g, ' '); return text.charAt(0).toUpperCase() + text.slice(1); };
/** Label every JSON leaf without serializing an object into a screen value. No transport data is changed. */
export function comparisonFacts(value: unknown, label = 'Value', plain: (text: string) => string = text => text): readonly FactRow[] {
  function visit(item: unknown, path: readonly string[]): readonly FactRow[] {
    const field = path.join(' / ') || 'Value';
    if (Array.isArray(item)) return item.length ? item.flatMap((entry, index) => visit(entry, [...path, `Item ${index + 1}`])) : [{ label: field, value: 'No entries' }];
    if (item !== null && typeof item === 'object') {
      const entries = Object.entries(item);
      return entries.length ? entries.flatMap(([key, entry]) => visit(entry, [...path, words(key)])) : [{ label: field, value: 'No fields' }];
    }
    return [{ label: field, value: item === undefined || item === null ? 'Not supplied' : typeof item === 'string' ? plain(item) : String(item) }];
  }
  return visit(value, label === 'Value' ? [] : [label]);
}

type Kind = 'share' | 'fit' | 'days' | 'hours' | 'count';
const trim = (value: number, dp = 1) => String(Math.round(value * 10 ** dp) / 10 ** dp);
/** Frozen comparison-view scale and comparison-copy units; formatting only. */
export function comparisonMeasure(difference: ComparisonDifference) {
  const stats = [difference.current, difference.buddy, difference.difference];
  const values = stats.flatMap(stat => [stat.mean, stat.min, stat.max]).filter(finite);
  const kind: Kind = difference.measure === 'acceptableCoverage' || difference.measure.startsWith('accessGroupCoverage:') ? 'share'
    : difference.measure === 'meanAcceptedFit' ? 'fit' : difference.measure === 'heldNotTakenCarDays' ? Math.max(0, ...values.map(Math.abs)) < 1 ? 'hours' : 'days' : 'count';
  const format = (value: number): string => !finite(value) ? 'Not observed' : kind === 'share' ? `${trim(value * 100)}%` : kind === 'fit' ? value.toFixed(1) : kind === 'hours' ? `${trim(value * 24)} h` : kind === 'days' ? `${trim(value)} ${trim(value) === '1' ? 'day' : 'days'}` : trim(value);
  const change = (value: number | null) => {
    if (!finite(value)) return 'Not observed';
    const body = format(Math.abs(value)); const sign = value > 0 && parseFloat(body) !== 0 ? '+' : value < 0 && parseFloat(body) !== 0 ? '-' : '';
    return `${sign}${kind === 'share' ? body.slice(0, -1) + ' pts' : body}`;
  };
  const rows: readonly RangeBarRow[] = [{ label: "Today's release route", ...difference.current }, { label: 'Buddy route', ...difference.buddy }];
  const top = Math.max(0, ...rows.flatMap(row => [row.mean, row.min, row.max]).filter(finite));
  const scale = { min: 0, max: kind === 'share' ? 1 : kind === 'fit' ? 100 : top > 0 ? top : 1 };
  const diff = difference.difference;
  const range = finite(diff.min) && finite(diff.max) ? ` (${change(diff.min)} to ${change(diff.max)})` : '';
  return { rows, scale, format, differenceText: `Difference (buddy minus today): ${change(diff.mean)}${finite(diff.mean) ? range : ''}` };
}
