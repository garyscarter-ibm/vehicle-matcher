import { describe, expect, it } from 'vitest';
import { comparisonFacts, comparisonMeasure } from './comparison.presentation';
import { ComparisonDifference } from './comparison.types';

const difference: ComparisonDifference = { measure: 'heldNotTakenCarDays', betterWhen: 'lower', verdict: 'buddy-better', current: { mean: 0.5, min: 0.25, max: 0.75 }, buddy: { mean: 0.25, min: 0.1, max: 0.5 }, difference: { mean: -0.25, min: -0.4, max: -0.1 } };
describe('comparison display mapping', () => {
  it('keeps every nested leaf, zero, false, null and empty container as labelled facts', () => {
    expect(comparisonFacts({ outerSetting: [{ exact: 0.123456789, enabled: false, missing: null }], empty: [], fields: {} })).toEqual([
      { label: 'Outer setting / Item 1 / Exact', value: '0.123456789' }, { label: 'Outer setting / Item 1 / Enabled', value: 'false' }, { label: 'Outer setting / Item 1 / Missing', value: 'Not supplied' }, { label: 'Empty', value: 'No entries' }, { label: 'Fields', value: 'No fields' },
    ]);
  });
  it('preserves a nested value key in its field path', () => {
    expect(comparisonFacts({ value: { name: 'Nested value' }, name: 'Outer name' })).toEqual([{ label: 'Value / Name', value: 'Nested value' }, { label: 'Name', value: 'Outer name' }]);
  });
  it('uses the frozen units, count precision, fixed fit precision and scale rules', () => {
    const hours = comparisonMeasure(difference); expect(hours.format(0.5)).toBe('12 h'); expect(hours.differenceText).toBe('Difference (buddy minus today): -6 h (-9.6 h to -2.4 h)'); expect(hours.scale).toEqual({ min: 0, max: 0.75 });
    const days = comparisonMeasure({ ...difference, current: { mean: 1, min: 0.5, max: 2 } }); expect(days.format(1)).toBe('1 day'); expect(days.format(2)).toBe('2 days');
    const share = comparisonMeasure({ ...difference, measure: 'accessGroupCoverage:limited-access' }); expect(share.scale).toEqual({ min: 0, max: 1 }); expect(share.format(0.12345)).toBe('12.3%'); expect(share.differenceText).toContain('-25 pts');
    const fit = comparisonMeasure({ ...difference, measure: 'meanAcceptedFit' }); expect(fit.scale).toEqual({ min: 0, max: 100 }); expect(fit.format(80)).toBe('80.0');
  });
  it('formats missing or non-finite means honestly and leaves the source statistics unchanged', () => {
    const input = { ...difference, measure: 'retries', current: { mean: null, min: null, max: null }, buddy: { mean: 0, min: 0, max: 0 }, difference: { mean: null, min: null, max: null } };
    const view = comparisonMeasure(input); expect(view.differenceText).toBe('Difference (buddy minus today): Not observed'); expect(view.format(Infinity)).toBe('Not observed'); expect(view.scale).toEqual({ min: 0, max: 1 }); expect(view.rows[0].mean).toBeNull(); expect(input.buddy.mean).toBe(0);
  });
});
